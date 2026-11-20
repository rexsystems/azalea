//! MCP protocol handling and the tools Azalea exposes.

use std::time::Duration;

use russh::{ChannelMsg, Disconnect};
use russh_sftp::client::SftpSession;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

use super::{McpPrefs, McpServer};
use crate::models::Host;
use crate::sessions::batch::connect_trusted;
use crate::store::SharedDatabase;

const SUPPORTED_VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_COMMAND_OUTPUT: usize = 256 * 1024;
const MAX_FILE_READ: u64 = 1024 * 1024;
const MAX_FILE_WRITE: usize = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT: u64 = 60;
const MAX_TIMEOUT: u64 = 900;
const CONFIRM_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Clone, Copy, PartialEq)]
enum Group {
    Read,
    Keys,
    Hosts,
    Exec,
    Files,
}

impl Group {
    fn allowed(self, prefs: &McpPrefs) -> bool {
        match self {
            Group::Read => true,
            Group::Keys => prefs.allow_keys,
            Group::Hosts => prefs.allow_hosts,
            Group::Exec => prefs.allow_exec,
            Group::Files => prefs.allow_files,
        }
    }

    fn switch_name(self) -> &'static str {
        match self {
            Group::Read => "read",
            Group::Keys => "SSH keys",
            Group::Hosts => "Hosts",
            Group::Exec => "Run commands",
            Group::Files => "Files",
        }
    }
}

struct Tool {
    name: &'static str,
    group: Group,
    description: &'static str,
    read_only: bool,
    destructive: bool,
    schema: fn() -> Value,
}

fn object(properties: Value, required: &[&str]) -> Value {
    json!({ "type": "object", "properties": properties, "required": required })
}

