//! Smallest HTTP/1.1 server that speaks MCP's "streamable HTTP" transport in
//! its plain JSON mode: one POST, one JSON answer, connection closed.

use std::collections::HashMap;
use std::time::Duration;

use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

use super::{tools, McpServer};

const MAX_HEAD: usize = 32 * 1024;
const MAX_BODY: usize = 2 * 1024 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(15);

pub async fn serve(
    app: AppHandle,
    listener: std::net::TcpListener,
    port: u16,
    mut stop: oneshot::Receiver<()>,
) {
    let Ok(listener) = TcpListener::from_std(listener) else {
        return;
    };
    loop {
        tokio::select! {
            _ = &mut stop => return,
            accepted = listener.accept() => {
                let Ok((stream, _)) = accepted else { continue };
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = handle_connection(app, stream, port).await;
                });
            }
        }
    }
}

struct Response {
    status: u16,
    reason: &'static str,
    headers: Vec<(&'static str, String)>,
    body: Vec<u8>,
}

impl Response {
    fn plain(status: u16, reason: &'static str, message: &str) -> Self {
        Self {
            status,
            reason,
            headers: vec![("Content-Type", "text/plain; charset=utf-8".into())],
            body: message.as_bytes().to_vec(),
        }
    }

    fn json(value: &Value) -> Self {
        Self {
            status: 200,
            reason: "OK",
            headers: vec![("Content-Type", "application/json".into())],
            body: serde_json::to_vec(value).unwrap_or_default(),
        }
    }

    fn accepted() -> Self {
        Self {
            status: 202,
            reason: "Accepted",
            headers: Vec::new(),
            body: Vec::new(),
        }
    }
}

async fn handle_connection(
    app: AppHandle,
    mut stream: TcpStream,
    port: u16,
) -> std::io::Result<()> {
    let response = match tokio::time::timeout(READ_TIMEOUT, read_request(&mut stream)).await {
        Ok(Ok(request)) => respond(&app, port, request).await,
        Ok(Err(response)) => response,
        Err(_) => Response::plain(408, "Request Timeout", "Request timed out."),
    };
    let mut head = format!(
        "HTTP/1.1 {} {}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n",
        response.status,
        response.reason,
        response.body.len()
    );
    for (name, value) in &response.headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes()).await?;
    stream.write_all(&response.body).await?;
    stream.shutdown().await
}

struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

async fn read_request(stream: &mut TcpStream) -> Result<Request, Response> {
    let bad = |message: &str| Response::plain(400, "Bad Request", message);
    let mut buffer = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        if let Some(position) = find(&buffer, b"\r\n\r\n") {
            break position;
        }
        if buffer.len() > MAX_HEAD {
            return Err(Response::plain(
                431,
                "Request Header Fields Too Large",
                "Headers too large.",
            ));
        }
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|_| bad("Could not read the request."))?;
        if read == 0 {
            return Err(bad("Connection closed early."));
        }
        buffer.extend_from_slice(&chunk[..read]);
    };

    let head = std::str::from_utf8(&buffer[..head_end]).map_err(|_| bad("Invalid headers."))?;
    let mut lines = head.split("\r\n");
    let mut request_line = lines.next().unwrap_or_default().split(' ');
    let method = request_line.next().unwrap_or_default().to_string();
    let path = request_line.next().unwrap_or_default().to_string();
    let mut headers = HashMap::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    let mut request = Request {
        method,
        path,
        headers,
        body: buffer[head_end + 4..].to_vec(),
    };
    // Reject before reading any body from an unauthenticated caller.
    precheck(&request)?;

    if request.method == "POST" {
        if request.headers.contains_key("transfer-encoding") {
            return Err(Response::plain(
                411,
                "Length Required",
                "Send a Content-Length header.",
            ));
        }
        let length: usize = request
            .headers
            .get("content-length")
            .and_then(|value| value.parse().ok())
            .ok_or_else(|| {
                Response::plain(411, "Length Required", "Send a Content-Length header.")
            })?;
        if length > MAX_BODY {
            return Err(Response::plain(
                413,
                "Payload Too Large",
                "Request body too large.",
            ));
        }
        while request.body.len() < length {
            let read = stream
                .read(&mut chunk)
                .await
                .map_err(|_| bad("Could not read the body."))?;
            if read == 0 {
                return Err(bad("Connection closed early."));
            }
            request.body.extend_from_slice(&chunk[..read]);
        }
        request.body.truncate(length);
    }
    Ok(request)
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// Checks that only need the request line and headers.
fn precheck(request: &Request) -> Result<(), Response> {
    // A browser tab on another site must not be able to reach this endpoint.
    if request.headers.contains_key("origin") {
        return Err(Response::plain(
            403,
            "Forbidden",
            "Browser requests are not allowed.",
        ));
    }
    if request.path.split('?').next() != Some("/mcp") {
        return Err(Response::plain(404, "Not Found", "Use /mcp."));
    }
    Ok(())
}

