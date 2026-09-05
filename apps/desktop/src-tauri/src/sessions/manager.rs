use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
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

use crate::keys::{get_host_password, load_key_pair, public_key_identity};
use crate::models::{
    ConnectionLogEvent, FileEntry, Host, HostKeyMismatchEvent, HostKeyUnknownEvent,
    HostOsUpdatedEvent, InstallPublicKeyResult, KnownHostRecord, PortForward, PortForwardStatus,
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

/// How long the handshake waits for the user to accept an unknown host key.
const HOST_KEY_PROMPT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

type HostKeyDecisions = parking_lot::Mutex<HashMap<String, oneshot::Sender<bool>>>;
type PendingMismatches = parking_lot::Mutex<HashMap<String, KnownHostRecord>>;

fn host_key_decisions() -> &'static HostKeyDecisions {
    static DECISIONS: std::sync::OnceLock<HostKeyDecisions> = std::sync::OnceLock::new();
    DECISIONS.get_or_init(Default::default)
}

fn pending_mismatches() -> &'static PendingMismatches {
    static PENDING: std::sync::OnceLock<PendingMismatches> = std::sync::OnceLock::new();
    PENDING.get_or_init(Default::default)
}

/// Answers a pending "unknown host key" prompt. Returns false when no prompt
/// is waiting, so the frontend cannot approve keys out of band.
pub fn resolve_host_key_prompt(session_id: &str, accept: bool) -> bool {
    let sender = host_key_decisions().lock().remove(session_id);
    match sender {
        Some(tx) => tx.send(accept).is_ok(),
        None => false,
    }
}

/// Consumes the host key recorded when a mismatch was reported, so trusting a
/// key is only possible for a mismatch this session actually saw.
pub fn take_pending_mismatch(session_id: &str) -> Option<KnownHostRecord> {
    pending_mismatches().lock().remove(session_id)
}

fn clear_host_key_state(session_id: &str) {
    host_key_decisions().lock().remove(session_id);
    pending_mismatches().lock().remove(session_id);
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
                    key_type: key_type.clone(),
                    public_key: public_key.clone(),
                    fingerprint: fingerprint.clone(),
                    created_at: chrono::Utc::now().timestamp(),
                };

                let (tx, rx) = oneshot::channel();
                host_key_decisions()
                    .lock()
                    .insert(self.session_id.clone(), tx);

                let emitted = self.app.emit(
                    "host-key-unknown",
                    HostKeyUnknownEvent {
                        session_id: self.session_id.clone(),
                        hostname: self.hostname.clone(),
                        port: self.port,
                        key_type,
                        fingerprint,
                        public_key,
                    },
                );
                if emitted.is_err() {
                    clear_host_key_state(&self.session_id);
                    return Ok(false);
                }

                let accepted = match tokio::time::timeout(HOST_KEY_PROMPT_TIMEOUT, rx).await {
                    Ok(Ok(accepted)) => accepted,
                    _ => false,
                };
                clear_host_key_state(&self.session_id);

                if !accepted {
                    return Ok(false);
                }

                let db = self.db.lock();
                let _ = db.upsert_known_host(&record);
                Ok(true)
            }
            Some(known) if known.fingerprint == fingerprint => Ok(true),
            Some(known) => {
                *self.key_mismatch.lock() = true;
                pending_mismatches().lock().insert(
                    self.session_id.clone(),
                    KnownHostRecord {
                        hostname: self.hostname.clone(),
                        port: self.port,
                        key_type: key_type.clone(),
                        public_key: public_key.clone(),
                        fingerprint: fingerprint.clone(),
                        created_at: chrono::Utc::now().timestamp(),
                    },
                );
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
    forwards: HashMap<String, ForwardRuntime>,
}

struct ForwardRuntime {
    forward_id: String,
    label: String,
    local_port: i64,
    remote_host: String,
    remote_port: i64,
    task: JoinHandle<()>,
    connections: Arc<AtomicUsize>,
    listening: Arc<AtomicBool>,
    last_error: Arc<parking_lot::Mutex<Option<String>>>,
}

impl ForwardRuntime {
    fn to_status(&self, session_id: &str) -> PortForwardStatus {
        let connections = self.connections.load(Ordering::SeqCst) as u32;
        let listening = self.listening.load(Ordering::SeqCst);
        let error = self.last_error.lock().clone();
        let state = if !listening {
            "failed"
        } else if connections > 0 {
            "connected"
        } else {
            "listening"
        };
        PortForwardStatus {
            session_id: session_id.to_string(),
            forward_id: self.forward_id.clone(),
            label: self.label.clone(),
            local_port: self.local_port,
            remote_host: self.remote_host.clone(),
            remote_port: self.remote_port,
            state: state.to_string(),
            connections,
            error,
        }
    }
}