fn tool_table() -> Vec<Tool> {
    vec![
        Tool {
            name: "list_hosts",
            group: Group::Read,
            description: "List the SSH hosts saved in Azalea (id, name, address, user, key, group, and whether the server key is trusted). Use the id with other tools.",
            read_only: true,
            destructive: false,
            schema: || object(json!({}), &[]),
        },
        Tool {
            name: "list_groups",
            group: Group::Read,
            description: "List the host groups saved in Azalea.",
            read_only: true,
            destructive: false,
            schema: || object(json!({}), &[]),
        },
        Tool {
            name: "list_keys",
            group: Group::Read,
            description: "List the SSH keys in Azalea with their public key and fingerprint. Private keys are never returned.",
            read_only: true,
            destructive: false,
            schema: || object(json!({}), &[]),
        },
        Tool {
            name: "list_snippets",
            group: Group::Read,
            description: "List the saved command snippets.",
            read_only: true,
            destructive: false,
            schema: || object(json!({}), &[]),
        },
        Tool {
            name: "generate_key",
            group: Group::Keys,
            description: "Create a new SSH key pair inside Azalea. The private key stays in Azalea's secure storage. Returns the id and the public key.",
            read_only: false,
            destructive: false,
            schema: || {
                object(
                    json!({
                        "name": { "type": "string", "description": "Label for the key, e.g. \"deploy-prod\"." },
                        "algorithm": { "type": "string", "enum": ["ed25519", "rsa-2048", "rsa-3072", "rsa-4096", "ecdsa-p256", "ecdsa-p384", "ecdsa-p521"], "description": "Defaults to ed25519." }
                    }),
                    &["name"],
                )
            },
        },
        Tool {
            name: "install_public_key",
            group: Group::Keys,
            description: "Add a key's public half to ~/.ssh/authorized_keys on a host, logging in with the host's current credentials. Does nothing if it is already there.",
            read_only: false,
            destructive: false,
            schema: || {
                object(
                    json!({
                        "key_id": { "type": "string" },
                        "host_id": { "type": "string" }
                    }),
                    &["key_id", "host_id"],
                )
            },
        },
        Tool {
            name: "delete_key",
            group: Group::Keys,
            description: "Delete an SSH key from Azalea. Always asks the user to confirm in Azalea.",
            read_only: false,
            destructive: true,
            schema: || object(json!({ "key_id": { "type": "string" } }), &["key_id"]),
        },
        Tool {
            name: "add_host",
            group: Group::Hosts,
            description: "Save a new SSH host. Passwords are not accepted here; use a key (generate_key, then install_public_key).",
            read_only: false,
            destructive: false,
            schema: || {
                object(
                    json!({
                        "name": { "type": "string" },
                        "hostname": { "type": "string", "description": "DNS name or IP address." },
                        "port": { "type": "integer", "default": 22 },
                        "username": { "type": "string" },
                        "key_id": { "type": "string", "description": "Id of an Azalea key to log in with." },
                        "group_id": { "type": "string" }
                    }),
                    &["name", "hostname", "username"],
                )
            },
        },
        Tool {
            name: "update_host",
            group: Group::Hosts,
            description: "Change fields of a saved host. Leave a field out to keep it. Pass an empty key_id or group_id to clear it.",
            read_only: false,
            destructive: false,
            schema: || {
                object(
                    json!({
                        "host_id": { "type": "string" },
                        "name": { "type": "string" },
                        "hostname": { "type": "string" },
                        "port": { "type": "integer" },
                        "username": { "type": "string" },
                        "key_id": { "type": "string" },
                        "group_id": { "type": "string" }
                    }),
                    &["host_id"],
                )
            },
        },
        Tool {
            name: "delete_host",
            group: Group::Hosts,
            description: "Remove a saved host. Always asks the user to confirm in Azalea.",
            read_only: false,
            destructive: true,
            schema: || object(json!({ "host_id": { "type": "string" } }), &["host_id"]),
        },
        Tool {
            name: "run_command",
            group: Group::Exec,
            description: "Run one shell command on a saved host over SSH and return stdout, stderr and the exit code. The host's server key must already be trusted in Azalea (connect once from the app). Not interactive: no TTY, no stdin.",
            read_only: false,
            destructive: true,
            schema: || {
                object(
                    json!({
                        "host_id": { "type": "string" },
                        "command": { "type": "string" },
                        "timeout_seconds": { "type": "integer", "description": "Default 60, at most 900." }
                    }),
                    &["host_id", "command"],
                )
            },
        },
        Tool {
            name: "list_directory",
            group: Group::Files,
            description: "List a directory on a host over SFTP. Defaults to the login directory.",
            read_only: true,
            destructive: false,
            schema: || {
                object(
                    json!({
                        "host_id": { "type": "string" },
                        "path": { "type": "string" }
                    }),
                    &["host_id"],
                )
            },
        },
        Tool {
            name: "read_file",
            group: Group::Files,
            description: "Read a UTF-8 text file on a host over SFTP (up to 1 MiB).",
            read_only: true,
            destructive: false,
            schema: || {
                object(
                    json!({
                        "host_id": { "type": "string" },
                        "path": { "type": "string" }
                    }),
                    &["host_id", "path"],
                )
            },
        },
        Tool {
            name: "write_file",
            group: Group::Files,
            description: "Create or overwrite a text file on a host over SFTP (up to 2 MiB).",
            read_only: false,
            destructive: true,
            schema: || {
                object(
                    json!({
                        "host_id": { "type": "string" },
                        "path": { "type": "string" },
                        "content": { "type": "string" }
                    }),
                    &["host_id", "path", "content"],
                )
            },
        },
    ]
}

