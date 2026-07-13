use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use russh::client;
use russh::{Channel, ChannelMsg, Disconnect};
use russh_sftp::client::SftpSession;
use ssh_key::{HashAlg, PublicKey};
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::keys::{get_host_password, load_key_pair};
use crate::models::{
    ConnectionLogEvent, FileEntry, Host, HostKeyMismatchEvent, KnownHostRecord, PortForward,
    SftpListResult, TerminalOutputEvent, TerminalStatusEvent,
};
use crate::store::SharedDatabase;

pub struct SshClientHandler {
    db: SharedDatabase,
    app: AppHandle,
    session_id: String,
    hostname: String,
    port: i64,
    key_mismatch: Arc<parking_lot::Mutex<bool>>,
}

#[async_trait]
impl client::Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let key_type = server_public_key.algorithm().to_string();
        let public_key = server_public_key
            .to_openssh()
            .unwrap_or_default();
        let fingerprint = server_public_key.fingerprint(HashAlg::Sha256).to_string();

        let existing = {
            let db = self.db.lock();
            db.get_known_host(&self.hostname, self.port).ok().flatten()
        };

        match existing {
            None => {
                let record = KnownHostRecord {
                    hostname: self.hostname.clone(),
                    port: self.port,
                    key_type,
                    public_key,
                    fingerprint: fingerprint.clone(),
                    created_at: chrono::Utc::now().timestamp(),
                };
                let db = self.db.lock();
                let _ = db.upsert_known_host(&record);
                Ok(true)
            }
            Some(known) if known.fingerprint == fingerprint => Ok(true),
            Some(known) => {
                *self.key_mismatch.lock() = true;
                let _ = self.app.emit(
                    "host-key-mismatch",
                    HostKeyMismatchEvent {
                        session_id: self.session_id.clone(),
                        hostname: self.hostname.clone(),
                        port: self.port,
                        key_type,
                        old_fingerprint: known.fingerprint,
                        new_fingerprint: fingerprint,
                        public_key,
                    },
                );
                Ok(false)
            }
        }
    }
}

struct ActiveSession {
    generation: u64,
    input_tx: mpsc::Sender<Vec<u8>>,
    resize_tx: mpsc::Sender<(u32, u32)>,
    cancel_tx: Option<oneshot::Sender<()>>,
    handle: Option<Arc<client::Handle<SshClientHandler>>>,
    sftp: Option<Arc<SftpSession>>,
    forwards: HashMap<String, JoinHandle<()>>,
}

pub struct SshSessionManager {
    pending_hosts: HashMap<String, Host>,
    session_hosts: HashMap<String, Host>,
    sessions: HashMap<String, ActiveSession>,
    next_generation: u64,
}

impl SshSessionManager {
    pub fn new() -> Self {
        Self {
            pending_hosts: HashMap::new(),
            session_hosts: HashMap::new(),
            sessions: HashMap::new(),
            next_generation: 0,
        }
    }

    pub fn prepare(&mut self, db: SharedDatabase, host_id: String) -> anyhow::Result<String> {
        let host = {
            let db = db.lock();
            db.get_host(&host_id)?
                .ok_or_else(|| anyhow::anyhow!("Host not found"))?
        };

        let session_id = Uuid::new_v4().to_string();
        self.pending_hosts.insert(session_id.clone(), host.clone());
        self.session_hosts.insert(session_id.clone(), host);
        Ok(session_id)
    }

    pub async fn start(
        &mut self,
        app: AppHandle,
        db: SharedDatabase,
        manager: SharedSshSessionManager,
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
            .or_else(|| self.session_hosts.get(&session_id).cloned())
            .ok_or_else(|| anyhow::anyhow!("Session not prepared"))?;

        self.session_hosts.insert(session_id.clone(), host.clone());
        self.spawn_session(app, db, manager, session_id, host, cols, rows)
    }

