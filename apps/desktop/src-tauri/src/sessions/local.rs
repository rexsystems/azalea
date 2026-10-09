use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;
use tauri::Emitter;

#[cfg(desktop)]
use std::io::{Read, Write};

#[cfg(desktop)]
use base64::engine::general_purpose::STANDARD as B64;
#[cfg(desktop)]
use base64::Engine;
#[cfg(desktop)]
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
#[cfg(desktop)]
use serde_json::json;

#[cfg(desktop)]
struct LocalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct LocalTerminalManager {
    #[cfg(desktop)]
    sessions: HashMap<String, LocalSession>,
    #[cfg(mobile)]
    _sessions: HashMap<String, ()>,
}

pub type SharedLocalTerminalManager = Arc<Mutex<LocalTerminalManager>>;

pub fn init_local_terminal_manager() -> SharedLocalTerminalManager {
    Arc::new(Mutex::new(LocalTerminalManager::default()))
}

#[cfg(desktop)]
fn default_shell() -> CommandBuilder {
    #[cfg(windows)]
    {
        let pwsh = std::path::Path::new(r"C:\Program Files\PowerShell\7\pwsh.exe");
        let shell = if pwsh.exists() {
            pwsh.to_string_lossy().into_owned()
        } else {
            "powershell.exe".to_string()
        };
        let mut cmd = CommandBuilder::new(shell);
        cmd.arg("-NoLogo");
        cmd
    }
    #[cfg(not(windows))]
    {
        CommandBuilder::new(std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string()))
    }
}

pub fn start_local_terminal(
    app: tauri::AppHandle,
    manager: SharedLocalTerminalManager,
    session_id: String,
    cols: u16,
    rows: u16,
) -> anyhow::Result<()> {
    #[cfg(mobile)]
    {
        let _ = (app, manager, session_id, cols, rows);
        anyhow::bail!("Local terminal is not available on mobile.");
    }
    #[cfg(desktop)]
    {
        if !session_id.starts_with("local-") {
            anyhow::bail!("Invalid local session id");
        }

        {
            let guard = manager.lock();
            if guard.sessions.contains_key(&session_id) {
                anyhow::bail!("Local terminal already exists");
            }
        }

        let pty = native_pty_system().openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let mut cmd = default_shell();
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_else(|_| ".".to_string());
        cmd.cwd(home);
        cmd.env("TERM", "xterm-256color");

        let mut child = pty.slave.spawn_command(cmd)?;
        drop(pty.slave);

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

        #[cfg(windows)]
        {
            let mut guard = manager.lock();
            if let Some(session) = guard.sessions.get_mut(&session_id) {
                let _ = session.writer.write_all(b"\r\n");
                let _ = session.writer.flush();
            }
        }

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

        Ok(())
    }
}

impl LocalTerminalManager {
    pub fn write(&mut self, session_id: &str, data: &[u8]) -> anyhow::Result<()> {
        #[cfg(mobile)]
        {
            let _ = (session_id, data);
            anyhow::bail!("Local terminal is not available on mobile.");
        }
        #[cfg(desktop)]
        {
            let session = self
                .sessions
                .get_mut(session_id)
                .ok_or_else(|| anyhow::anyhow!("Unknown local terminal"))?;
            session.writer.write_all(data)?;
            session.writer.flush()?;
            Ok(())
        }
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> anyhow::Result<()> {
        #[cfg(mobile)]
        {
            let _ = (session_id, cols, rows);
            anyhow::bail!("Local terminal is not available on mobile.");
        }
        #[cfg(desktop)]
        {
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
    }

    pub fn close(&mut self, session_id: &str) {
        #[cfg(mobile)]
        {
            let _ = session_id;
        }
        #[cfg(desktop)]
        {
            if let Some(mut session) = self.sessions.remove(session_id) {
                let _ = session.killer.kill();
            }
        }
    }

    pub fn close_all(&mut self) {
        #[cfg(desktop)]
        {
            let ids: Vec<String> = self.sessions.keys().cloned().collect();
            for id in ids {
                self.close(&id);
            }
        }
    }
}
