use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use russh::client;
use russh::{Channel, ChannelMsg, Disconnect};
use ssh_key::PublicKey;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;

use crate::keys::{get_host_password, load_key_pair};
use crate::models::{ConnectionLogEvent, Host, TerminalOutputEvent, TerminalStatusEvent};
use crate::store::SharedDatabase;

struct SshClientHandler;

#[async_trait]
impl client::Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

struct ActiveSession {
    input_tx: mpsc::Sender<Vec<u8>>,
    resize_tx: mpsc::Sender<(u32, u32)>,
    cancel_tx: Option<oneshot::Sender<()>>,
}

pub struct SshSessionManager {
    pending_hosts: HashMap<String, Host>,
    sessions: HashMap<String, ActiveSession>,
}

impl SshSessionManager {
    pub fn new() -> Self {
        Self {
            pending_hosts: HashMap::new(),
            sessions: HashMap::new(),
        }
    }

    pub fn prepare(&mut self, db: SharedDatabase, host_id: String) -> anyhow::Result<String> {
        let host = {
            let db = db.lock();
            db.get_host(&host_id)?
                .ok_or_else(|| anyhow::anyhow!("Host not found"))?
        };

        let session_id = Uuid::new_v4().to_string();
        self.pending_hosts.insert(session_id.clone(), host);
        Ok(session_id)
    }

    pub async fn start(
        &mut self,
        app: AppHandle,
        session_id: String,
        cols: u32,
        rows: u32,
    ) -> anyhow::Result<()> {
        if self.sessions.contains_key(&session_id) {
            return Ok(());
        }

        let host = self
            .pending_hosts
            .remove(&session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not prepared"))?;

        emit_status(&app, &session_id, "connecting", None);

        let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>(256);
        let (resize_tx, resize_rx) = mpsc::channel::<(u32, u32)>(16);
        let (cancel_tx, cancel_rx) = oneshot::channel();

        self.sessions.insert(
            session_id.clone(),
            ActiveSession {
                input_tx,
                resize_tx,
                cancel_tx: Some(cancel_tx),
            },
        );

        let sid = session_id.clone();
        let app_handle = app.clone();
        tokio::spawn(async move {
            let result = run_session(
                app_handle.clone(),
                sid.clone(),
                host,
                cols,
                rows,
                input_rx,
                resize_rx,
                cancel_rx,
            )
            .await;

            if let Err(err) = result {
                let _ = app_handle.emit(
                    "terminal-status",
                    TerminalStatusEvent {
                        session_id: sid.clone(),
                        status: "error".to_string(),
                        error: Some(err.to_string()),
                    },
                );
            }
        });

        Ok(())
    }

    pub async fn write(&self, session_id: &str, data: Vec<u8>) -> anyhow::Result<()> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;
        session
            .input_tx
            .send(data)
            .await
            .map_err(|_| anyhow::anyhow!("Failed to send input to session"))?;
        Ok(())
    }

    pub async fn resize(&self, session_id: &str, cols: u32, rows: u32) -> anyhow::Result<()> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;
        session
            .resize_tx
            .send((cols, rows))
            .await
            .map_err(|_| anyhow::anyhow!("Failed to resize session"))?;
        Ok(())
    }

    pub fn disconnect(&mut self, session_id: &str) {
        if let Some(session) = self.sessions.remove(session_id) {
            if let Some(cancel_tx) = session.cancel_tx {
                let _ = cancel_tx.send(());
            }
        }
        self.pending_hosts.remove(session_id);
    }
}

