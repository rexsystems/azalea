use crate::models::{SftpListInput, SftpListResult};
use crate::sessions::{sftp_download_file, sftp_list_dir, sftp_upload_file, SharedSshSessionManager};

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
    sessions: tauri::State<'_, SharedSshSessionManager>,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<u64, String> {
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
    sftp_upload_file(sessions.inner(), &session_id, &local_path, &remote_path)
        .await
        .map_err(|err| err.to_string())
}
