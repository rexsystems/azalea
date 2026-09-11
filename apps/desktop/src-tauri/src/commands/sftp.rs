use std::path::{Path, PathBuf};

use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::models::{SftpListInput, SftpListResult};
use crate::sessions::{
    sftp_download_file, sftp_list_dir, sftp_read_text_file, sftp_upload_file,
    sftp_write_text_file, SharedSshSessionManager,
};

#[tauri::command]
pub async fn sftp_list(
    sessions: tauri::State<'_, SharedSshSessionManager>,
    input: SftpListInput,
) -> Result<SftpListResult, String> {
    sftp_list_dir(sessions.inner(), &input.session_id, input.path)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn sftp_download(
    app: AppHandle,
    sessions: tauri::State<'_, SharedSshSessionManager>,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<u64, String> {
    let target = PathBuf::from(&local_path);

    // Defense-in-depth: refuse to write anywhere outside $HOME. A compromised
    // webview otherwise could ask the backend to write over
    // `/etc/cron.d/whatever`, `~/.ssh/authorized_keys`, etc.
    ensure_download_target_allowed(&target)?;

    // If the destination already exists, get explicit confirmation from the
    // OS. Prevents the webview from silently clobbering a user's local file.
    if target.exists() {
        let confirmed = confirm_overwrite(&app, "download destination", &target).await?;
        if !confirmed {
            return Err("Download cancelled.".into());
        }
    }

    sftp_download_file(sessions.inner(), &session_id, &remote_path, &local_path)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn sftp_upload(
    sessions: tauri::State<'_, SharedSshSessionManager>,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<u64, String> {
    // Defense-in-depth against a compromised webview: refuse to read from
    // well-known secret directories. A user who actually wants to SFTP-upload
    // their own SSH key can move the file out of ~/.ssh first.
    ensure_upload_source_allowed(&PathBuf::from(&local_path))?;

    sftp_upload_file(sessions.inner(), &session_id, &local_path, &remote_path)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn sftp_read_text(
    sessions: tauri::State<'_, SharedSshSessionManager>,
    session_id: String,
    remote_path: String,
) -> Result<String, String> {
    sftp_read_text_file(sessions.inner(), &session_id, &remote_path)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn sftp_write_text(
    sessions: tauri::State<'_, SharedSshSessionManager>,
    session_id: String,
    remote_path: String,
    contents: String,
) -> Result<u64, String> {
    sftp_write_text_file(sessions.inner(), &session_id, &remote_path, &contents)
        .await
        .map_err(|err| err.to_string())
}

fn home_dir() -> Option<PathBuf> {
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            return Some(PathBuf::from(home));
        }
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        if !profile.is_empty() {
            return Some(PathBuf::from(profile));
        }
    }
    None
}

fn is_within(base: &Path, candidate: &Path) -> bool {
    let base_canon = base.canonicalize().unwrap_or_else(|_| base.to_path_buf());
    let cand_canon = candidate
        .canonicalize()
        .unwrap_or_else(|_| candidate.to_path_buf());
    cand_canon.starts_with(&base_canon)
}

fn is_sensitive_source(path: &Path) -> bool {
    let Some(home) = home_dir() else {
        return false;
    };
    // Common secret stores. Anything the user hasn't explicitly opted into
    // should not leave the machine because the webview asked.
    let sensitive = [
        home.join(".ssh"),
        home.join(".gnupg"),
        home.join(".aws"),
        home.join(".azure"),
        home.join(".kube"),
        home.join(".docker"),
        home.join(".password-store"),
    ];
    sensitive.iter().any(|s| is_within(s, path))
}

fn ensure_download_target_allowed(target: &Path) -> Result<(), String> {
    let Some(home) = home_dir() else {
        return Err("Could not determine your home directory.".into());
    };
    let parent = target.parent().unwrap_or(target);
    if !is_within(&home, parent) {
        return Err(format!(
            "Downloads must land inside your home directory ({}).",
            home.display()
        ));
    }
    Ok(())
}

fn ensure_upload_source_allowed(source: &Path) -> Result<(), String> {
    if is_sensitive_source(source) {
        return Err(
            "Refusing to upload from a sensitive directory (~/.ssh, ~/.gnupg, ~/.aws, ~/.kube, ...). Copy the file elsewhere first if you really need to upload it."
                .into(),
        );
    }
    Ok(())
}

async fn confirm_overwrite(app: &AppHandle, kind: &str, path: &Path) -> Result<bool, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(format!(
            "Overwrite the existing {kind}?\n\n{}",
            path.display()
        ))
        .title("Confirm overwrite")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Overwrite".to_string(),
            "Cancel".to_string(),
        ))
        .show(move |confirmed| {
            let _ = tx.send(confirmed);
        });
    rx.await.map_err(|e| e.to_string())
}