fn emit_forward_status(app: &AppHandle, status: &PortForwardStatus) {
    let _ = app.emit("port-forward-status", status.clone());
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
            for (_, runtime) in session.forwards.drain() {
                runtime.listening.store(false, Ordering::SeqCst);
                runtime.task.abort();
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

    fn register_forward(
        &mut self,
        session_id: &str,
        runtime: ForwardRuntime,
    ) -> anyhow::Result<()> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;
        let forward_id = runtime.forward_id.clone();
        if let Some(old) = session.forwards.insert(forward_id, runtime) {
            old.listening.store(false, Ordering::SeqCst);
            old.task.abort();
        }
        Ok(())
    }

    pub fn stop_forward(
        &mut self,
        session_id: &str,
        forward_id: &str,
    ) -> Option<PortForwardStatus> {
        let session = self.sessions.get_mut(session_id)?;
        let runtime = session.forwards.remove(forward_id)?;
        runtime.listening.store(false, Ordering::SeqCst);
        runtime.task.abort();
        let mut status = runtime.to_status(session_id);
        status.state = "stopped".to_string();
        status.connections = 0;
        status.error = None;
        Some(status)
    }

    pub fn active_forwards(&self, session_id: &str) -> Vec<PortForwardStatus> {
        self.sessions
            .get(session_id)
            .map(|s| {
                s.forwards
                    .values()
                    .map(|runtime| runtime.to_status(session_id))
                    .collect()
            })
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

const SFTP_TEXT_MAX_BYTES: u64 = 2 * 1024 * 1024;

pub async fn sftp_read_text_file(
    manager: &SharedSshSessionManager,
    session_id: &str,
    remote_path: &str,
) -> anyhow::Result<String> {
    use tokio::io::AsyncReadExt;

    let sftp = open_sftp(manager, session_id).await?;
    let remote = sftp.open(remote_path).await?;
    let mut buf = Vec::new();
    remote
        .take(SFTP_TEXT_MAX_BYTES + 1)
        .read_to_end(&mut buf)
        .await?;
    if buf.len() as u64 > SFTP_TEXT_MAX_BYTES {
        anyhow::bail!("File is larger than 2 MB — open it locally instead");
    }
    String::from_utf8(buf).map_err(|_| anyhow::anyhow!("File is not valid UTF-8 text"))
}

pub async fn sftp_write_text_file(
    manager: &SharedSshSessionManager,
    session_id: &str,
    remote_path: &str,
    contents: &str,
) -> anyhow::Result<u64> {
    use tokio::io::AsyncWriteExt;

    if contents.len() as u64 > SFTP_TEXT_MAX_BYTES {
        anyhow::bail!("Content exceeds 2 MB limit");
    }
    let sftp = open_sftp(manager, session_id).await?;
    let mut remote = sftp.create(remote_path).await?;
    remote.write_all(contents.as_bytes()).await?;
    remote.shutdown().await?;
    Ok(contents.len() as u64)
}

pub async fn start_port_forward(
    app: AppHandle,
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
    let connections = Arc::new(AtomicUsize::new(0));
    let listening = Arc::new(AtomicBool::new(true));
    let last_error: Arc<parking_lot::Mutex<Option<String>>> =
        Arc::new(parking_lot::Mutex::new(None));

    let session_id_task = session_id.to_string();
    let forward_id = forward.id.clone();
    let label = forward.label.clone();
    let local_port = forward.local_port;
    let remote_host_status = forward.remote_host.clone();
    let remote_port_status = forward.remote_port;
    let connections_loop = connections.clone();
    let listening_loop = listening.clone();
    let last_error_loop = last_error.clone();
    let app_loop = app.clone();

    let make_status = {
        let session_id = session_id_task.clone();
        let forward_id = forward_id.clone();
        let label = label.clone();
        let remote_host_status = remote_host_status.clone();
        let connections = connections.clone();
        let listening = listening.clone();
        let last_error = last_error.clone();
        move || {
            let n = connections.load(Ordering::SeqCst) as u32;
            let is_listening = listening.load(Ordering::SeqCst);
            let error = last_error.lock().clone();
            let state = if !is_listening {
                "failed"
            } else if n > 0 {
                "connected"
            } else {
                "listening"
            };
            PortForwardStatus {
                session_id: session_id.clone(),
                forward_id: forward_id.clone(),
                label: label.clone(),
                local_port,
                remote_host: remote_host_status.clone(),
                remote_port: remote_port_status,
                state: state.to_string(),
                connections: n,
                error,
            }
        }
    };

    emit_forward_status(&app, &make_status());

    let task = tokio::spawn(async move {
        loop {
            let Ok((mut tcp, peer)) = listener.accept().await else {
                listening_loop.store(false, Ordering::SeqCst);
                *last_error_loop.lock() =
                    Some("Listener closed unexpectedly".to_string());
                emit_forward_status(&app_loop, &{
                    let n = connections_loop.load(Ordering::SeqCst) as u32;
                    PortForwardStatus {
                        session_id: session_id_task.clone(),
                        forward_id: forward_id.clone(),
                        label: label.clone(),
                        local_port,
                        remote_host: remote_host_status.clone(),
                        remote_port: remote_port_status,
                        state: "failed".to_string(),
                        connections: n,
                        error: last_error_loop.lock().clone(),
                    }
                });
                break;
            };

            let handle = handle.clone();
            let remote_host = remote_host.clone();
            let connections = connections_loop.clone();
            let listening = listening_loop.clone();
            let last_error = last_error_loop.clone();
            let app = app_loop.clone();
            let session_id = session_id_task.clone();
            let forward_id = forward_id.clone();
            let label = label.clone();
            let remote_host_status = remote_host_status.clone();

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
                        *last_error.lock() = None;
                        connections.fetch_add(1, Ordering::SeqCst);
                        let n = connections.load(Ordering::SeqCst) as u32;
                        emit_forward_status(
                            &app,
                            &PortForwardStatus {
                                session_id: session_id.clone(),
                                forward_id: forward_id.clone(),
                                label: label.clone(),
                                local_port,
                                remote_host: remote_host_status.clone(),
                                remote_port: remote_port_status,
                                state: "connected".to_string(),
                                connections: n,
                                error: None,
                            },
                        );

                        let mut stream = channel.into_stream();
                        let _ = tokio::io::copy_bidirectional(&mut tcp, &mut stream).await;

                        let prev = connections.fetch_sub(1, Ordering::SeqCst);
                        let n = prev.saturating_sub(1) as u32;
                        if listening.load(Ordering::SeqCst) {
                            emit_forward_status(
                                &app,
                                &PortForwardStatus {
                                    session_id,
                                    forward_id,
                                    label,
                                    local_port,
                                    remote_host: remote_host_status,
                                    remote_port: remote_port_status,
                                    state: if n > 0 {
                                        "connected".to_string()
                                    } else {
                                        "listening".to_string()
                                    },
                                    connections: n,
                                    error: last_error.lock().clone(),
                                },
                            );
                        }
                    }
                    Err(err) => {
                        let message = format!("Remote tunnel failed: {err}");
                        *last_error.lock() = Some(message.clone());
                        if listening.load(Ordering::SeqCst) {
                            let n = connections.load(Ordering::SeqCst) as u32;
                            emit_forward_status(
                                &app,
                                &PortForwardStatus {
                                    session_id,
                                    forward_id,
                                    label,
                                    local_port,
                                    remote_host: remote_host_status,
                                    remote_port: remote_port_status,
                                    state: if n > 0 {
                                        "connected".to_string()
                                    } else {
                                        "listening".to_string()
                                    },
                                    connections: n,
                                    error: Some(message),
                                },
                            );
                        }
                    }
                }
            });
        }
    });

    let abort_handle = task.abort_handle();
    let runtime = ForwardRuntime {
        forward_id: forward.id.clone(),
        label: forward.label.clone(),
        local_port: forward.local_port,
        remote_host: forward.remote_host.clone(),
        remote_port: forward.remote_port,
        task,
        connections,
        listening: listening.clone(),
        last_error,
    };

    if let Err(err) = manager.lock().await.register_forward(session_id, runtime) {
        listening.store(false, Ordering::SeqCst);
        abort_handle.abort();
        return Err(err);
    }
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
        db: db.clone(),
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

    let auth_label = match (
        host.key_id.is_some(),
        get_host_password(&host.id).ok().flatten().is_some(),
    ) {
        (true, true) => "SSH key, password fallback",
        (true, false) => "SSH key",
        (false, true) => "password",
        (false, false) => "no credentials",
    };
    emit_log(
        &app,
        &session_id,
        &format!("Authenticating ({auth_label})..."),
    );
    if let Err(err) = authenticate(&mut session, &host).await {
        emit_log(&app, &session_id, &format!("Authentication failed: {err}"));
        return Err(err);
    }
    emit_log(&app, &session_id, "Authentication successful");

    let session = Arc::new(session);

    if let Some(os_id) = detect_remote_os(&session).await {
        if host.os_id.as_deref() != Some(os_id.as_str()) {
            if db.lock().set_host_os_id(&host.id, &os_id).is_ok() {
                let _ = app.emit(
                    "host-os-updated",
                    HostOsUpdatedEvent {
                        host_id: host.id.clone(),
                        os_id,
                    },
                );
            }
        }
    }

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
    let mut errors: Vec<String> = Vec::new();

    if let Some(key_id) = host.key_id.as_ref() {
        match load_key_pair(key_id) {
            Ok(key_pair) => {
                let ok = session
                    .authenticate_publickey(&host.username, Arc::new(key_pair))
                    .await?;
                if ok {
                    return Ok(());
                }
                errors.push("Public key authentication failed".to_string());
            }
            Err(err) => errors.push(format!("Could not load SSH key: {err}")),
        }
    }

    if let Some(password) = get_host_password(&host.id)? {
        let ok = session
            .authenticate_password(&host.username, &password)
            .await?;
        if ok {
            return Ok(());
        }
        errors.push("Password authentication failed".to_string());
    }

    if errors.is_empty() {
        anyhow::bail!("No credentials configured for host");
    }
    anyhow::bail!(errors.join("; "));
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

