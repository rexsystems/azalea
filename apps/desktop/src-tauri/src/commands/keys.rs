use crate::keys::{delete_private_key, generate_ed25519_key, import_private_key};
use crate::models::{CreateKeyInput, ImportKeyInput, SshKeyRecord};
use crate::store::SharedDatabase;

#[tauri::command]
pub fn list_keys(db: tauri::State<'_, SharedDatabase>) -> Result<Vec<SshKeyRecord>, String> {
    db.lock().list_keys().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn generate_key(
    db: tauri::State<'_, SharedDatabase>,
    input: CreateKeyInput,
) -> Result<SshKeyRecord, String> {
    let key = generate_ed25519_key(&input.name).map_err(|err| err.to_string())?;
    db.lock()
        .insert_key(&key)
        .map_err(|err| err.to_string())?;
    Ok(key)
}

#[tauri::command]
pub fn import_key(
    db: tauri::State<'_, SharedDatabase>,
    input: ImportKeyInput,
) -> Result<SshKeyRecord, String> {
    let key = import_private_key(&input.name, &input.private_key_pem)
        .map_err(|err| err.to_string())?;
    db.lock()
        .insert_key(&key)
        .map_err(|err| err.to_string())?;
    Ok(key)
}

#[tauri::command]
pub fn delete_key(db: tauri::State<'_, SharedDatabase>, id: String) -> Result<(), String> {
    delete_private_key(&id).map_err(|err| err.to_string())?;
    db.lock().delete_key(&id).map_err(|err| err.to_string())
}
