use super::manager::{authenticate, strict_ssh_preferences};
use crate::{models::Host, store::SharedDatabase};
use futures_util::{stream, StreamExt};
use russh::keys::{HashAlg, PublicKeyOrCertificate};
use russh::{client, ChannelMsg};
use serde::Serialize;
use std::{collections::HashMap, sync::Arc};
use tauri::ipc::Channel as IpcChannel;
use tokio::sync::watch;

const MAX_OUTPUT: usize = 1024 * 1024;
const CONCURRENCY: usize = 4;

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BatchEvent {
    Complete,
    Started {
        host_id: String,
    },
    Output {
        host_id: String,
        text: String,
        stderr: bool,
    },
    Finished {
        host_id: String,
        status: String,
        exit_code: Option<u32>,
        error: Option<String>,
    },
}

type BatchCancels = parking_lot::Mutex<HashMap<String, watch::Sender<bool>>>;

fn cancels() -> &'static BatchCancels {
    static CANCELS: std::sync::OnceLock<BatchCancels> = std::sync::OnceLock::new();
    CANCELS.get_or_init(Default::default)
}

struct BatchRegistration(String);

impl Drop for BatchRegistration {
    fn drop(&mut self) {
        cancels().lock().remove(&self.0);
    }
}

pub fn cancel_all_batches() {
    for cancel in cancels().lock().values() {
        let _ = cancel.send(true);
    }
}

#[tauri::command]
pub fn cancel_batch_command(batch_id: String) -> Result<(), String> {
    if let Some(cancel) = cancels().lock().get(&batch_id) {
        let _ = cancel.send(true);
    }
    Ok(())
}

