use crate::keys::{delete_private_key, generate_key as generate_ssh_key, import_private_key};
use crate::models::{
    CreateKeyInput, ImportKeyInput, InstallPublicKeyInput, InstallPublicKeyResult, SshKeyRecord,
};
use crate::sessions::install_authorized_key;
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
    let key = generate_ssh_key(&input.name, input.algorithm.as_deref()).map_err(|err| err.to_string())?;
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
    let key = import_private_key(&input.name, &input.private_key_pem, input.passphrase.as_deref())
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

#[tauri::command]
pub async fn install_public_key(
    app: tauri::AppHandle,
    db: tauri::State<'_, SharedDatabase>,
    input: InstallPublicKeyInput,
) -> Result<InstallPublicKeyResult, String> {
    let host = db
        .lock()
        .get_host(&input.host_id)
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "Host not found".to_string())?;

    let key = db
        .lock()
        .get_key(&input.key_id)
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "SSH key not found".to_string())?;

    install_authorized_key(app, db.inner().clone(), host, &key.public_key)
        .await
        .map_err(|err| err.to_string())
}
