//! Keeps `~/.ssh/config` in step with Azalea hosts so VS Code Remote-SSH and
//! the system `ssh` can use them. Keys are served by the Azalea agent on Unix.

#[cfg(unix)]
mod agent;
pub mod config;

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Manager, State};

use crate::store::SharedDatabase;

const PREFS_FILE: &str = "openssh-export.json";
const POLL_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct ExportPrefs {
    enabled: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportStatus {
    pub enabled: bool,
    pub agent_supported: bool,
    pub config_path: String,
    pub agent_socket: Option<String>,
    pub exported_hosts: usize,
    pub skipped_hosts: usize,
    pub last_error: Option<String>,
}

#[derive(Default)]
struct Runtime {
    enabled: bool,
    tasks: Vec<JoinHandle<()>>,
    exported_hosts: usize,
    skipped_hosts: usize,
    last_error: Option<String>,
}

pub struct OpenSshExport {
    prefs_path: PathBuf,
    home: PathBuf,
    runtime: Mutex<Runtime>,
    write_lock: Mutex<()>,
}

struct Paths {
    config: PathBuf,
    public_keys: PathBuf,
    agent_socket: Option<PathBuf>,
}

impl OpenSshExport {
    fn paths(&self) -> Paths {
        Paths {
            config: self.home.join(".ssh").join("config"),
            public_keys: self.home.join(".azalea").join("public-keys"),
            #[cfg(unix)]
            agent_socket: Some(agent::socket_path(&self.home)),
            #[cfg(not(unix))]
            agent_socket: None,
        }
    }

    /// `~/...` form for ssh_config, so the file stays valid if copied to another machine.
    fn display_path(&self, path: &Path) -> String {
        match path.strip_prefix(&self.home) {
            Ok(rel) => format!("~/{}", rel.to_string_lossy().replace('\\', "/")),
            Err(_) => path.to_string_lossy().to_string(),
        }
    }

    pub fn status(&self) -> ExportStatus {
        let paths = self.paths();
        let rt = self.runtime.lock();
        ExportStatus {
            enabled: rt.enabled,
            agent_supported: paths.agent_socket.is_some(),
            config_path: self.display_path(&paths.config),
            agent_socket: paths.agent_socket.as_deref().map(|p| self.display_path(p)),
            exported_hosts: rt.exported_hosts,
            skipped_hosts: rt.skipped_hosts,
            last_error: rt.last_error.clone(),
        }
    }

    fn sync_once(&self, app: &AppHandle) -> anyhow::Result<(usize, usize)> {
        let _guard = self.write_lock.lock();
        let paths = self.paths();
        let (hosts, keys) = {
            let db = app.state::<SharedDatabase>();
            let db = db.lock();
            (db.list_hosts()?, db.list_keys()?)
        };

        let agent_socket = paths.agent_socket.as_deref().map(|p| self.display_path(p));
        let mut wanted_keys = Vec::new();
        let plan = config::plan_hosts(&hosts, |key_id| {
            agent_socket.as_ref()?;
            let key = keys.iter().find(|k| k.id == key_id)?;
            let file = paths.public_keys.join(format!("{}.pub", key.id));
            let shown = self.display_path(&file);
            if !wanted_keys.iter().any(|(path, _)| *path == file) {
                wanted_keys.push((file, key.public_key.trim().to_string()));
            }
            Some(shown)
        });

        write_public_keys(&paths.public_keys, &wanted_keys)?;
        let block = config::render_block(&plan, agent_socket.as_deref());
        let existing = fs::read_to_string(&paths.config).unwrap_or_default();
        config::write_config(&paths.config, &config::merge(&existing, Some(&block)))?;
        Ok((plan.len(), hosts.len() - plan.len()))
    }

    fn remove_from_config(&self) -> anyhow::Result<()> {
        let _guard = self.write_lock.lock();
        let paths = self.paths();
        if let Ok(existing) = fs::read_to_string(&paths.config) {
            if existing.contains(config::BLOCK_BEGIN) {
                config::write_config(&paths.config, &config::merge(&existing, None))?;
            }
        }
        let _ = fs::remove_dir_all(&paths.public_keys);
        if let Some(socket) = paths.agent_socket {
            let _ = fs::remove_file(socket);
        }
        Ok(())
    }

    fn start(&self, app: &AppHandle) {
        let mut rt = self.runtime.lock();
        if !rt.tasks.is_empty() {
            return;
        }

        #[cfg(unix)]
        if let Some(socket) = self.paths().agent_socket {
            let app = app.clone();
            rt.tasks.push(tauri::async_runtime::spawn(async move {
                if let Err(error) = agent::run(app.clone(), socket).await {
                    eprintln!("Azalea ssh agent stopped: {error}");
                    app.state::<OpenSshExport>().runtime.lock().last_error =
                        Some(format!("SSH agent: {error}"));
                }
            }));
        }

        let app = app.clone();
        rt.tasks.push(tauri::async_runtime::spawn(async move {
            loop {
                let handle = app.clone();
                let result = tauri::async_runtime::spawn_blocking(move || {
                    handle.state::<OpenSshExport>().sync_once(&handle)
                })
                .await;
                app.state::<OpenSshExport>()
                    .record(result.map_err(anyhow::Error::from).and_then(|r| r));
                tokio::time::sleep(POLL_INTERVAL).await;
            }
        }));
    }

    fn record(&self, result: anyhow::Result<(usize, usize)>) {
        let mut rt = self.runtime.lock();
        match result {
            Ok((exported, skipped)) => {
                rt.exported_hosts = exported;
                rt.skipped_hosts = skipped;
                if rt
                    .last_error
                    .as_deref()
                    .is_some_and(|e| !e.starts_with("SSH agent"))
                {
                    rt.last_error = None;
                }
            }
            Err(error) => rt.last_error = Some(error.to_string()),
        }
    }

    fn stop(&self) {
        let mut rt = self.runtime.lock();
        for task in rt.tasks.drain(..) {
            task.abort();
        }
        rt.exported_hosts = 0;
        rt.skipped_hosts = 0;
        rt.last_error = None;
    }

    fn save_prefs(&self, enabled: bool) -> anyhow::Result<()> {
        let pending = self.prefs_path.with_extension("pending.json");
        fs::write(&pending, serde_json::to_vec(&ExportPrefs { enabled })?)?;
        fs::rename(&pending, &self.prefs_path)?;
        Ok(())
    }
}

fn write_public_keys(dir: &Path, wanted: &[(PathBuf, String)]) -> anyhow::Result<()> {
    if wanted.is_empty() {
        let _ = fs::remove_dir_all(dir);
        return Ok(());
    }
    config::create_private_dir(dir)?;
    for (path, key) in wanted {
        let line = format!("{key}\n");
        if fs::read_to_string(path).ok().as_deref() != Some(line.as_str()) {
            fs::write(path, line)?;
        }
    }
    for entry in fs::read_dir(dir)?.flatten() {
        if !wanted.iter().any(|(path, _)| *path == entry.path()) {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}

pub fn init(app: &AppHandle) -> anyhow::Result<()> {
    let prefs_path = app.path().app_data_dir()?.join(PREFS_FILE);
    let home = app.path().home_dir()?;
    let prefs: ExportPrefs = fs::read(&prefs_path)
        .ok()
        .and_then(|raw| serde_json::from_slice(&raw).ok())
        .unwrap_or_default();

    let export = OpenSshExport {
        prefs_path,
        home,
        runtime: Mutex::new(Runtime {
            enabled: prefs.enabled,
            ..Runtime::default()
        }),
        write_lock: Mutex::new(()),
    };
    app.manage(export);
    if prefs.enabled {
        app.state::<OpenSshExport>().start(app);
    }
    Ok(())
}

#[tauri::command]
pub fn openssh_export_status(export: State<'_, OpenSshExport>) -> ExportStatus {
    export.status()
}

#[tauri::command]
pub async fn openssh_export_set(
    app: AppHandle,
    export: State<'_, OpenSshExport>,
    enabled: bool,
) -> Result<ExportStatus, String> {
    export.save_prefs(enabled).map_err(|e| e.to_string())?;
    export.runtime.lock().enabled = enabled;
    if enabled {
        export.start(&app);
        let handle = app.clone();
        let first = tauri::async_runtime::spawn_blocking(move || {
            handle.state::<OpenSshExport>().sync_once(&handle)
        })
        .await
        .map_err(anyhow::Error::from)
        .and_then(|r| r);
        export.record(first);
    } else {
        export.stop();
        export.remove_from_config().map_err(|e| e.to_string())?;
    }
    Ok(export.status())
}