async fn run_session(
    app: AppHandle,
    session_id: String,
    host: Host,
    mut cols: u32,
    mut rows: u32,
    mut input_rx: mpsc::Receiver<Vec<u8>>,
    mut resize_rx: mpsc::Receiver<(u32, u32)>,
    mut cancel_rx: oneshot::Receiver<()>,
) -> anyhow::Result<()> {
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(std::time::Duration::from_secs(3600)),
        ..Default::default()
    });

    let addr = format!("{}:{}", host.hostname, host.port);
    emit_log(&app, &session_id, &format!("Connecting to {addr} as {}...", host.username));

    let mut session = match client::connect(config, &addr, SshClientHandler).await {
        Ok(s) => {
            emit_log(&app, &session_id, "TCP connection established");
            s
        }
        Err(err) => {
            let msg = format!("Could not reach host: {err}");
            emit_log(&app, &session_id, &msg);
            anyhow::bail!(msg);
        }
    };

    emit_log(
        &app,
        &session_id,
        &format!(
            "Authenticating ({})...",
            if host.auth_type == "key" {
                "SSH key"
            } else {
                "password"
            }
        ),
    );
    if let Err(err) = authenticate(&mut session, &host).await {
        emit_log(&app, &session_id, &format!("Authentication failed: {err}"));
        return Err(err);
    }
    emit_log(&app, &session_id, "Authentication successful");

    emit_log(&app, &session_id, "Opening shell...");
    let mut channel = session.channel_open_session().await?;
    request_pty(&mut channel, cols, rows).await?;
    channel.request_shell(false).await?;
    emit_log(&app, &session_id, "Shell ready");

    emit_status(&app, &session_id, "connected", None);

    loop {
        tokio::select! {
            _ = &mut cancel_rx => {
                break;
            }
            maybe_msg = channel.wait() => {
                match maybe_msg {
                    Some(ChannelMsg::Data { data }) => {
                        emit_output(&app, &session_id, data.as_ref());
                    }
                    Some(ChannelMsg::ExtendedData { data, .. }) => {
                        emit_output(&app, &session_id, data.as_ref());
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                        break;
                    }
                    Some(ChannelMsg::ExitStatus { .. }) => {
                        break;
                    }
                    _ => {}
                }
            }
            maybe_input = input_rx.recv() => {
                match maybe_input {
                    Some(data) => {
                        channel.data(&data[..]).await?;
                    }
                    None => break,
                }
            }
            maybe_resize = resize_rx.recv() => {
                if let Some((new_cols, new_rows)) = maybe_resize {
                    cols = new_cols;
                    rows = new_rows;
                    channel.window_change(cols, rows, 0, 0).await?;
                }
            }
        }
    }

    let _ = session
        .disconnect(Disconnect::ByApplication, "Session closed", "en")
        .await;

    emit_status(&app, &session_id, "disconnected", None);
    Ok(())
}

fn emit_output(app: &AppHandle, session_id: &str, data: &[u8]) {
    let encoded = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        data,
    );
    let _ = app.emit(
        "terminal-output",
        TerminalOutputEvent {
            session_id: session_id.to_string(),
            data: encoded,
        },
    );
}

async fn authenticate(
    session: &mut client::Handle<SshClientHandler>,
    host: &Host,
) -> anyhow::Result<()> {
    match host.auth_type.as_str() {
        "password" => {
            let password = get_host_password(&host.id)?
                .ok_or_else(|| anyhow::anyhow!("Password not found for host"))?;
            let ok = session
                .authenticate_password(&host.username, &password)
                .await?;
            if !ok {
                anyhow::bail!("Password authentication failed");
            }
        }
        "key" => {
            let key_id = host
                .key_id
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("No key configured for host"))?;
            let key_pair = load_key_pair(key_id)?;
            let ok = session
                .authenticate_publickey(&host.username, Arc::new(key_pair))
                .await?;
            if !ok {
                anyhow::bail!("Public key authentication failed");
            }
        }
        other => anyhow::bail!("Unsupported auth type: {other}"),
    }

    Ok(())
}

async fn request_pty(
    channel: &mut Channel<client::Msg>,
    cols: u32,
    rows: u32,
) -> anyhow::Result<()> {
    channel
        .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
        .await?;
    Ok(())
}

fn emit_log(app: &AppHandle, session_id: &str, message: &str) {
    let _ = app.emit(
        "connection-log",
        ConnectionLogEvent {
            session_id: session_id.to_string(),
            message: message.to_string(),
        },
    );
}

fn emit_status(app: &AppHandle, session_id: &str, status: &str, error: Option<String>) {
    let _ = app.emit(
        "terminal-status",
        TerminalStatusEvent {
            session_id: session_id.to_string(),
            status: status.to_string(),
            error,
        },
    );
}

pub type SharedSshSessionManager = Arc<tokio::sync::Mutex<SshSessionManager>>;

pub fn init_session_manager() -> SharedSshSessionManager {
    Arc::new(tokio::sync::Mutex::new(SshSessionManager::new()))
}
