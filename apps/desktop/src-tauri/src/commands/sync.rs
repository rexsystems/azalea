use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::store::SharedDatabase;
use crate::sync::{self, SelfHostProbe, SharedSyncState, SyncOutcome, SyncPreview, SyncStatus};

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

#[derive(Default)]
pub struct BrowserLoginState(
    parking_lot::Mutex<
        Option<(
            String,
            std::sync::Arc<tokio::sync::Notify>,
            tokio::sync::mpsc::Sender<String>,
        )>,
    >,
);

impl BrowserLoginState {
    fn start(
        &self,
    ) -> (
        String,
        std::sync::Arc<tokio::sync::Notify>,
        tokio::sync::mpsc::Receiver<String>,
    ) {
        let id = random_state();
        let cancel = std::sync::Arc::new(tokio::sync::Notify::new());
        let (sender, receiver) = tokio::sync::mpsc::channel(1);
        if let Some((_, previous, _)) = self.0.lock().replace((id.clone(), cancel.clone(), sender))
        {
            previous.notify_one();
        }
        (id, cancel, receiver)
    }

    fn cancel(&self) {
        if let Some((_, cancel, _)) = self.0.lock().take() {
            cancel.notify_one();
        }
    }
}

struct BrowserLoginGuard<'a> {
    state: &'a BrowserLoginState,
    id: String,
}
impl Drop for BrowserLoginGuard<'_> {
    fn drop(&mut self) {
        let mut pending = self.state.0.lock();
        if pending.as_ref().is_some_and(|(id, _, _)| *id == self.id) {
            pending.take();
        }
    }
}

#[tauri::command]
pub fn sync_cancel_browser_login(login: tauri::State<'_, BrowserLoginState>) {
    login.cancel();
}

#[tauri::command]
pub fn sync_submit_browser_login_code(
    login: tauri::State<'_, BrowserLoginState>,
    code: String,
) -> Result<(), String> {
    let code = code.trim();
    if code.len() < 16
        || code.len() > 256
        || !code.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err("Paste the one-time sign-in code shown in the browser.".into());
    }
    let pending = login.0.lock();
    let (_, _, sender) = pending
        .as_ref()
        .ok_or("Start a browser sign-in from the app first.")?;
    sender
        .try_send(code.into())
        .map_err(|_| "The code is already being processed. Restart sign-in if it failed.".into())
}

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
Access-Control-Allow-Private-Network: true\r\n\
Content-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    )
}