fn rpc_result(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// Answers one JSON-RPC message. Notifications and responses return `None`.
pub async fn handle_message(app: &AppHandle, message: Value) -> Option<Value> {
    let id = message.get("id").cloned();
    let method = message.get("method").and_then(Value::as_str)?;
    let id = match id {
        Some(id) => id,
        None => return None,
    };
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    let server = app.state::<McpServer>();

    Some(match method {
        "initialize" => {
            let asked = params
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let version = SUPPORTED_VERSIONS
                .iter()
                .find(|candidate| **candidate == asked)
                .unwrap_or(&SUPPORTED_VERSIONS[0]);
            rpc_result(
                id,
                json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": "azalea", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": "Azalea is the user's SSH client. Use list_hosts and list_keys first. Anything that changes a server may need the user to approve a dialog in the Azalea window."
                }),
            )
        }
        "ping" => rpc_result(id, json!({})),
        "tools/list" => {
            let prefs = server.prefs();
            let tools: Vec<Value> = tool_table()
                .into_iter()
                .filter(|tool| tool.group.allowed(&prefs))
                .map(|tool| {
                    json!({
                        "name": tool.name,
                        "description": tool.description,
                        "inputSchema": (tool.schema)(),
                        "annotations": {
                            "readOnlyHint": tool.read_only,
                            "destructiveHint": tool.destructive,
                            "openWorldHint": tool.group != Group::Read
                        }
                    })
                })
                .collect();
            rpc_result(id, json!({ "tools": tools }))
        }
        "tools/call" => {
            let name = params
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            let outcome = call_tool(app, &name, &args).await;
            match outcome {
                Ok(text) => rpc_result(
                    id,
                    json!({ "content": [{ "type": "text", "text": text }], "isError": false }),
                ),
                Err(ToolError::Unknown) => rpc_error(id, -32602, "Unknown tool"),
                Err(ToolError::Failed(text)) => rpc_result(
                    id,
                    json!({ "content": [{ "type": "text", "text": text }], "isError": true }),
                ),
            }
        }
        _ => rpc_error(id, -32601, "Method not found"),
    })
}

enum ToolError {
    Unknown,
    Failed(String),
}

impl<E: std::fmt::Display> From<E> for ToolError {
    fn from(error: E) -> Self {
        ToolError::Failed(error.to_string())
    }
}

fn fail<T>(message: impl Into<String>) -> Result<T, ToolError> {
    Err(ToolError::Failed(message.into()))
}

fn text_arg<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key).and_then(Value::as_str)
}

fn required<'a>(args: &'a Value, key: &str) -> Result<&'a str, ToolError> {
    match text_arg(args, key).map(str::trim) {
        Some(value) if !value.is_empty() => Ok(value),
        _ => fail(format!("Missing required argument \"{key}\".")),
    }
}

async fn call_tool(app: &AppHandle, name: &str, args: &Value) -> Result<String, ToolError> {
    let tool = tool_table()
        .into_iter()
        .find(|tool| tool.name == name)
        .ok_or(ToolError::Unknown)?;
    let server = app.state::<McpServer>();
    let prefs = server.prefs();
    if !tool.group.allowed(&prefs) {
        server.record(name, None, "blocked");
        return fail(format!(
            "The \"{}\" switch is off in Azalea (Settings, AI tools). Ask the user to turn it on.",
            tool.group.switch_name()
        ));
    }

    let target = args
        .get("host_id")
        .or_else(|| args.get("key_id"))
        .and_then(Value::as_str)
        .map(|id| describe_target(app, id));
    let result = dispatch(app, &prefs, name, args).await;
    let outcome = match &result {
        Ok(_) => "ok",
        Err(ToolError::Failed(message)) if message.starts_with("Declined") => "declined",
        Err(_) => "error",
    };
    server.record(name, target, outcome);
    result
}

fn describe_target(app: &AppHandle, id: &str) -> String {
    let db = app.state::<SharedDatabase>();
    let db = db.lock();
    if let Ok(Some(host)) = db.get_host(id) {
        return host.name;
    }
    if let Ok(Some(key)) = db.get_key(id) {
        return key.name;
    }
    id.to_string()
}

