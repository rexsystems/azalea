use base64::Engine;

use crate::sessions::{local, SharedLocalTerminalManager};

#[tauri::command]
pub fn start_local_terminal(
    app: tauri::AppHandle,
    manager: tauri::State<'_, SharedLocalTerminalManager>,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    local::start_local_terminal(app, manager.inner().clone(), cols, rows)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn write_local_terminal(
    manager: tauri::State<'_, SharedLocalTerminalManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|err| err.to_string())?;
    manager
        .lock()
        .write(&session_id, &bytes)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn resize_local_terminal(
    manager: tauri::State<'_, SharedLocalTerminalManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager
        .lock()
        .resize(&session_id, cols, rows)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn close_local_terminal(
    manager: tauri::State<'_, SharedLocalTerminalManager>,
    session_id: String,
) -> Result<(), String> {
    manager.lock().close(&session_id);
    Ok(())
}