const PREFLIGHT_RESPONSE: &str = "HTTP/1.1 204 No Content\r\n\
Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\n\
Access-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Private-Network: true\r\nConnection: close\r\n\r\n";

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
            let n = match tokio::time::timeout(Duration::from_secs(10), stream.read(&mut tmp)).await
            {
                Ok(Ok(n)) => n,
                _ => break,
            };
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
    login: tauri::State<'_, BrowserLoginState>,
) -> Result<(), String> {
    let (id, cancel, mut manual_code) = login.start();
    let _guard = BrowserLoginGuard { state: &login, id };
    let work = async {
        // Bind the loopback server first so we know which port to advertise.
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Could not start local login server: {e}"))?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let expected_state = random_state();

        // PKCE material stays in this process for the lifetime of the flow.
        let pkce = sync::new_pkce_material();

        // Ask the server for a handle that ties the browser session to our PKCE
        // challenge. If we cannot reach the server, bail before opening a browser
        // window so we surface a clear error to the UI.
        let (api_base, web, original_account) = {
            let sync = state.lock().await;
            let api_base = sync::api_base_url_public(&sync).map_err(|e| e.to_string())?;
            (
                api_base,
                sync::web_base_url(Some(&sync)),
                sync.account_id_clone(),
            )
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

        let code = tokio::select! {
            code = wait_for_callback(listener, &expected_state) => code.map_err(|error| error.to_string())?,
            code = manual_code.recv() => code.ok_or("Browser sign-in was cancelled.")?,
        };

        // Redeem the one-time code with the server using our local PKCE verifier.
        let session = sync::exchange_desktop_code(&api_base, &handle, &code, &pkce.verifier)
            .await
            .map_err(|e| e.to_string())?;

        let (account_id, email) = {
            let mut sync = state.lock().await;
            if sync.account_id_clone() != original_account {
                return Err(
                    "Account changed during browser sign-in. Start again on the current account."
                        .into(),
                );
            }
            sync::login_with_desktop_session(&mut sync, session)
                .await
                .map_err(|e| e.to_string())?;
            (sync.account_id_clone(), sync.email())
        };

        if let (Some(id), Some(email)) = (account_id, email) {
            let _ = registry.lock().set_email(&id, Some(email));
        }
        Ok(())
    };
    tokio::select! {
        biased;
        _ = cancel.notified() => Err("Browser sign-in cancelled. You can sign in again.".into()),
        result = tokio::time::timeout(BROWSER_LOGIN_TIMEOUT, work) => result.map_err(|_| "Browser sign-in timed out. You can start it again.".to_string())?,
    }
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

#[cfg(test)]
mod browser_login_tests {
    use super::*;

    #[tokio::test]
    async fn starting_again_cancels_old_attempt_without_old_cleanup_clearing_the_new_one() {
        let state = BrowserLoginState::default();
        let (old_id, old_cancel, _) = state.start();
        let old_guard = BrowserLoginGuard {
            state: &state,
            id: old_id,
        };
        let (new_id, new_cancel, _) = state.start();
        tokio::time::timeout(Duration::from_millis(100), old_cancel.notified())
            .await
            .unwrap();
        drop(old_guard);
        assert_eq!(state.0.lock().as_ref().unwrap().0, new_id);
        state.cancel();
        tokio::time::timeout(Duration::from_millis(100), new_cancel.notified())
            .await
            .unwrap();
        assert!(state.0.lock().is_none());
    }

    #[tokio::test]
    async fn blocked_browser_can_submit_code_to_the_current_attempt() {
        let state = BrowserLoginState::default();
        let (_, _, mut receiver) = state.start();
        state
            .0
            .lock()
            .as_ref()
            .unwrap()
            .2
            .try_send("one-time-code-for-pkce-exchange".into())
            .unwrap();
        assert_eq!(
            receiver.recv().await.as_deref(),
            Some("one-time-code-for-pkce-exchange")
        );
        state.cancel();
        assert!(receiver.recv().await.is_none());
    }

    #[tokio::test]
    async fn local_network_preflight_and_invalid_state_do_not_consume_the_valid_callback() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let callback = tokio::spawn(wait_for_callback(listener, "expected-state"));
        let mut preflight = tokio::net::TcpStream::connect(address).await.unwrap();
        preflight.write_all(b"OPTIONS /callback HTTP/1.1\r\nHost: localhost\r\nAccess-Control-Request-Private-Network: true\r\n\r\n").await.unwrap();
        let mut response = String::new();
        preflight.read_to_string(&mut response).await.unwrap();
        assert!(response.contains("204 No Content"));
        assert!(response.contains("Access-Control-Allow-Private-Network: true"));
        for (state, status) in [
            ("wrong-state", "400 Bad Request"),
            ("expected-state", "200 OK"),
        ] {
            let body = serde_json::json!({"state":state,"code":"one-time-code"}).to_string();
            let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
            stream.write_all(format!("POST /callback HTTP/1.1\r\nHost: localhost\r\nContent-Length: {}\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).await.unwrap();
            assert!(response.contains(status));
        }
        assert_eq!(callback.await.unwrap().unwrap(), "one-time-code");
    }
}

#[tauri::command]
pub async fn sync_logout(
    state: tauri::State<'_, SharedSyncState>,
    db: tauri::State<'_, SharedDatabase>,
    registry: tauri::State<'_, crate::commands::accounts::SharedAccountRegistry>,
) -> Result<(), String> {
    let account_id = {
        let mut sync = state.lock().await;
        let id = sync.account_id_clone();
        sync::logout(&mut sync, &db);
        id
    };
    if let Some(id) = account_id {
        let _ = registry.lock().set_email(&id, None);
    }
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