async fn dispatch(
    app: &AppHandle,
    prefs: &McpPrefs,
    name: &str,
    args: &Value,
) -> Result<String, ToolError> {
    let db = app.state::<SharedDatabase>().inner().clone();
    match name {
        "list_hosts" => list_hosts(&db),
        "list_groups" => pretty(&db.lock().list_groups()?),
        "list_keys" => pretty(&db.lock().list_keys()?),
        "list_snippets" => pretty(&db.lock().list_snippets()?),
        "generate_key" => {
            let label = required(args, "name")?;
            let key = crate::keys::generate_key(label, text_arg(args, "algorithm"))?;
            db.lock().insert_key(&key)?;
            pretty(&key)
        }
        "install_public_key" => {
            let host = load_host(&db, required(args, "host_id")?)?;
            let key = db
                .lock()
                .get_key(required(args, "key_id")?)?
                .ok_or_else(|| ToolError::Failed("SSH key not found.".into()))?;
            if prefs.confirm_actions {
                ask(
                    app,
                    "Install public key",
                    &format!(
                        "An AI tool wants to add the key \"{}\" to ~/.ssh/authorized_keys on {} ({}@{}).",
                        key.name, host.name, host.username, host.hostname
                    ),
                    "Install",
                )
                .await?;
            }
            let result = crate::sessions::install_authorized_key(
                app.clone(),
                db.clone(),
                host,
                &key.public_key,
            )
            .await?;
            pretty(&result)
        }
        "delete_key" => {
            let key = db
                .lock()
                .get_key(required(args, "key_id")?)?
                .ok_or_else(|| ToolError::Failed("SSH key not found.".into()))?;
            ask(
                app,
                "Delete SSH key",
                &format!(
                    "An AI tool wants to delete the key \"{}\" ({}). Hosts that use it will no longer be able to log in with it.",
                    key.name, key.fingerprint
                ),
                "Delete key",
            )
            .await?;
            crate::keys::delete_private_key(&key.id)?;
            db.lock().delete_key(&key.id)?;
            Ok(format!("Deleted key \"{}\".", key.name))
        }
        "add_host" => add_host(&db, args),
        "update_host" => update_host(&db, args),
        "delete_host" => {
            let host = load_host(&db, required(args, "host_id")?)?;
            ask(
                app,
                "Remove host",
                &format!(
                    "An AI tool wants to remove {} ({}@{}) from Azalea.",
                    host.name, host.username, host.hostname
                ),
                "Remove host",
            )
            .await?;
            crate::keys::delete_host_password(&host.id)?;
            db.lock().delete_host(&host.id)?;
            Ok(format!("Removed host \"{}\".", host.name))
        }
        "run_command" => {
            let host = load_host(&db, required(args, "host_id")?)?;
            let command = required(args, "command")?;
            if command.len() > 65536 || command.contains('\0') {
                return fail("Command must be at most 64 KiB without null characters.");
            }
            let timeout = args
                .get("timeout_seconds")
                .and_then(Value::as_u64)
                .unwrap_or(DEFAULT_TIMEOUT)
                .clamp(1, MAX_TIMEOUT);
            if prefs.confirm_actions {
                ask(
                    app,
                    "Run command",
                    &format!(
                        "An AI tool wants to run this on {} ({}@{}):\n\n{}",
                        host.name,
                        host.username,
                        host.hostname,
                        preview(command, 900)
                    ),
                    "Run",
                )
                .await?;
            }
            let outcome = tokio::time::timeout(
                Duration::from_secs(timeout),
                run_remote(&db, &host, command),
            )
            .await;
            match outcome {
                Ok(result) => pretty(&result?),
                Err(_) => fail(format!(
                    "Timed out after {timeout} seconds. The remote process may still be running."
                )),
            }
        }
        "list_directory" | "read_file" | "write_file" => {
            let host = load_host(&db, required(args, "host_id")?)?;
            files(app, prefs, &db, host, name, args).await
        }
        _ => Err(ToolError::Unknown),
    }
}

fn pretty<T: serde::Serialize>(value: &T) -> Result<String, ToolError> {
    Ok(serde_json::to_string_pretty(value)?)
}

fn preview(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let cut: String = text.chars().take(limit).collect();
    format!(
        "{cut}\n... ({} more characters)",
        text.chars().count() - limit
    )
}

