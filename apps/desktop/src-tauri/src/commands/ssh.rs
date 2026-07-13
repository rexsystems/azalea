use base64::Engine;

use crate::models::{ConnectInput, ReconnectInput, TerminalResizeInput, TerminalWriteInput};
use crate::sessions::SharedSshSessionManager;
use crate::store::SharedDatabase;

#[tauri::command]
pub async fn prepare_ssh(
    db: tauri::State<'_, SharedDatabase>,
    sessions: tauri::State<'_, SharedSshSessionManager>,
    host_id: String,
) -> Result<String, String> {
    sessions
        .lock()
        .await
        .prepare(db.inner().clone(), host_id)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn start_ssh(
    app: tauri::AppHandle,
    db: tauri::State<'_, SharedDatabase>,
    sessions: tauri::State<'_, SharedSshSessionManager>,
    input: ConnectInput,
) -> Result<(), String> {
    let manager = sessions.inner().clone();
    sessions
        .lock()
        .await
        .start(app, db.inner().clone(), manager, input.host_id, input.cols, input.rows)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn reconnect_ssh(
    app: tauri::AppHandle,
    db: tauri::State<'_, SharedDatabase>,
    sessions: tauri::State<'_, SharedSshSessionManager>,
    input: ReconnectInput,
) -> Result<(), String> {
    let manager = sessions.inner().clone();
    sessions
        .lock()
        .await
        .reconnect(app, db.inner().clone(), manager, input.session_id, input.cols, input.rows)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn write_terminal(
    sessions: tauri::State<'_, SharedSshSessionManager>,
    input: TerminalWriteInput,
) -> Result<(), String> {
    let data = base64::engine::general_purpose::STANDARD
        .decode(input.data)
        .map_err(|err| err.to_string())?;
    sessions
        .lock()
        .await
        .write(&input.session_id, data)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn resize_terminal(
    sessions: tauri::State<'_, SharedSshSessionManager>,
    input: TerminalResizeInput,
) -> Result<(), String> {
    sessions
        .lock()
        .await
        .resize(&input.session_id, input.cols, input.rows)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn disconnect_ssh(
    sessions: tauri::State<'_, SharedSshSessionManager>,
    session_id: String,
) -> Result<(), String> {
    sessions.lock().await.disconnect(&session_id);
    Ok(())
}