async fn detect_remote_os(session: &client::Handle<SshClientHandler>) -> Option<String> {
    let mut channel = session.channel_open_session().await.ok()?;
    channel
        .exec(
            true,
            "if [ -d /etc/pve ] || command -v pveversion >/dev/null 2>&1; then echo 'ID=proxmox'; fi; cat /etc/os-release 2>/dev/null; sw_vers -productName 2>/dev/null; uname -s",
        )
        .await
        .ok()?;

    let mut buf = Vec::new();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(4);
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match tokio::time::timeout(remaining, channel.wait()).await {
            Ok(Some(ChannelMsg::Data { ref data })) => buf.extend_from_slice(data),
            Ok(Some(ChannelMsg::ExtendedData { ref data, .. })) => buf.extend_from_slice(data),
            Ok(Some(ChannelMsg::Eof))
            | Ok(Some(ChannelMsg::Close))
            | Ok(Some(ChannelMsg::ExitStatus { .. }))
            | Ok(None) => break,
            Ok(Some(_)) => {}
            Err(_) => break,
        }
    }

    if buf.is_empty() {
        return None;
    }
    parse_os_id(&String::from_utf8_lossy(&buf))
}

fn parse_os_id(raw: &str) -> Option<String> {
    let lower = raw.to_ascii_lowercase();
    // Proxmox VE is Debian-based; detect before falling through to ID=debian.
    if lower.contains("id=proxmox")
        || lower.lines().any(|l| {
            let t = l.trim_start();
            t.starts_with("pretty_name=") && t.contains("proxmox")
        })
    {
        return Some("proxmox".into());
    }

    let mut id: Option<String> = None;
    let mut id_like: Option<String> = None;

    for line in raw.lines() {
        let line = line.trim();
        if let Some(value) = line.strip_prefix("ID=") {
            id = Some(value.trim_matches('"').trim().to_ascii_lowercase());
        } else if let Some(value) = line.strip_prefix("ID_LIKE=") {
            id_like = Some(value.trim_matches('"').trim().to_ascii_lowercase());
        }
    }

    if let Some(id) = id {
        return Some(normalize_os_id(&id));
    }
    if let Some(id_like) = id_like {
        for token in id_like.split_whitespace() {
            let normalized = normalize_os_id(token);
            if normalized != "linux" {
                return Some(normalized);
            }
        }
    }

    if lower.contains("mac os") || lower.contains("macos") || lower.contains("darwin") {
        return Some("macos".into());
    }
    if lower.contains("freebsd") {
        return Some("freebsd".into());
    }
    if lower.contains("openbsd") {
        return Some("openbsd".into());
    }
    if lower.contains("windows") || lower.contains("mingw") || lower.contains("msys") {
        return Some("windows".into());
    }
    if lower.contains("linux") {
        return Some("linux".into());
    }
    None
}