fn load_host(db: &SharedDatabase, id: &str) -> Result<Host, ToolError> {
    db.lock()
        .get_host(id)?
        .ok_or_else(|| ToolError::Failed("Host not found. Call list_hosts for valid ids.".into()))
}

fn list_hosts(db: &SharedDatabase) -> Result<String, ToolError> {
    let db = db.lock();
    let mut rows = Vec::new();
    for host in db.list_hosts()? {
        let trusted = db.get_known_host(&host.hostname, host.port)?.is_some();
        rows.push(json!({
            "id": host.id,
            "name": host.name,
            "hostname": host.hostname,
            "port": host.port,
            "username": host.username,
            "auth_type": host.auth_type,
            "key_id": host.key_id,
            "group_id": host.group_id,
            "os": host.os_id,
            "last_connected_at": host.last_connected_at,
            "server_key_trusted": trusted,
        }));
    }
    pretty(&rows)
}

/// Host and user names end up in ~/.ssh/config and on command lines, so keep
/// them to plain characters and refuse anything that could pass as an option.
fn plain_token(value: &str, label: &str) -> Result<(), ToolError> {
    let valid = !value.is_empty()
        && value.len() <= 253
        && !value.starts_with('-')
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ':' | '@' | '%'));
    if valid {
        Ok(())
    } else {
        fail(format!(
            "{label} may only contain letters, digits and . _ - : @ % and must not start with '-'."
        ))
    }
}

fn existing_key(db: &SharedDatabase, id: &str) -> Result<(), ToolError> {
    if db.lock().get_key(id)?.is_none() {
        return fail("SSH key not found. Call list_keys for valid ids.");
    }
    Ok(())
}

fn existing_group(db: &SharedDatabase, id: &str) -> Result<(), ToolError> {
    if !db.lock().list_groups()?.iter().any(|group| group.id == id) {
        return fail("Group not found. Call list_groups for valid ids.");
    }
    Ok(())
}

fn valid_port(value: i64) -> Result<i64, ToolError> {
    if (1..=65535).contains(&value) {
        Ok(value)
    } else {
        fail("Port must be between 1 and 65535.")
    }
}

fn add_host(db: &SharedDatabase, args: &Value) -> Result<String, ToolError> {
    let hostname = required(args, "hostname")?;
    let username = required(args, "username")?;
    plain_token(hostname, "hostname")?;
    plain_token(username, "username")?;
    let port = valid_port(args.get("port").and_then(Value::as_i64).unwrap_or(22))?;
    let key_id = text_arg(args, "key_id").filter(|v| !v.is_empty());
    let group_id = text_arg(args, "group_id").filter(|v| !v.is_empty());
    if let Some(id) = key_id {
        existing_key(db, id)?;
    }
    if let Some(id) = group_id {
        existing_group(db, id)?;
    }
    let now = chrono::Utc::now().timestamp();
    let host = Host {
        id: Uuid::new_v4().to_string(),
        name: required(args, "name")?.to_string(),
        hostname: hostname.to_string(),
        port,
        username: username.to_string(),
        auth_type: if key_id.is_some() { "key" } else { "none" }.to_string(),
        key_id: key_id.map(str::to_string),
        group_id: group_id.map(str::to_string),
        mac_address: None,
        os_id: None,
        last_connected_at: None,
        created_at: now,
        updated_at: now,
    };
    db.lock().insert_host(&host)?;
    pretty(&host)
}