    pub async fn reconnect(
        &mut self,
        app: AppHandle,
        db: SharedDatabase,
        manager: SharedSshSessionManager,
        session_id: String,
        cols: u32,
        rows: u32,
    ) -> anyhow::Result<()> {
        self.remove_session(&session_id);

        let host = self
            .session_hosts
            .get(&session_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        self.spawn_session(app, db, manager, session_id, host, cols, rows)
    }

    fn spawn_session(
        &mut self,
        app: AppHandle,
        db: SharedDatabase,
        manager: SharedSshSessionManager,
        session_id: String,
        host: Host,
        cols: u32,
        rows: u32,
    ) -> anyhow::Result<()> {
        emit_status(&app, &session_id, "connecting", None);

        let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>(256);
        let (resize_tx, resize_rx) = mpsc::channel::<(u32, u32)>(16);
        let (cancel_tx, cancel_rx) = oneshot::channel();

        self.next_generation += 1;
        let generation = self.next_generation;

        self.sessions.insert(
            session_id.clone(),
            ActiveSession {
                generation,
                input_tx,
                resize_tx,
                cancel_tx: Some(cancel_tx),
                handle: None,
                sftp: None,
                forwards: HashMap::new(),
            },
        );

        let sid = session_id.clone();
        let app_handle = app.clone();
        tokio::spawn(async move {
            let key_mismatch = Arc::new(parking_lot::Mutex::new(false));
            let result = run_session(
                app_handle.clone(),
                db,
                manager.clone(),
                sid.clone(),
                generation,
                host,
                cols,
                rows,
                input_rx,
                resize_rx,
                cancel_rx,
                key_mismatch.clone(),
            )
            .await;

            manager.lock().await.on_session_ended(&sid, generation);

            if let Err(err) = result {
                let message = if *key_mismatch.lock() {
                    "HOST_KEY_CHANGED".to_string()
                } else {
                    err.to_string()
                };
                let _ = app_handle.emit(
                    "terminal-status",
                    TerminalStatusEvent {
                        session_id: sid.clone(),
                        status: "error".to_string(),
                        error: Some(message),
                    },
                );
            }
        });

        Ok(())
    }

    pub fn set_session_handle(
        &mut self,
        session_id: &str,
        generation: u64,
        handle: Arc<client::Handle<SshClientHandler>>,
    ) {
        if let Some(session) = self.sessions.get_mut(session_id) {
            if session.generation == generation {
                session.handle = Some(handle);
            }
        }
    }

    pub fn on_session_ended(&mut self, session_id: &str, generation: u64) {
        let matches = self
            .sessions
            .get(session_id)
            .map(|s| s.generation == generation)
            .unwrap_or(false);
        if matches {
            self.remove_session(session_id);
        }
    }

    fn remove_session(&mut self, session_id: &str) {
        if let Some(mut session) = self.sessions.remove(session_id) {
            for (_, task) in session.forwards.drain() {
                task.abort();
            }
            if let Some(cancel_tx) = session.cancel_tx.take() {
                let _ = cancel_tx.send(());
            }
        }
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
        self.remove_session(session_id);
        self.pending_hosts.remove(session_id);
        self.session_hosts.remove(session_id);
    }

    pub fn session_handle(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Arc<client::Handle<SshClientHandler>>> {
        self.sessions
            .get(session_id)
            .and_then(|s| s.handle.clone())
            .ok_or_else(|| anyhow::anyhow!("Session not connected"))
    }

    pub fn cached_sftp(&self, session_id: &str) -> Option<Arc<SftpSession>> {
        self.sessions.get(session_id).and_then(|s| s.sftp.clone())
    }

    pub fn store_sftp(&mut self, session_id: &str, sftp: Arc<SftpSession>) {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.sftp = Some(sftp);
        }
    }

    pub fn clear_sftp(&mut self, session_id: &str) {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.sftp = None;
        }
    }

    pub fn register_forward(
        &mut self,
        session_id: &str,
        forward_id: &str,
        task: JoinHandle<()>,
    ) -> anyhow::Result<()> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;
        if let Some(old) = session.forwards.insert(forward_id.to_string(), task) {
            old.abort();
        }
        Ok(())
    }

    pub fn stop_forward(&mut self, session_id: &str, forward_id: &str) {
        if let Some(session) = self.sessions.get_mut(session_id) {
            if let Some(task) = session.forwards.remove(forward_id) {
                task.abort();
            }
        }
    }

    pub fn active_forwards(&self, session_id: &str) -> Vec<String> {
        self.sessions
            .get(session_id)
            .map(|s| s.forwards.keys().cloned().collect())
            .unwrap_or_default()
    }
}

pub async fn open_sftp(
    manager: &SharedSshSessionManager,
    session_id: &str,
) -> anyhow::Result<Arc<SftpSession>> {
    let (cached, handle) = {
        let mgr = manager.lock().await;
        (mgr.cached_sftp(session_id), mgr.session_handle(session_id))
    };

    if let Some(sftp) = cached {
        return Ok(sftp);
    }

    let handle = handle?;
    let channel = handle.channel_open_session().await?;
    channel.request_subsystem(true, "sftp").await?;
    let sftp = Arc::new(SftpSession::new(channel.into_stream()).await?);

    manager
        .lock()
        .await
        .store_sftp(session_id, sftp.clone());
    Ok(sftp)
}

