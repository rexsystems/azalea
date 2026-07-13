use uuid::Uuid;

use crate::models::{CreatePortForwardInput, PortForward};
use crate::sessions::{start_port_forward, SharedSshSessionManager};
use crate::store::SharedDatabase;

#[tauri::command]
pub fn list_port_forwards(
    db: tauri::State<'_, SharedDatabase>,
    host_id: Option<String>,
) -> Result<Vec<PortForward>, String> {
    db.lock()
        .list_port_forwards(host_id.as_deref())
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn create_port_forward(
    db: tauri::State<'_, SharedDatabase>,
    input: CreatePortForwardInput,
) -> Result<PortForward, String> {
    let forward = PortForward {
        id: Uuid::new_v4().to_string(),
        host_id: input.host_id,
        label: input.label,
        local_port: input.local_port,
        remote_host: input.remote_host,
        remote_port: input.remote_port,
        created_at: chrono::Utc::now().timestamp(),
    };
    db.lock()
        .insert_port_forward(&forward)
        .map_err(|err| err.to_string())?;
    Ok(forward)
}

#[tauri::command]
pub fn delete_port_forward(
    db: tauri::State<'_, SharedDatabase>,
    id: String,
) -> Result<(), String> {
    db.lock()
        .delete_port_forward(&id)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn start_forward(
    db: tauri::State<'_, SharedDatabase>,
    sessions: tauri::State<'_, SharedSshSessionManager>,
    session_id: String,
    forward_id: String,
) -> Result<(), String> {
    let forward = {
        let db = db.lock();
        db.list_port_forwards(None)
            .map_err(|err| err.to_string())?
            .into_iter()
            .find(|f| f.id == forward_id)
            .ok_or_else(|| "Forward rule not found".to_string())?
    };

    start_port_forward(sessions.inner(), &session_id, forward)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn stop_forward(
    sessions: tauri::State<'_, SharedSshSessionManager>,
    session_id: String,
    forward_id: String,
) -> Result<(), String> {
    sessions.lock().await.stop_forward(&session_id, &forward_id);
    Ok(())
}

#[tauri::command]
pub async fn list_active_forwards(
    sessions: tauri::State<'_, SharedSshSessionManager>,
    session_id: String,
) -> Result<Vec<String>, String> {
    Ok(sessions.lock().await.active_forwards(&session_id))
}
