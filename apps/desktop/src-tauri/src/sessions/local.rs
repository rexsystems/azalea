use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde_json::json;
use tauri::Emitter;
use uuid::Uuid;

struct LocalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct LocalTerminalManager {
    sessions: HashMap<String, LocalSession>,
}

pub type SharedLocalTerminalManager = Arc<Mutex<LocalTerminalManager>>;

pub fn init_local_terminal_manager() -> SharedLocalTerminalManager {
    Arc::new(Mutex::new(LocalTerminalManager::default()))
}

fn default_shell() -> CommandBuilder {
    #[cfg(windows)]
    let mut cmd = CommandBuilder::new("powershell.exe");
    #[cfg(not(windows))]
    let mut cmd = CommandBuilder::new(
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string()),
    );

    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    cmd.cwd(home);
    cmd
}

pub fn start_local_terminal(
    app: tauri::AppHandle,
    manager: SharedLocalTerminalManager,
    cols: u16,
    rows: u16,
) -> anyhow::Result<String> {
    let session_id = format!("local-{}", Uuid::new_v4());

    let pty = native_pty_system().openpty(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let mut child = pty.slave.spawn_command(default_shell())?;
    let killer = child.clone_killer();
    let mut reader = pty.master.try_clone_reader()?;
    let writer = pty.master.take_writer()?;

    manager.lock().sessions.insert(
        session_id.clone(),
        LocalSession {
            master: pty.master,
            writer,
            killer,
        },
    );

    // Reader thread: pump PTY output to the frontend.
    {
        let app = app.clone();
        let session_id = session_id.clone();
        let manager = manager.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let _ = app.emit(
                            "terminal-output",
                            json!({
                                "session_id": session_id,
                                "data": B64.encode(&buf[..n]),
                            }),
                        );
                    }
                }
            }
            let _ = child.wait();
            manager.lock().sessions.remove(&session_id);
            let _ = app.emit(
                "terminal-status",
                json!({ "session_id": session_id, "status": "exited" }),
            );
        });
    }

    let _ = app.emit(
        "terminal-status",
        json!({ "session_id": session_id, "status": "connected" }),
    );

    Ok(session_id)
}

impl LocalTerminalManager {
    pub fn write(&mut self, session_id: &str, data: &[u8]) -> anyhow::Result<()> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow::anyhow!("Unknown local terminal"))?;
        session.writer.write_all(data)?;
        session.writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> anyhow::Result<()> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Unknown local terminal"))?;
        session.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }

    pub fn close(&mut self, session_id: &str) {
        if let Some(mut session) = self.sessions.remove(session_id) {
            let _ = session.killer.kill();
        }
    }
}