fn update_host(db: &SharedDatabase, args: &Value) -> Result<String, ToolError> {
    let mut host = load_host(db, required(args, "host_id")?)?;
    if let Some(name) = text_arg(args, "name")
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        host.name = name.to_string();
    }
    if let Some(hostname) = text_arg(args, "hostname") {
        plain_token(hostname, "hostname")?;
        host.hostname = hostname.to_string();
    }
    if let Some(username) = text_arg(args, "username") {
        plain_token(username, "username")?;
        host.username = username.to_string();
    }
    if let Some(port) = args.get("port").and_then(Value::as_i64) {
        host.port = valid_port(port)?;
    }
    if let Some(key_id) = text_arg(args, "key_id") {
        if key_id.is_empty() {
            host.key_id = None;
        } else {
            existing_key(db, key_id)?;
            host.key_id = Some(key_id.to_string());
        }
    }
    if let Some(group_id) = text_arg(args, "group_id") {
        if group_id.is_empty() {
            host.group_id = None;
        } else {
            existing_group(db, group_id)?;
            host.group_id = Some(group_id.to_string());
        }
    }
    let has_password = crate::keys::get_host_password(&host.id)
        .map(|p| p.is_some())
        .unwrap_or(false);
    let has_key = host.key_id.is_some();
    host.auth_type = match host.auth_type.as_str() {
        "key" if has_key => "key",
        "password" if has_password => "password",
        _ if has_key => "key",
        _ if has_password => "password",
        _ => "none",
    }
    .to_string();
    host.updated_at = chrono::Utc::now().timestamp();
    db.lock().update_host(&host)?;
    pretty(&host)
}

/// Shows a native confirmation dialog and waits for the user.
async fn ask(
    app: &AppHandle,
    title: &str,
    body: &str,
    confirm_label: &str,
) -> Result<(), ToolError> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(body.to_string())
        .title(title.to_string())
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            confirm_label.to_string(),
            "Decline".to_string(),
        ))
        .show(move |confirmed| {
            let _ = tx.send(confirmed);
        });
    match tokio::time::timeout(CONFIRM_TIMEOUT, rx).await {
        Ok(Ok(true)) => Ok(()),
        Ok(_) => fail("Declined by the user in Azalea."),
        Err(_) => fail("Declined: the user did not answer the dialog in Azalea in time."),
    }
}

async fn run_remote(db: &SharedDatabase, host: &Host, command: &str) -> anyhow::Result<Value> {
    let fingerprint = db
        .lock()
        .get_known_host(&host.hostname, host.port)?
        .map(|known| known.fingerprint);
    let session = connect_trusted(host, fingerprint).await?;
    let mut channel = session.channel_open_session().await?;
    channel.exec(true, command.as_bytes()).await?;
    channel.eof().await?;

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut exit_code = None;
    let mut signal = None;
    let mut truncated = false;
    while let Some(message) = channel.wait().await {
        match message {
            ChannelMsg::Data { data } => truncated |= append_capped(&mut stdout, &data),
            ChannelMsg::ExtendedData { data, .. } => truncated |= append_capped(&mut stderr, &data),
            ChannelMsg::ExitStatus { exit_status } => exit_code = Some(exit_status),
            ChannelMsg::ExitSignal { signal_name, .. } => signal = Some(format!("{signal_name:?}")),
            ChannelMsg::Failure => anyhow::bail!("The server rejected the command request."),
            ChannelMsg::Close => break,
            _ => {}
        }
    }
    let _ = session
        .disconnect(Disconnect::ByApplication, "", "en")
        .await;
    let _ = db.lock().touch_host_connected(&host.id);
    Ok(json!({
        "exit_code": exit_code,
        "signal": signal,
        "stdout": String::from_utf8_lossy(&stdout),
        "stderr": String::from_utf8_lossy(&stderr),
        "output_truncated": truncated,
    }))
}

/// Keeps at most MAX_COMMAND_OUTPUT bytes. Returns true when data was dropped.
fn append_capped(buffer: &mut Vec<u8>, data: &[u8]) -> bool {
    let room = MAX_COMMAND_OUTPUT.saturating_sub(buffer.len());
    buffer.extend_from_slice(&data[..data.len().min(room)]);
    data.len() > room
}