fn validate(
    host_ids: &[String],
    command: &str,
    timeout_seconds: Option<u64>,
) -> Result<(), String> {
    if host_ids.is_empty() || host_ids.len() > 100 {
        return Err("Select between 1 and 100 hosts.".into());
    }
    if command.trim().is_empty() || command.len() > 65536 || command.contains('\0') {
        return Err("Enter a command of at most 64 KiB without null characters.".into());
    }
    if timeout_seconds.is_some_and(|seconds| !(60..=604800).contains(&seconds)) {
        return Err("Timeout must be between 1 and 10080 minutes, or disabled.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn run_batch_command(
    db: tauri::State<'_, SharedDatabase>,
    batch_id: String,
    host_ids: Vec<String>,
    command: String,
    timeout_seconds: Option<u64>,
    on_event: IpcChannel<BatchEvent>,
) -> Result<(), String> {
    validate(&host_ids, &command, timeout_seconds)?;
    let (cancel, cancelled) = watch::channel(false);
    {
        let mut active = cancels().lock();
        if !active.is_empty() {
            return Err("Another batch is still running.".into());
        }
        active.insert(batch_id.clone(), cancel);
    }
    let _registration = BatchRegistration(batch_id);
    let hosts = {
        let db = db.lock();
        let mut seen = std::collections::HashSet::new();
        let mut hosts = Vec::new();
        for id in &host_ids {
            if seen.insert(id) {
                let host = db
                    .get_host(id)
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| format!("Host {id} no longer exists."))?;
                let fingerprint = db
                    .get_known_host(&host.hostname, host.port)
                    .map_err(|e| e.to_string())?
                    .map(|known| known.fingerprint);
                hosts.push((host, fingerprint));
            }
        }
        hosts
    };
    run_targets(hosts, command, timeout_seconds, &on_event, cancelled).await;
    on_event
        .send(BatchEvent::Complete)
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn run_targets(
    hosts: Vec<(Host, Option<String>)>,
    command: String,
    timeout_seconds: Option<u64>,
    on_event: &IpcChannel<BatchEvent>,
    cancelled: watch::Receiver<bool>,
) {
    stream::iter(hosts.into_iter().map(|(host, fingerprint)| {
        let command = command.clone();
        let events = on_event.clone();
        let mut cancelled = cancelled.clone();
        async move {
            let host_id = host.id.clone();
            let finish = |status: &str, exit_code, error| {
                let _ = events.send(BatchEvent::Finished {
                    host_id: host_id.clone(), status: status.into(), exit_code, error,
                });
            };
            if *cancelled.borrow() {
                finish("cancelled", None, None);
                return;
            }
            if events.send(BatchEvent::Started { host_id: host_id.clone() }).is_err() {
                return;
            }
            let operation = execute(host, fingerprint, command, events.clone());
            tokio::pin!(operation);
            tokio::select! {
                biased;
                _ = cancelled.changed() => finish("cancelled", None, None),
                result = wait_for_command(timeout_seconds, &mut operation) => {
                    match result {
                        Err(_) => finish("timed_out", None, Some(format!("Timed out after {} seconds. The remote process may still be running.", timeout_seconds.unwrap_or_default()))),
                        Ok(Err(err)) => finish("failed", None, Some(err.to_string())),
                        Ok(Ok(code)) => finish(if code == 0 { "succeeded" } else { "failed" }, Some(code), None),
                    }
                }
            }
        }
    })).buffer_unordered(CONCURRENCY).collect::<Vec<_>>().await;
}

async fn wait_for_command<F: std::future::Future>(
    timeout_seconds: Option<u64>,
    command: F,
) -> Result<F::Output, tokio::time::error::Elapsed> {
    match timeout_seconds {
        Some(seconds) => {
            tokio::time::timeout(std::time::Duration::from_secs(seconds), command).await
        }
        None => Ok(command.await),
    }
}

fn batch_ssh_config() -> client::Config {
    client::Config {
        inactivity_timeout: None,
        preferred: strict_ssh_preferences(),
        ..Default::default()
    }
}

struct BatchHandler {
    fingerprint: String,
}

impl client::Handler for BatchHandler {
    type Error = russh::Error;
    async fn check_server_key(
        &mut self,
        key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        Ok(key.public_key().fingerprint(HashAlg::Sha256).to_string() == self.fingerprint)
    }
}

async fn execute(
    host: Host,
    fingerprint: Option<String>,
    command: String,
    events: IpcChannel<BatchEvent>,
) -> anyhow::Result<u32> {
    let fingerprint = fingerprint.ok_or_else(|| {
        anyhow::anyhow!("Server key is not trusted yet. Connect normally first to verify it.")
    })?;
    let config = Arc::new(batch_ssh_config());
    let handler = BatchHandler { fingerprint };
    let mut session = client::connect(config, (host.hostname.as_str(), host.port as u16), handler)
        .await
        .map_err(|err| {
            anyhow::anyhow!(
                "SSH connection failed: {err}. Connect normally first to verify the server key."
            )
        })?;
    authenticate(&mut session, &host).await?;
    execute_command(&session, &host.id, &command, &events).await
}

async fn execute_command<H: client::Handler>(
    session: &client::Handle<H>,
    host_id: &str,
    command: &str,
    events: &IpcChannel<BatchEvent>,
) -> anyhow::Result<u32> {
    let mut channel = session.channel_open_session().await?;
    channel.exec(true, command.as_bytes()).await?;
    channel.eof().await?;
    let mut exit_code = None;
    let mut output_bytes = 0;
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    while let Some(message) = channel.wait().await {
        match message {
            ChannelMsg::Data { data } => forward_output(
                events,
                host_id,
                &data,
                false,
                &mut stdout,
                &mut output_bytes,
            )?,
            ChannelMsg::ExtendedData { data, .. } => {
                forward_output(events, host_id, &data, true, &mut stderr, &mut output_bytes)?
            }
            ChannelMsg::ExitStatus { exit_status } => exit_code = Some(exit_status),
            ChannelMsg::Failure => anyhow::bail!("The server rejected the command request."),
            ChannelMsg::ExitSignal { signal_name, .. } => {
                anyhow::bail!("Remote process ended with signal {signal_name:?}")
            }
            ChannelMsg::Close => break,
            _ => {}
        }
    }
    for (pending, is_stderr) in [(&stdout, false), (&stderr, true)] {
        if !pending.is_empty() {
            let _ = events.send(BatchEvent::Output {
                host_id: host_id.to_string(),
                text: String::from_utf8_lossy(pending).into_owned(),
                stderr: is_stderr,
            });
        }
    }
    exit_code.ok_or_else(|| {
        anyhow::anyhow!("Connection closed without an exit status; execution outcome is unknown.")
    })
}

fn forward_output(
    events: &IpcChannel<BatchEvent>,
    host_id: &str,
    data: &[u8],
    stderr: bool,
    pending: &mut Vec<u8>,
    total: &mut usize,
) -> anyhow::Result<()> {
    *total += data.len();
    if *total > MAX_OUTPUT {
        anyhow::bail!("Output exceeded 1 MiB. The remote process may still be running.");
    }
    pending.extend_from_slice(data);
    let length = match std::str::from_utf8(pending) {
        Ok(_) => pending.len(),
        Err(error) if error.error_len().is_none() => error.valid_up_to(),
        Err(_) => pending.len(),
    };
    if length > 0 {
        events
            .send(BatchEvent::Output {
                host_id: host_id.into(),
                text: String::from_utf8_lossy(&pending[..length]).into_owned(),
                stderr,
            })
            .map_err(|_| anyhow::anyhow!("Batch window is no longer available."))?;
        pending.drain(..length);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event_sink() -> (
        IpcChannel<BatchEvent>,
        Arc<parking_lot::Mutex<Vec<serde_json::Value>>>,
    ) {
        let messages = Arc::new(parking_lot::Mutex::new(Vec::new()));
        let captured = messages.clone();
        let channel = IpcChannel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                captured.lock().push(serde_json::from_str(&json).unwrap());
            }
            Ok(())
        });
        (channel, messages)
    }

    #[test]
    fn output_preserves_split_unicode_and_bounds_memory() {
        let (events, messages) = event_sink();
        let mut pending = Vec::new();
        let mut total = 0;
        for byte in "café 🦀".as_bytes() {
            forward_output(&events, "host", &[*byte], false, &mut pending, &mut total).unwrap();
        }
        let output: String = messages
            .lock()
            .iter()
            .map(|message| message["text"].as_str().unwrap())
            .collect();
        assert_eq!(output, "café 🦀");
        assert!(pending.is_empty());
        assert!(forward_output(
            &events,
            "host",
            &vec![b'a'; MAX_OUTPUT],
            false,
            &mut pending,
            &mut total
        )
        .is_err());
        assert!(pending.is_empty());
    }

    struct TestServer;

    impl russh::server::Handler for TestServer {
        type Error = russh::Error;
        async fn auth_password(
            &mut self,
            _: &str,
            _: &str,
        ) -> Result<russh::server::Auth, Self::Error> {
            Ok(russh::server::Auth::Accept)
        }
        async fn channel_open_session(
            &mut self,
            _: russh::Channel<russh::server::Msg>,
            reply: russh::server::ChannelOpenHandle,
            _: &mut russh::server::Session,
        ) -> Result<(), Self::Error> {
            reply.accept().await;
            Ok(())
        }
        async fn exec_request(
            &mut self,
            channel: russh::ChannelId,
            command: &[u8],
            session: &mut russh::server::Session,
        ) -> Result<(), Self::Error> {
            if command == b"reject" {
                session.channel_failure(channel)?;
                return Ok(());
            }
            session.channel_success(channel)?;
            session.data(channel, b"first\n".as_slice())?;
            if command == b"missing-status" {
                session.close(channel)?;
                return Ok(());
            }
            session.extended_data(channel, 1, b"warning\n".as_slice())?;
            session.exit_status_request(channel, 7)?;
            session.data(channel, b"after-status\n".as_slice())?;
            session.eof(channel)?;
            session.close(channel)?;
            Ok(())
        }
    }

    async fn test_connection() -> client::Handle<BatchHandler> {
        let key = russh::keys::PrivateKey::random(
            &mut russh::keys::key::safe_rng(),
            russh::keys::Algorithm::Ed25519,
        )
        .unwrap();
        let fingerprint = key.public_key().fingerprint(HashAlg::Sha256).to_string();
        let config = Arc::new(russh::server::Config {
            keys: vec![key],
            ..Default::default()
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            let session = russh::server::run_stream(config, socket, TestServer)
                .await
                .unwrap();
            let _ = session.await;
        });
        let mut session = client::connect(
            Arc::new(client::Config {
                preferred: strict_ssh_preferences(),
                ..Default::default()
            }),
            addr,
            BatchHandler { fingerprint },
        )
        .await
        .unwrap();
        assert!(session
            .authenticate_password("test", "test")
            .await
            .unwrap()
            .success());
        session
    }

    #[tokio::test]
    async fn ssh_exec_keeps_output_after_exit_status_and_reports_nonzero_exit() {
        let session = test_connection().await;
        let (events, messages) = event_sink();
        let code = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            execute_command(&session, "host", "test", &events),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(code, 7);
        let messages = messages.lock();
        assert!(messages
            .iter()
            .any(|event| event["text"] == "warning\n" && event["stderr"] == true));
        assert!(messages
            .iter()
            .any(|event| event["text"] == "after-status\n"));
    }

    #[tokio::test]
    async fn missing_exit_status_is_an_unknown_outcome() {
        let session = test_connection().await;
        let (events, _) = event_sink();
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            execute_command(&session, "host", "missing-status", &events),
        )
        .await
        .unwrap();
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("outcome is unknown"));
    }

    #[tokio::test]
    async fn rejected_exec_fails_without_waiting_for_timeout() {
        let session = test_connection().await;
        let (events, _) = event_sink();
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            execute_command(&session, "host", "reject", &events),
        )
        .await
        .unwrap();
        assert!(result.unwrap_err().to_string().contains("rejected"));
    }

    #[tokio::test]
    async fn batch_handler_rejects_another_server_key() {
        let key = russh::keys::PrivateKey::random(
            &mut russh::keys::key::safe_rng(),
            russh::keys::Algorithm::Ed25519,
        )
        .unwrap();
        let public_key = PublicKeyOrCertificate::from(key.public_key().clone());
        let mut handler = BatchHandler {
            fingerprint: "untrusted".into(),
        };
        assert!(
            !client::Handler::check_server_key(&mut handler, &public_key)
                .await
                .unwrap()
        );
        handler.fingerprint = key.public_key().fingerprint(HashAlg::Sha256).to_string();
        assert!(client::Handler::check_server_key(&mut handler, &public_key)
            .await
            .unwrap());
    }

    fn test_host(id: usize, port: u16) -> Host {
        Host {
            id: id.to_string(),
            name: id.to_string(),
            hostname: "127.0.0.1".into(),
            port: port.into(),
            username: "test".into(),
            auth_type: "none".into(),
            key_id: None,
            group_id: None,
            mac_address: None,
            os_id: None,
            last_connected_at: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[tokio::test]
    async fn cancellation_stops_active_hosts_and_never_starts_queued_hosts() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let hosts = (0..6)
            .map(|id| (test_host(id, port), Some("trusted".into())))
            .collect();
        let messages = Arc::new(parking_lot::Mutex::new(Vec::<serde_json::Value>::new()));
        let captured = messages.clone();
        let (cancel, cancelled) = watch::channel(false);
        let events = IpcChannel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                let event: serde_json::Value = serde_json::from_str(&json).unwrap();
                let mut messages = captured.lock();
                messages.push(event);
                if messages
                    .iter()
                    .filter(|event| event["kind"] == "started")
                    .count()
                    == CONCURRENCY
                {
                    let _ = cancel.send(true);
                }
            }
            Ok(())
        });
        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            run_targets(hosts, "uptime".into(), None, &events, cancelled),
        )
        .await
        .unwrap();
        let messages = messages.lock();
        assert_eq!(
            messages
                .iter()
                .filter(|event| event["kind"] == "started")
                .count(),
            CONCURRENCY
        );
        assert_eq!(
            messages
                .iter()
                .filter(|event| event["status"] == "cancelled")
                .count(),
            6
        );
    }

    #[tokio::test]
    async fn silent_handshake_times_out_without_blocking_other_results() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let hosts = vec![
            (test_host(0, port), Some("trusted".into())),
            (test_host(1, port), None),
        ];
        let (_cancel, cancelled) = watch::channel(false);
        let (events, messages) = event_sink();
        tokio::time::timeout(
            std::time::Duration::from_secs(7),
            run_targets(hosts, "uptime".into(), Some(1), &events, cancelled),
        )
        .await
        .unwrap();
        let messages = messages.lock();
        assert!(messages
            .iter()
            .any(|event| event["host_id"] == "0" && event["status"] == "timed_out"));
        assert!(messages
            .iter()
            .any(|event| event["host_id"] == "1" && event["status"] == "failed"));
    }

    #[test]
    fn rejects_invalid_batches_before_connecting() {
        let hosts = vec!["host".into()];
        assert!(validate(&[], "uptime", Some(60)).is_err());
        assert!(validate(&vec!["host".into(); 101], "uptime", Some(60)).is_err());
        assert!(validate(&hosts, " \n", Some(60)).is_err());
        assert!(validate(&hosts, "echo\0bad", Some(60)).is_err());
        assert!(validate(&hosts, &"a".repeat(65537), Some(60)).is_err());
        assert!(validate(&hosts, "uptime", Some(0)).is_err());
        assert!(validate(&hosts, "uptime", Some(604801)).is_err());
        assert!(validate(&hosts, "uptime\ndf -h", Some(60)).is_ok());
        assert!(validate(&hosts, "uptime", None).is_ok());
        assert!(validate(&hosts, "uptime", Some(3600)).is_ok());
        assert!(validate(&hosts, "uptime", Some(604800)).is_ok());
    }

    #[tokio::test]
    async fn disabled_timeout_has_no_deadline_or_ssh_inactivity_limit() {
        assert!(batch_ssh_config().inactivity_timeout.is_none());
        let result = wait_for_command(None, async {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            42
        })
        .await
        .unwrap();
        assert_eq!(result, 42);
        assert!(wait_for_command(Some(0), std::future::pending::<()>())
            .await
            .is_err());
    }

    #[test]
    fn account_and_session_cleanup_cancel_registered_batches() {
        let id = uuid::Uuid::new_v4().to_string();
        let (cancel, cancelled) = watch::channel(false);
        cancels().lock().insert(id.clone(), cancel);
        {
            let _registration = BatchRegistration(id.clone());
            cancel_all_batches();
            assert!(*cancelled.borrow());
        }
        assert!(!cancels().lock().contains_key(&id));
    }
}
