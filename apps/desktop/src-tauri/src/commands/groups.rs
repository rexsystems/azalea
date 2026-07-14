use crate::models::{CreateGroupInput, HostGroup, MoveHostInput, UpdateGroupInput};
use crate::store::SharedDatabase;

#[tauri::command]
pub fn list_groups(db: tauri::State<'_, SharedDatabase>) -> Result<Vec<HostGroup>, String> {
    db.lock().list_groups().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_group(
    db: tauri::State<'_, SharedDatabase>,
    input: CreateGroupInput,
) -> Result<HostGroup, String> {
    db.lock()
        .create_group(&input.name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_group(
    db: tauri::State<'_, SharedDatabase>,
    id: String,
    input: UpdateGroupInput,
) -> Result<HostGroup, String> {
    db.lock()
        .update_group(&id, &input.name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_group(db: tauri::State<'_, SharedDatabase>, id: String) -> Result<(), String> {
    db.lock().delete_group(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn move_host_to_group(
    db: tauri::State<'_, SharedDatabase>,
    input: MoveHostInput,
) -> Result<(), String> {
    db.lock()
        .move_host_to_group(&input.host_id, input.group_id.as_deref())
        .map_err(|e| e.to_string())
}
