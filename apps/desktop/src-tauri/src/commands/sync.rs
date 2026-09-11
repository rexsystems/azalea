use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::store::SharedDatabase;
use crate::sync::{self, SharedSyncState, SelfHostProbe, SyncOutcome, SyncPreview, SyncStatus};

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
    use rand::rngs::OsRng;
    use rand::Rng;
    let mut rng = OsRng;
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

/// The browser POSTs `{state, code}` to the loopback listener. Neither field
/// is a bearer credential on its own: `code` must be exchanged with the server
/// using the local PKCE `code_verifier` to yield a session.
#[derive(Debug, Deserialize)]
struct CallbackBody {
    state: String,
    code: String,
}

/// Waits for the browser to POST `{state, code}` to `/callback` on the
/// loopback server, validates the state, and returns the authorization code.
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

        let code = match parsed {
            Some(payload) if payload.state == expected_state && !payload.code.is_empty() => {
                Some(payload.code)
            }
            _ => {
                let _ = stream
                    .write_all(json_response("400 Bad Request", r#"{"ok":false}"#).as_bytes())
                    .await;
                let _ = stream.shutdown().await;
                // Keep waiting for a valid callback instead of aborting the whole handshake.
                None
            }
        };

        let Some(code) = code else {
            continue;
        };

        let _ = stream
            .write_all(json_response("200 OK", r#"{"ok":true}"#).as_bytes())
            .await;
        let _ = stream.flush().await;
        let _ = stream.shutdown().await;
        return Ok(code);
    }
}

#[tauri::command]
pub async fn sync_browser_login(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedSyncState>,
    registry: tauri::State<'_, crate::commands::accounts::SharedAccountRegistry>,
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

    // PKCE material stays in this process for the lifetime of the flow.
    let pkce = sync::new_pkce_material();

    // Ask the server for a handle that ties the browser session to our PKCE
    // challenge. If we cannot reach the server, bail before opening a browser
    // window so we surface a clear error to the UI.
    let (api_base, web) = {
        let sync = state.lock().await;
        let api_base = sync::api_base_url_public(&sync)
            .map_err(|e| e.to_string())?;
        (api_base, sync::web_base_url(Some(&sync)))
    };
    let handle = sync::begin_desktop_pkce(&api_base, &pkce.challenge, &expected_state)
        .await
        .map_err(|e| e.to_string())?;

    let url = format!(
        "{}/authorize?port={}&state={}&handle={}",
        web,
        port,
        urlencoding_encode(&expected_state),
        urlencoding_encode(&handle),
    );

    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("Could not open the browser: {e}"))?;

    let code = tokio::time::timeout(
        BROWSER_LOGIN_TIMEOUT,
        wait_for_callback(listener, &expected_state),
    )
    .await
    .map_err(|_| "Timed out waiting for the browser sign-in.".to_string())?
    .map_err(|e| e.to_string())?;

    // Redeem the one-time code with the server using our local PKCE verifier.
    let session = sync::exchange_desktop_code(&api_base, &handle, &code, &pkce.verifier)
        .await
        .map_err(|e| e.to_string())?;

    let (account_id, email) = {
        let mut sync = state.lock().await;
        sync::login_with_desktop_session(&mut sync, session)
            .await
            .map_err(|e| e.to_string())?;
        (sync.account_id_clone(), sync.email())
    };

    if let (Some(id), Some(email)) = (account_id, email) {
        let _ = registry.lock().set_email(&id, Some(email));
    }
    Ok(())
}

/// Minimal, non-panicking percent-encoding for query-string values so we don't
/// pull in a whole crate for one call.
fn urlencoding_encode(v: &str) -> String {
    let mut out = String::with_capacity(v.len());
    for byte in v.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(*byte as char);
            }
            _ => {
                out.push_str(&format!("%{byte:02X}"));
            }
        }
    }
    out
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
pub async fn probe_selfhost(input: sync::ProbeSelfhostInput) -> Result<SelfHostProbe, String> {
    sync::probe_selfhost(&input.base_url, input.web_url.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
pub struct PasswordLoginInput {
    pub email: String,
    pub password: String,
}

#[tauri::command]
pub async fn sync_password_login(
    state: tauri::State<'_, SharedSyncState>,
    registry: tauri::State<'_, crate::commands::accounts::SharedAccountRegistry>,
    input: PasswordLoginInput,
) -> Result<(), String> {
    let email = input.email.trim().to_string();
    if email.is_empty() || input.password.is_empty() {
        return Err("Email and password are required".into());
    }

    let account_id = {
        let mut sync = state.lock().await;
        sync::login_with_password(&mut sync, &email, &input.password)
            .await
            .map_err(|e| e.to_string())?;
        sync.account_id_clone()
    };

    if let Some(id) = account_id {
        let _ = registry.lock().set_email(&id, Some(email));
    }
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
