use std::collections::HashMap;
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::store::SharedDatabase;
use crate::sync::{self, SharedSyncState, SyncOutcome, SyncStatus};

#[derive(Debug, Deserialize)]
pub struct CredentialsInput {
    pub email: String,
    pub password: String,
}

#[tauri::command]
pub async fn sync_status(
    state: tauri::State<'_, SharedSyncState>,
    db: tauri::State<'_, SharedDatabase>,
) -> Result<SyncStatus, String> {
    let mut sync = state.lock().await;
    Ok(sync::status(&mut sync, &db).await)
}

#[tauri::command]
pub async fn sync_login(
    state: tauri::State<'_, SharedSyncState>,
    input: CredentialsInput,
) -> Result<(), String> {
    let mut sync = state.lock().await;
    sync::login(&mut sync, &input.email, &input.password)
        .await
        .map_err(|err| err.to_string())
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

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let h = (bytes[i + 1] as char).to_digit(16);
                let l = (bytes[i + 2] as char).to_digit(16);
                if let (Some(h), Some(l)) = (h, l) {
                    out.push((h * 16 + l) as u8);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn parse_query(path: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if let Some(query) = path.split('?').nth(1) {
        for pair in query.split('&') {
            let mut it = pair.splitn(2, '=');
            if let (Some(k), Some(v)) = (it.next(), it.next()) {
                map.insert(percent_decode(k), percent_decode(v));
            }
        }
    }
    map
}

fn html_response(ok: bool) -> String {
    let (title, body) = if ok {
        (
            "Azalea connected",
            "You&#39;re signed in. Return to the Azalea app — you can close this tab.",
        )
    } else {
        (
            "Azalea login failed",
            "Something went wrong. Please try signing in again from the app.",
        )
    };
    let html = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{title}</title>\
<style>body{{font-family:system-ui,-apple-system,sans-serif;background:#0b0710;color:#f5f3ff;\
display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}}\
.c{{text-align:center;max-width:22rem;padding:2rem}}h1{{color:#a855f7;font-size:1.25rem;margin:0 0 .5rem}}\
p{{color:#8b7fad;font-size:.9rem;line-height:1.5;margin:0}}</style></head>\
<body><div class=\"c\"><h1>{title}</h1><p>{body}</p></div></body></html>"
    );
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    )
}

const NO_CONTENT_RESPONSE: &str = "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n";

/// Waits for the browser to hit `/callback?state=..&refresh_token=..` on the
/// loopback server, validates the state, and returns the refresh token.
async fn wait_for_callback(listener: TcpListener, expected_state: &str) -> anyhow::Result<String> {
    loop {
        let (mut stream, _) = listener.accept().await?;

        let mut buf = Vec::new();
        let mut tmp = [0u8; 2048];
        loop {
            let n = stream.read(&mut tmp).await?;
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&tmp[..n]);
            if buf.windows(4).any(|w| w == b"\r\n\r\n") || buf.len() > 16384 {
                break;
            }
        }

        let text = String::from_utf8_lossy(&buf);
        let first_line = text.lines().next().unwrap_or("");
        let path = first_line.split_whitespace().nth(1).unwrap_or("");

        if !path.starts_with("/callback") {
            let _ = stream.write_all(NO_CONTENT_RESPONSE.as_bytes()).await;
            let _ = stream.shutdown().await;
            continue;
        }

        let params = parse_query(path);
        let got_state = params.get("state").cloned().unwrap_or_default();
        let refresh = params.get("refresh_token").cloned().unwrap_or_default();

        if got_state != expected_state || refresh.is_empty() {
            let _ = stream.write_all(html_response(false).as_bytes()).await;
            let _ = stream.shutdown().await;
            anyhow::bail!("Login handshake failed (state mismatch or missing token).");
        }

        let _ = stream.write_all(html_response(true).as_bytes()).await;
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

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct UnlockResult {
    pub version: i64,
    pub settings: Option<Value>,
}

#[tauri::command]
pub async fn sync_unlock(
    state: tauri::State<'_, SharedSyncState>,
    db: tauri::State<'_, SharedDatabase>,
    input: UnlockInput,
) -> Result<UnlockResult, String> {
    let mut sync = state.lock().await;
    let (version, settings) = sync::unlock(
        &mut sync,
        &db,
        input.passphrase.as_deref(),
        input.recovery_key.as_deref(),
    )
    .await
    .map_err(|err| err.to_string())?;
    Ok(UnlockResult { version, settings })
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
