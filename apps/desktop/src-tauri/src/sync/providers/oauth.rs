//! Shared OAuth2 PKCE loopback helpers for personal cloud providers.

use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::super::new_pkce_material;
use super::{authorize_url, exchange_code, PersonalProvider, TokenSet};

const OAUTH_TIMEOUT: Duration = Duration::from_secs(300);

fn html_ok() -> &'static str {
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Azalea</title></head>\
     <body style=\"font-family:system-ui;background:#0a0a0a;color:#f5f5f5;display:flex;\
     align-items:center;justify-content:center;height:100vh;margin:0\">\
     <p>Signed in. You can close this tab and return to Azalea.</p></body></html>"
}

fn html_err(msg: &str) -> String {
    format!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Azalea</title></head>\
         <body style=\"font-family:system-ui;background:#0a0a0a;color:#f5f5f5;display:flex;\
         align-items:center;justify-content:center;height:100vh;margin:0\">\
         <p>Sign-in failed: {}</p></body></html>",
        html_escape(msg)
    )
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn http_html(status: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\n\
         Cache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    )
}

fn parse_query(query: &str) -> (Option<String>, Option<String>, Option<String>) {
    let mut code = None;
    let mut state = None;
    let mut error = None;
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        let key = parts.next().unwrap_or("");
        let value = parts.next().unwrap_or("");
        let decoded = percent_decode(value);
        match key {
            "code" => code = Some(decoded),
            "state" => state = Some(decoded),
            "error" | "error_description" if error.is_none() => {
                error = Some(decoded);
            }
            _ => {}
        }
    }
    (code, state, error)
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = &s[i + 1..i + 3];
                if let Ok(b) = u8::from_str_radix(hex, 16) {
                    out.push(b);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
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

/// Run full OAuth PKCE for a personal cloud provider. Opens `opener` with the
/// authorize URL; listens on loopback for the redirect.
pub async fn run_oauth_loopback(
    provider: PersonalProvider,
    http: &reqwest::Client,
    open_url: impl FnOnce(&str) -> anyhow::Result<()>,
) -> anyhow::Result<TokenSet> {
    let _ = provider.client_id()?;
    let pkce = new_pkce_material();
    let state = random_state();

    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");
    let auth_url = authorize_url(provider, &redirect_uri, &state, &pkce.challenge)?;
    open_url(&auth_url)?;

    let code = tokio::time::timeout(OAUTH_TIMEOUT, wait_for_code(listener, &state))
        .await
        .map_err(|_| anyhow::anyhow!("Sign-in timed out. Try again."))??;

    exchange_code(provider, http, &code, &redirect_uri, &pkce.verifier).await
}

async fn wait_for_code(listener: TcpListener, expected_state: &str) -> anyhow::Result<String> {
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
            if buf.windows(4).any(|w| w == b"\r\n\r\n") || buf.len() > 16_384 {
                break;
            }
        }
        let req = String::from_utf8_lossy(&buf);
        let first_line = req.lines().next().unwrap_or("");
        let path = first_line.split_whitespace().nth(1).unwrap_or("/");
        if !path.starts_with("/callback") {
            let _ = stream
                .write_all(http_html("404 Not Found", &html_err("Unknown path")).as_bytes())
                .await;
            continue;
        }
        let query = path.split_once('?').map(|(_, q)| q).unwrap_or("");
        let (code, got_state, error) = parse_query(query);
        if let Some(err) = error {
            let _ = stream
                .write_all(http_html("400 Bad Request", &html_err(&err)).as_bytes())
                .await;
            anyhow::bail!("Provider returned an error: {err}");
        }
        if got_state.as_deref() != Some(expected_state) {
            let _ = stream
                .write_all(http_html("400 Bad Request", &html_err("Invalid state")).as_bytes())
                .await;
            anyhow::bail!("OAuth state mismatch");
        }
        let Some(code) = code.filter(|c| !c.is_empty()) else {
            let _ = stream
                .write_all(http_html("400 Bad Request", &html_err("Missing code")).as_bytes())
                .await;
            anyhow::bail!("Missing authorization code");
        };
        let _ = stream
            .write_all(http_html("200 OK", html_ok()).as_bytes())
            .await;
        return Ok(code);
    }
}