async fn files(
    app: &AppHandle,
    prefs: &McpPrefs,
    db: &SharedDatabase,
    host: Host,
    tool: &str,
    args: &Value,
) -> Result<String, ToolError> {
    let path = text_arg(args, "path").map(str::trim).unwrap_or_default();
    if path.contains('\0') {
        return fail("Path must not contain null characters.");
    }
    if tool != "list_directory" && path.is_empty() {
        return fail("Missing required argument \"path\".");
    }
    if tool == "write_file" {
        let content = text_arg(args, "content")
            .ok_or_else(|| ToolError::Failed("Missing required argument \"content\".".into()))?;
        if content.len() > MAX_FILE_WRITE {
            return fail("Content is larger than 2 MiB.");
        }
        if prefs.confirm_actions {
            ask(
                app,
                "Write file",
                &format!(
                    "An AI tool wants to write {} bytes to {path} on {} ({}@{}). An existing file will be replaced.\n\n{}",
                    content.len(),
                    host.name,
                    host.username,
                    host.hostname,
                    preview(content, 500)
                ),
                "Write file",
            )
            .await?;
        }
    }

    let fingerprint = db
        .lock()
        .get_known_host(&host.hostname, host.port)?
        .map(|known| known.fingerprint);
    let session = connect_trusted(&host, fingerprint).await?;
    let channel = session.channel_open_session().await?;
    channel.request_subsystem(true, "sftp").await?;
    let sftp = SftpSession::new(channel.into_stream()).await?;

    let result: Result<String, ToolError> = async {
        match tool {
            "list_directory" => {
                let dir = if path.is_empty() {
                    sftp.canonicalize(".").await?
                } else {
                    path.to_string()
                };
                let mut entries = Vec::new();
                for entry in sftp.read_dir(&dir).await? {
                    let name = entry.file_name();
                    if name == "." || name == ".." {
                        continue;
                    }
                    let meta = entry.metadata();
                    entries.push(json!({
                        "name": name,
                        "is_dir": entry.file_type().is_dir(),
                        "size": meta.size.unwrap_or(0),
                        "modified": meta.mtime,
                    }));
                }
                pretty(&json!({ "path": dir, "entries": entries }))
            }
            "read_file" => {
                let mut buffer = Vec::new();
                sftp.open(path)
                    .await?
                    .take(MAX_FILE_READ + 1)
                    .read_to_end(&mut buffer)
                    .await?;
                if buffer.len() as u64 > MAX_FILE_READ {
                    return fail("File is larger than 1 MiB. Use run_command with head or tail.");
                }
                String::from_utf8(buffer)
                    .map_err(|_| ToolError::Failed("File is not valid UTF-8 text.".into()))
            }
            _ => {
                let content = text_arg(args, "content").unwrap_or_default();
                let mut remote = sftp.create(path).await?;
                remote.write_all(content.as_bytes()).await?;
                remote.shutdown().await?;
                Ok(format!("Wrote {} bytes to {path}.", content.len()))
            }
        }
    }
    .await;
    let _ = session
        .disconnect(Disconnect::ByApplication, "", "en")
        .await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_names_cannot_look_like_options() {
        assert!(plain_token("-oProxyCommand=x", "hostname").is_err());
        assert!(plain_token("host name", "hostname").is_err());
        assert!(plain_token("bad#user", "username").is_err());
        assert!(plain_token("deploy@10.0.0.5", "username").is_ok());
        assert!(plain_token("srv-1.example.com", "hostname").is_ok());
    }

    #[test]
    fn output_is_capped() {
        let mut buffer = Vec::new();
        let chunk = vec![b'a'; MAX_COMMAND_OUTPUT];
        assert!(!append_capped(&mut buffer, &chunk));
        assert!(append_capped(&mut buffer, b"more"));
        assert_eq!(buffer.len(), MAX_COMMAND_OUTPUT);
    }

    #[test]
    fn every_tool_has_an_object_schema() {
        for tool in tool_table() {
            assert_eq!((tool.schema)()["type"], "object", "{}", tool.name);
        }
    }

    #[test]
    fn read_group_is_always_allowed_and_others_default_off() {
        let prefs = McpPrefs::default();
        assert!(Group::Read.allowed(&prefs));
        for group in [Group::Keys, Group::Hosts, Group::Exec, Group::Files] {
            assert!(!group.allowed(&prefs));
        }
    }
}
