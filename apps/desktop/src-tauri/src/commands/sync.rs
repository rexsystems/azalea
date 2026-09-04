use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::store::SharedDatabase;
use crate::sync::{self, SharedSyncState, SyncOutcome, SyncPreview, SyncStatus};

#[tauri::command]
pub async fn sync_status(
    state: tauri::State<'_, SharedSyncState>,
    db: tauri::State<'_, SharedDatabase>,
) -> Result<SyncStatus, String> {
    let mut sync = state.lock().await;
    Ok(sync::status(&mut sync, &db).await)
}

// ---------- browser login (loopback handoff) ----------

const BROWSER_LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

fn random_state() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..24)
        .map(|_| {
            let n: u8 = rng.gen_range(0..62);
            match n {
                0..=9 => (b'0' + n) as char,
                10..=35 => (b'a' + (n - 10)) as char,
                _ => (b'A' + (n - 36)) as char,
            }
        })
        .collect()
}

fn json_response(status: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\n\
Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\n\
Access-Control-Allow-Methods: POST, OPTIONS\r\nCache-Control: no-store\r\n\
Content-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    )
}

const PREFLIGHT_RESPONSE: &str = "HTTP/1.1 204 No Content\r\n\
Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\n\
Access-Control-Allow-Methods: POST, OPTIONS\r\nConnection: close\r\n\r\n";

const NO_CONTENT_RESPONSE: &str = "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n";

#[derive(Debug, Deserialize)]
struct CallbackBody {
    state: String,
    refresh_token: String,
}

/// Waits for the browser to POST `{state, refresh_token}` to `/callback` on the
/// loopback server, validates the state, and returns the refresh token. The
/// token is kept out of the URL so it never reaches browser history or logs.
async fn wait_for_callback(listener: TcpListener, expected_state: &str) -> anyhow::Result<String> {
    loop {
        let (mut stream, _) = listener.accept().await?;

        let mut buf = Vec::new();
        let mut tmp = [0u8; 2048];
        let mut header_end = None;
        let mut content_length = 0usize;

        loop {
            let n = stream.read(&mut tmp).await?;
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&tmp[..n]);

            if header_end.is_none() {
                if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                    header_end = Some(pos + 4);
                    let headers = String::from_utf8_lossy(&buf[..pos]).to_ascii_lowercase();
                    content_length = headers
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length:"))
                        .and_then(|v| v.trim().parse::<usize>().ok())
                        .unwrap_or(0);
                }
            }

            if let Some(start) = header_end {
                if buf.len() >= start + content_length {
                    break;
                }
            }
            if buf.len() > 16384 {
                break;
            }
        }

        let header_end = header_end.unwrap_or(buf.len());
        let text = String::from_utf8_lossy(&buf[..header_end]);
        let first_line = text.lines().next().unwrap_or("");
        let mut parts = first_line.split_whitespace();
        let method = parts.next().unwrap_or("");
        let path = parts.next().unwrap_or("");

        if method.eq_ignore_ascii_case("OPTIONS") {
            let _ = stream.write_all(PREFLIGHT_RESPONSE.as_bytes()).await;
            let _ = stream.shutdown().await;
            continue;
        }

        if !method.eq_ignore_ascii_case("POST") || !path.starts_with("/callback") {
            let _ = stream.write_all(NO_CONTENT_RESPONSE.as_bytes()).await;
            let _ = stream.shutdown().await;
            continue;
        }

        let body = &buf[header_end..];
        let parsed: Option<CallbackBody> = serde_json::from_slice(body).ok();

        let refresh = match parsed {
            Some(payload)
                if payload.state == expected_state && !payload.refresh_token.is_empty() =>
            {
                payload.refresh_token
            }
            _ => {
                let _ = stream
                    .write_all(json_response("400 Bad Request", r#"{"ok":false}"#).as_bytes())
                    .await;
                let _ = stream.shutdown().await;
                anyhow::bail!("Login handshake failed (state mismatch or missing token).");
            }
        };

        let _ = stream
            .write_all(json_response("200 OK", r#"{"ok":true}"#).as_bytes())
            .await;
        let _ = stream.flush().await;
        let _ = stream.shutdown().await;
        return Ok(refresh);
    }
}

#[tauri::command]
pub async fn sync_browser_login(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedSyncState>,
) -> Result<(), String> {
    // Bind the loopback server first so we know which port to advertise.
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Could not start local login server: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();
    let expected_state = random_state();

    let url = format!(
        "{}/authorize?port={}&state={}",
        sync::web_base_url(),
        port,
        expected_state
    );

    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("Could not open the browser: {e}"))?;

    let refresh = tokio::time::timeout(
        BROWSER_LOGIN_TIMEOUT,
        wait_for_callback(listener, &expected_state),
    )
    .await
    .map_err(|_| "Timed out waiting for the browser sign-in.".to_string())?
    .map_err(|e| e.to_string())?;

    let mut sync = state.lock().await;
    sync::login_with_refresh_token(&mut sync, &refresh)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_logout(
    state: tauri::State<'_, SharedSyncState>,
    db: tauri::State<'_, SharedDatabase>,
) -> Result<(), String> {
    let mut sync = state.lock().await;
    sync::logout(&mut sync, &db);
    Ok(())
}

#[tauri::command]
pub async fn sync_setup_passphrase(
    state: tauri::State<'_, SharedSyncState>,
    db: tauri::State<'_, SharedDatabase>,
    passphrase: String,
    settings: Option<Value>,
) -> Result<String, String> {
    let mut sync = state.lock().await;
    sync::setup_passphrase(&mut sync, &db, &passphrase, settings)
        .await
        .map_err(|err| err.to_string())
}

#[derive(Debug, Deserialize)]
pub struct UnlockInput {
    pub passphrase: Option<String>,
    pub recovery_key: Option<String>,
}

#[tauri::command]
pub async fn sync_unlock(
    state: tauri::State<'_, SharedSyncState>,
    db: tauri::State<'_, SharedDatabase>,
    input: UnlockInput,
) -> Result<i64, String> {
    let mut sync = state.lock().await;
    sync::unlock(
        &mut sync,
        &db,
        input.passphrase.as_deref(),
        input.recovery_key.as_deref(),
    )
    .await
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn sync_preview(
    state: tauri::State<'_, SharedSyncState>,
    db: tauri::State<'_, SharedDatabase>,
    settings: Option<Value>,
) -> Result<SyncPreview, String> {
    let mut sync = state.lock().await;
    sync::preview_sync(&mut sync, &db, settings)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn sync_now(
    state: tauri::State<'_, SharedSyncState>,
    db: tauri::State<'_, SharedDatabase>,
    settings: Option<Value>,
    resolution: Option<String>,
) -> Result<SyncOutcome, String> {
    let mut sync = state.lock().await;
    sync::perform_sync(&mut sync, &db, settings, resolution.as_deref())
        .await
        .map_err(|err| err.to_string())
}