pub async fn sftp_list_dir(
    manager: &SharedSshSessionManager,
    session_id: &str,
    path: Option<String>,
) -> anyhow::Result<SftpListResult> {
    let result = async {
        let sftp = open_sftp(manager, session_id).await?;
        let path = match path.clone() {
            Some(p) if !p.is_empty() => p,
            _ => sftp.canonicalize(".").await?,
        };

        let mut entries: Vec<FileEntry> = Vec::new();
        for entry in sftp.read_dir(&path).await? {
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let metadata = entry.metadata();
            entries.push(FileEntry {
                name,
                is_dir: entry.file_type().is_dir(),
                size: metadata.size.unwrap_or(0),
                mtime: metadata.mtime.map(|t| t as i64),
            });
        }

        entries.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        Ok::<SftpListResult, anyhow::Error>(SftpListResult { path, entries })
    }
    .await;

    if result.is_err() {
        // Cached SFTP channel may be stale after a reconnect; drop it so the
        // next call re-opens a fresh one.
        manager.lock().await.clear_sftp(session_id);
    }

    result
}

pub async fn sftp_download_file(
    manager: &SharedSshSessionManager,
    session_id: &str,
    remote_path: &str,
    local_path: &str,
) -> anyhow::Result<u64> {
    let sftp = open_sftp(manager, session_id).await?;
    let mut remote = sftp.open(remote_path).await?;
    let mut local = tokio::fs::File::create(local_path).await?;
    let bytes = tokio::io::copy(&mut remote, &mut local).await?;
    Ok(bytes)
}

pub async fn sftp_upload_file(
    manager: &SharedSshSessionManager,
    session_id: &str,
    local_path: &str,
    remote_path: &str,
) -> anyhow::Result<u64> {
    let sftp = open_sftp(manager, session_id).await?;
    let mut local = tokio::fs::File::open(local_path).await?;
    let mut remote = sftp.create(remote_path).await?;
    let bytes = tokio::io::copy(&mut local, &mut remote).await?;
    use tokio::io::AsyncWriteExt;
    remote.shutdown().await?;
    Ok(bytes)
}

pub async fn start_port_forward(
    manager: &SharedSshSessionManager,
    session_id: &str,
    forward: PortForward,
) -> anyhow::Result<()> {
    let handle = manager.lock().await.session_handle(session_id)?;

    let listener = TcpListener::bind(("127.0.0.1", forward.local_port as u16))
        .await
        .map_err(|err| anyhow::anyhow!("Cannot listen on port {}: {err}", forward.local_port))?;

    let remote_host = forward.remote_host.clone();
    let remote_port = forward.remote_port as u32;

    let task = tokio::spawn(async move {
        loop {
            let Ok((mut tcp, peer)) = listener.accept().await else {
                break;
            };
            let handle = handle.clone();
            let remote_host = remote_host.clone();
            tokio::spawn(async move {
                match handle
                    .channel_open_direct_tcpip(
                        remote_host,
                        remote_port,
                        peer.ip().to_string(),
                        peer.port() as u32,
                    )
                    .await
                {
                    Ok(channel) => {
                        let mut stream = channel.into_stream();
                        let _ = tokio::io::copy_bidirectional(&mut tcp, &mut stream).await;
                    }
                    Err(_) => {
                        // remote refused; drop local connection
                    }
                }
            });
        }
    });

    manager
        .lock()
        .await
        .register_forward(session_id, &forward.id, task)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn run_session(
    app: AppHandle,
    db: SharedDatabase,
    manager: SharedSshSessionManager,
    session_id: String,
    generation: u64,
    host: Host,
    mut cols: u32,
    mut rows: u32,
    mut input_rx: mpsc::Receiver<Vec<u8>>,
    mut resize_rx: mpsc::Receiver<(u32, u32)>,
    mut cancel_rx: oneshot::Receiver<()>,
    key_mismatch: Arc<parking_lot::Mutex<bool>>,
) -> anyhow::Result<()> {
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(std::time::Duration::from_secs(3600)),
        ..Default::default()
    });

    let addr = format!("{}:{}", host.hostname, host.port);
    emit_log(&app, &session_id, &format!("Connecting to {addr} as {}...", host.username));

    let handler = SshClientHandler {
        db,
        app: app.clone(),
        session_id: session_id.clone(),
        hostname: host.hostname.clone(),
        port: host.port,
        key_mismatch,
    };

    let mut session = match client::connect(config, &addr, handler).await {
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

    let session = Arc::new(session);

    emit_log(&app, &session_id, "Opening shell...");
    let mut channel = session.channel_open_session().await?;
    request_pty(&mut channel, cols, rows).await?;
    channel.request_shell(false).await?;
    emit_log(&app, &session_id, "Shell ready");

    manager
        .lock()
        .await
        .set_session_handle(&session_id, generation, session.clone());

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
        "none" => anyhow::bail!("No credentials configured for host"),
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
