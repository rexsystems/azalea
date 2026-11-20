//! Built-in MCP server. Lets an AI client (Claude Code, Codex, Cursor, ...)
//! work with the hosts and keys stored in Azalea over a local HTTP endpoint.
//!
//! Off by default. When on it listens on 127.0.0.1 only, requires a bearer
//! token, and every group of tools has its own switch. Private keys and
//! passwords are never returned to the client.

mod http;
mod tools;

use std::collections::VecDeque;
use std::fs;
use std::path::PathBuf;

use parking_lot::Mutex;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tokio::sync::oneshot;

pub const DEFAULT_PORT: u16 = 47821;
const PREFS_FILE: &str = "mcp.json";
const ACTIVITY_LIMIT: usize = 40;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct McpPrefs {
    pub enabled: bool,
    pub port: u16,
    /// Generate and delete keys, install a public key on a host.
    pub allow_keys: bool,
    /// Add, edit and remove hosts.
    pub allow_hosts: bool,
    /// Run shell commands on hosts.
    pub allow_exec: bool,
    /// Browse, read and write files over SFTP.
    pub allow_files: bool,
    /// Ask in a native dialog before anything that changes a server.
    pub confirm_actions: bool,
}

impl Default for McpPrefs {
    fn default() -> Self {
        Self {
            enabled: false,
            port: DEFAULT_PORT,
            allow_keys: false,
            allow_hosts: false,
            allow_exec: false,
            allow_files: false,
            confirm_actions: true,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpActivity {
    pub at: i64,
    pub tool: String,
    pub target: Option<String>,
    pub outcome: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub prefs: McpPrefs,
    pub running: bool,
    pub url: Option<String>,
    pub token: Option<String>,
    pub last_error: Option<String>,
    pub activity: Vec<McpActivity>,
}

#[derive(Default)]
struct Runtime {
    shutdown: Option<oneshot::Sender<()>>,
    port: Option<u16>,
    last_error: Option<String>,
}

pub struct McpServer {
    path: PathBuf,
    prefs: Mutex<McpPrefs>,
    runtime: Mutex<Runtime>,
    activity: Mutex<VecDeque<McpActivity>>,
    token: Mutex<Option<String>>,
}

impl McpServer {
    pub fn new(app: &AppHandle) -> anyhow::Result<Self> {
        let dir = app.path().app_data_dir()?;
        fs::create_dir_all(&dir)?;
        let path = dir.join(PREFS_FILE);
        let prefs = fs::read(&path)
            .ok()
            .and_then(|data| serde_json::from_slice::<McpPrefs>(&data).ok())
            .unwrap_or_default();
        Ok(Self {
            path,
            prefs: Mutex::new(prefs),
            runtime: Mutex::new(Runtime::default()),
            activity: Mutex::new(VecDeque::new()),
            token: Mutex::new(None),
        })
    }

    pub fn prefs(&self) -> McpPrefs {
        self.prefs.lock().clone()
    }

    pub fn record(&self, tool: &str, target: Option<String>, outcome: &str) {
        let mut log = self.activity.lock();
        if log.len() >= ACTIVITY_LIMIT {
            log.pop_back();
        }
        log.push_front(McpActivity {
            at: chrono::Utc::now().timestamp(),
            tool: tool.to_string(),
            target,
            outcome: outcome.to_string(),
        });
    }

    /// The bearer token, created on first use and kept in the OS keychain.
    pub fn token(&self) -> anyhow::Result<String> {
        let mut cached = self.token.lock();
        if let Some(token) = cached.as_ref() {
            return Ok(token.clone());
        }
        let token = match crate::keys::get_mcp_token()? {
            Some(token) if !token.is_empty() => token,
            _ => {
                let token = new_token();
                crate::keys::store_mcp_token(&token)?;
                token
            }
        };
        *cached = Some(token.clone());
        Ok(token)
    }

    fn regenerate_token(&self) -> anyhow::Result<String> {
        let token = new_token();
        crate::keys::store_mcp_token(&token)?;
        *self.token.lock() = Some(token.clone());
        Ok(token)
    }

    fn persist(&self, prefs: &McpPrefs) -> Result<(), String> {
        let temporary = self.path.with_extension("pending.json");
        fs::write(
            &temporary,
            serde_json::to_vec(prefs).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        fs::rename(&temporary, &self.path).map_err(|e| e.to_string())
    }

    fn stop(&self) {
        let mut runtime = self.runtime.lock();
        if let Some(shutdown) = runtime.shutdown.take() {
            let _ = shutdown.send(());
        }
        runtime.port = None;
    }

    /// Brings the listener in line with the saved preferences.
    pub fn apply(&self, app: &AppHandle) {
        let prefs = self.prefs();
        let running_port = self.runtime.lock().port;
        if running_port.is_some() && (!prefs.enabled || running_port != Some(prefs.port)) {
            self.stop();
        }
        if !prefs.enabled || self.runtime.lock().port.is_some() {
            if !prefs.enabled {
                self.runtime.lock().last_error = None;
            }
            return;
        }
        let result = bind_with_retry(prefs.port);
        let listener = match result {
            Ok(listener) => listener,
            Err(error) => {
                self.runtime.lock().last_error = Some(format!(
                    "Could not listen on 127.0.0.1:{}: {error}. Pick another port.",
                    prefs.port
                ));
                return;
            }
        };
        let (shutdown, stop) = oneshot::channel();
        {
            let mut runtime = self.runtime.lock();
            runtime.shutdown = Some(shutdown);
            runtime.port = Some(prefs.port);
            runtime.last_error = None;
        }
        let app = app.clone();
        tauri::async_runtime::spawn(http::serve(app, listener, prefs.port, stop));
    }

    pub fn status(&self) -> McpStatus {
        let prefs = self.prefs();
        let runtime = self.runtime.lock();
        let running = runtime.port.is_some();
        let (token, token_error) = if prefs.enabled {
            match self.token() {
                Ok(token) => (Some(token), None),
                Err(error) => (
                    None,
                    Some(format!("Could not read the access token: {error}")),
                ),
            }
        } else {
            (None, None)
        };
        McpStatus {
            url: runtime
                .port
                .map(|port| format!("http://127.0.0.1:{port}/mcp")),
            running,
            token,
            last_error: runtime.last_error.clone().or(token_error),
            activity: self.activity.lock().iter().cloned().collect(),
            prefs,
        }
    }
}

/// A listener that was just shut down may take a moment to release its port.
fn bind_with_retry(port: u16) -> std::io::Result<std::net::TcpListener> {
    let mut attempts = 0;
    loop {
        match std::net::TcpListener::bind(("127.0.0.1", port)) {
            Ok(listener) => {
                listener.set_nonblocking(true)?;
                return Ok(listener);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AddrInUse && attempts < 8 => {
                attempts += 1;
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(error) => return Err(error),
        }
    }
}

fn new_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    format!("azl_{}", hex::encode(bytes))
}

/// Called once at startup, after the database and key storage exist.
pub fn init(app: &AppHandle) -> anyhow::Result<()> {
    let server = McpServer::new(app)?;
    app.manage(server);
    app.state::<McpServer>().apply(app);
    Ok(())
}

#[tauri::command]
pub fn mcp_status(server: State<'_, McpServer>) -> McpStatus {
    server.status()
}

#[tauri::command]
pub fn mcp_set_prefs(
    app: AppHandle,
    server: State<'_, McpServer>,
    prefs: McpPrefs,
) -> Result<McpStatus, String> {
    if prefs.port < 1024 {
        return Err("Pick a port between 1024 and 65535.".into());
    }
    server.persist(&prefs)?;
    *server.prefs.lock() = prefs;
    server.apply(&app);
    Ok(server.status())
}

#[tauri::command]
pub fn mcp_regenerate_token(server: State<'_, McpServer>) -> Result<McpStatus, String> {
    server.regenerate_token().map_err(|e| e.to_string())?;
    Ok(server.status())
}

/// Finds the `claude` CLI. A desktop app often starts without the shell's
/// PATH, so the usual install folders are checked as well.
fn find_claude() -> Option<PathBuf> {
    let names: &[&str] = if cfg!(windows) {
        &["claude.exe", "claude.cmd"]
    } else {
        &["claude"]
    };
    let mut folders: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default();
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        let home = PathBuf::from(home);
        folders.push(home.join(".local").join("bin"));
        folders.push(home.join(".claude").join("local"));
        folders.push(home.join(".npm-global").join("bin"));
        folders.push(home.join(".bun").join("bin"));
        if let Ok(versions) = fs::read_dir(home.join(".nvm").join("versions").join("node")) {
            folders.extend(versions.flatten().map(|v| v.path().join("bin")));
        }
    }
    folders.extend(["/usr/local/bin", "/opt/homebrew/bin"].map(PathBuf::from));
    folders
        .iter()
        .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
        .find(|candidate| candidate.is_file())
}

/// Registers this server with Claude Code for the current user, replacing an
/// older "azalea" entry (for example after a token change).
#[tauri::command]
pub async fn mcp_connect_claude_code(server: State<'_, McpServer>) -> Result<String, String> {
    let status = server.status();
    let (Some(url), Some(token)) = (status.url, status.token) else {
        return Err("Turn on AI tools first.".into());
    };
    let claude = find_claude().ok_or_else(|| {
        "Claude Code was not found on this computer. Install it, or use Copy Claude Code command."
            .to_string()
    })?;
    tauri::async_runtime::spawn_blocking(move || {
        let run = |args: &[&str]| {
            std::process::Command::new(&claude)
                .args(args)
                .stdin(std::process::Stdio::null())
                .output()
        };
        let _ = run(&["mcp", "remove", "azalea", "--scope", "user"]);
        let header = format!("Authorization: Bearer {token}");
        let output = run(&[
            "mcp",
            "add",
            "--scope",
            "user",
            "--transport",
            "http",
            "azalea",
            &url,
            "--header",
            &header,
        ])
        .map_err(|error| format!("Could not run Claude Code: {error}"))?;
        if output.status.success() {
            Ok("Added to Claude Code. Start a new Claude Code session to use it.".to_string())
        } else {
            let text = String::from_utf8_lossy(&output.stderr);
            let text = text.trim();
            Err(if text.is_empty() {
                "Claude Code could not add the server.".to_string()
            } else {
                format!("Claude Code said: {text}")
            })
        }
    })
    .await
    .map_err(|error| error.to_string())?
}
