//! Persist native panics for opt-in crash reporting on next launch.

use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

static PENDING_CRASH_PATH: OnceLock<PathBuf> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingCrash {
    pub kind: String,
    pub message: String,
    #[serde(default)]
    pub stack: Option<String>,
    #[serde(default)]
    pub app_version: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

fn path_for(app: &AppHandle) -> anyhow::Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow::anyhow!("app_data_dir: {e}"))?;
    fs::create_dir_all(&dir)?;
    Ok(dir.join("pending_crash.json"))
}

pub fn install_panic_hook(app: &AppHandle) -> anyhow::Result<()> {
    let path = path_for(app)?;
    let _ = PENDING_CRASH_PATH.set(path);

    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let message = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "rust panic".to_string()
        };
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown".into());
        // Basename-ish: drop absolute path prefixes for privacy
        let location = strip_path_prefix(&location);
        let msg = format!("{message} @ {location}");
        write_pending(PendingCrash {
            kind: "rust_panic".into(),
            message: msg.chars().take(240).collect(),
            stack: None,
            app_version: Some(env!("CARGO_PKG_VERSION").into()),
            created_at: Some(chrono_now()),
        });
        default_hook(info);
    }));
    Ok(())
}

fn chrono_now() -> String {
    // Avoid pulling chrono just for this; RFC3339-ish UTC via system time is fine.
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

fn strip_path_prefix(s: &str) -> String {
    let mut out = s.to_string();
    for marker in ["/home/", "/Users/", "/root/"] {
        if let Some(idx) = out.find(marker) {
            let after = idx + marker.len();
            if let Some(rel) = out[after..].find('/') {
                let end = after + rel;
                out.replace_range(idx..end, &format!("{marker}[user]"));
            }
        }
    }
    out
}

fn write_pending(crash: PendingCrash) {
    let Some(path) = PENDING_CRASH_PATH.get() else {
        return;
    };
    if let Ok(json) = serde_json::to_string_pretty(&crash) {
        let _ = fs::write(path, json);
        // Best-effort chmod 0600 on Unix so another user on the machine can
        // never read a crash report (which can include a stack trace / rust
        // panic message; low risk but no reason to be world-readable).
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(meta) = fs::metadata(path) {
                let mut perms = meta.permissions();
                perms.set_mode(0o600);
                let _ = fs::set_permissions(path, perms);
            }
        }
    }
}

#[tauri::command]
pub fn take_pending_crash(app: AppHandle) -> Result<Option<PendingCrash>, String> {
    let path = path_for(&app).map_err(|e| e.to_string())?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&path);
    let parsed: PendingCrash = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(Some(parsed))
}