fn normalize_os_id(id: &str) -> String {
    match id {
        "ubuntu" => "ubuntu",
        "debian" => "debian",
        "fedora" => "fedora",
        "arch" | "archarm" | "endeavouros" | "manjaro" | "garuda" => "arch",
        "centos" => "centos",
        "rhel" | "redhat" => "rhel",
        "rocky" => "rocky",
        "almalinux" | "alma" => "alma",
        "opensuse" | "opensuse-leap" | "opensuse-tumbleweed" | "sles" | "suse" => "opensuse",
        "alpine" => "alpine",
        "pop" | "pop-os" => "pop",
        "linuxmint" | "mint" => "mint",
        "kali" => "kali",
        "amzn" | "amazon" | "amazonlinux" => "amazon",
        "raspbian" | "raspberrypi" | "raspios" => "raspberry",
        "gentoo" => "gentoo",
        "void" => "void",
        "nixos" => "nixos",
        "nobara" => "nobara",
        "proxmox" | "pve" => "proxmox",
        other => other,
    }
    .to_string()
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

/// One-shot SSH + SFTP install of a public key into `~/.ssh/authorized_keys`.
/// Skips the write when the key blob is already present.
pub async fn install_authorized_key(
    app: AppHandle,
    db: SharedDatabase,
    host: Host,
    public_key_openssh: &str,
) -> anyhow::Result<InstallPublicKeyResult> {
    let identity = public_key_identity(public_key_openssh)
        .ok_or_else(|| anyhow::anyhow!("Invalid public key format"))?;
    let pubkey_line = public_key_openssh
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with('#'))
        .ok_or_else(|| anyhow::anyhow!("Public key is empty"))?
        .to_string();

    if host.auth_type == "none" {
        anyhow::bail!(
            "Host has no login method. Add a password or another SSH key first, then install this public key."
        );
    }

    let config = Arc::new(client::Config {
        inactivity_timeout: Some(std::time::Duration::from_secs(60)),
        ..Default::default()
    });

    let addr = format!("{}:{}", host.hostname, host.port);
    let session_id = format!("install-key-{}", Uuid::new_v4());
    let key_mismatch = Arc::new(parking_lot::Mutex::new(false));

    let handler = SshClientHandler {
        db,
        app,
        session_id: session_id.clone(),
        hostname: host.hostname.clone(),
        port: host.port,
        key_mismatch: key_mismatch.clone(),
    };

    let mut session = client::connect(config, &addr, handler)
        .await
        .map_err(|err| anyhow::anyhow!("Could not reach host: {err}"))?;

    if *key_mismatch.lock() {
        anyhow::bail!("Host key mismatch — trust the new key from a normal connection first.");
    }

    authenticate(&mut session, &host).await?;

    let channel = session.channel_open_session().await?;
    channel.request_subsystem(true, "sftp").await?;
    let sftp = SftpSession::new(channel.into_stream()).await?;

    let home = sftp
        .canonicalize(".")
        .await
        .map_err(|err| anyhow::anyhow!("Could not resolve home directory: {err}"))?;
    let ssh_dir = format!("{home}/.ssh");
    let auth_keys_path = format!("{ssh_dir}/authorized_keys");

    if !sftp.try_exists(&ssh_dir).await.unwrap_or(false) {
        sftp.create_dir(&ssh_dir)
            .await
            .map_err(|err| anyhow::anyhow!("Could not create ~/.ssh: {err}"))?;
    }

    let existing = if sftp.try_exists(&auth_keys_path).await.unwrap_or(false) {
        String::from_utf8(sftp.read(&auth_keys_path).await.unwrap_or_default())
            .unwrap_or_default()
    } else {
        String::new()
    };

    let already_present = existing.lines().any(|line| {
        public_key_identity(line)
            .map(|id| id == identity)
            .unwrap_or(false)
    });

    if already_present {
        let _ = session
            .disconnect(Disconnect::ByApplication, "Key already present", "en")
            .await;
        return Ok(InstallPublicKeyResult {
            status: "already_present".to_string(),
            message: format!(
                "Public key already on {}@{} — nothing to change.",
                host.username, host.hostname
            ),
        });
    }

    let mut next = existing;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    next.push_str(&pubkey_line);
    next.push('\n');

    use tokio::io::AsyncWriteExt;
    {
        let mut file = sftp
            .create(&auth_keys_path)
            .await
            .map_err(|err| anyhow::anyhow!("Could not write authorized_keys: {err}"))?;
        file.write_all(next.as_bytes()).await?;
        file.shutdown().await?;
    }

    let _ = session
        .disconnect(Disconnect::ByApplication, "Key installed", "en")
        .await;

    Ok(InstallPublicKeyResult {
        status: "installed".to_string(),
        message: format!(
            "Public key added to {}@{}:~/.ssh/authorized_keys",
            host.username, host.hostname
        ),
    })
}

pub type SharedSshSessionManager = Arc<tokio::sync::Mutex<SshSessionManager>>;

pub fn init_session_manager() -> SharedSshSessionManager {
    Arc::new(tokio::sync::Mutex::new(SshSessionManager::new()))
}