fn host_allowed(host: Option<&String>, port: u16) -> bool {
    let Some(host) = host else { return false };
    let host = host.to_ascii_lowercase();
    [
        format!("127.0.0.1:{port}"),
        format!("localhost:{port}"),
        format!("[::1]:{port}"),
    ]
    .contains(&host)
}

/// Compares digests so the comparison time does not depend on where the
/// two tokens first differ.
fn token_matches(given: &str, expected: &str) -> bool {
    let a = Sha256::digest(given.as_bytes());
    let b = Sha256::digest(expected.as_bytes());
    a.iter()
        .zip(b.iter())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

async fn respond(app: &AppHandle, port: u16, request: Request) -> Response {
    if !host_allowed(request.headers.get("host"), port) {
        return Response::plain(403, "Forbidden", "Unexpected Host header.");
    }
    let server = app.state::<McpServer>();
    if !server.prefs().enabled {
        return Response::plain(503, "Service Unavailable", "The Azalea MCP server is off.");
    }
    let expected = match server.token() {
        Ok(token) => token,
        Err(_) => {
            return Response::plain(500, "Internal Server Error", "Access token unavailable.")
        }
    };
    let given = request
        .headers
        .get("authorization")
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or_default();
    if !token_matches(given, &expected) {
        let mut response = Response::plain(401, "Unauthorized", "Missing or wrong access token.");
        response
            .headers
            .push(("WWW-Authenticate", "Bearer".to_string()));
        return response;
    }

    match request.method.as_str() {
        "POST" => {}
        // No server-initiated stream and no sessions to end.
        "GET" | "DELETE" => {
            let mut response = Response::plain(405, "Method Not Allowed", "Use POST.");
            response.headers.push(("Allow", "POST".to_string()));
            return response;
        }
        _ => return Response::plain(405, "Method Not Allowed", "Use POST."),
    }

    let message: Value = match serde_json::from_slice(&request.body) {
        Ok(value) => value,
        Err(_) => {
            return Response::json(&serde_json::json!({
                "jsonrpc": "2.0",
                "id": null,
                "error": { "code": -32700, "message": "Parse error" }
            }))
        }
    };

    match message {
        Value::Array(items) => {
            let mut answers = Vec::new();
            for item in items {
                if let Some(answer) = tools::handle_message(app, item).await {
                    answers.push(answer);
                }
            }
            if answers.is_empty() {
                Response::accepted()
            } else {
                Response::json(&Value::Array(answers))
            }
        }
        single => match tools::handle_message(app, single).await {
            Some(answer) => Response::json(&answer),
            None => Response::accepted(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_header_must_be_loopback_with_port() {
        let ok = "127.0.0.1:47821".to_string();
        assert!(host_allowed(Some(&ok), 47821));
        assert!(!host_allowed(Some(&ok), 1234));
        assert!(!host_allowed(
            Some(&"evil.example:47821".to_string()),
            47821
        ));
        assert!(!host_allowed(None, 47821));
    }

    #[test]
    fn token_comparison() {
        assert!(token_matches("azl_abc", "azl_abc"));
        assert!(!token_matches("azl_abd", "azl_abc"));
        assert!(!token_matches("", "azl_abc"));
    }
}
