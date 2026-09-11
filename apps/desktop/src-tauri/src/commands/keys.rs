use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::keys::{
    delete_private_key, generate_key as generate_ssh_key, get_private_key, import_private_key,
};
use crate::models::{
    CreateKeyInput, ImportKeyInput, InstallPublicKeyInput, InstallPublicKeyResult, SshKeyRecord,
};
use crate::sessions::install_authorized_key;
use crate::store::SharedDatabase;

#[tauri::command]
pub fn list_keys(db: State<'_, SharedDatabase>) -> Result<Vec<SshKeyRecord>, String> {
    db.lock().list_keys().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn generate_key(
    db: State<'_, SharedDatabase>,
    input: CreateKeyInput,
) -> Result<SshKeyRecord, String> {
    let key = generate_ssh_key(&input.name, input.algorithm.as_deref())
        .map_err(|err| err.to_string())?;
    db.lock()
        .insert_key(&key)
        .map_err(|err| err.to_string())?;
    Ok(key)
}

#[tauri::command]
pub fn import_key(
    db: State<'_, SharedDatabase>,
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
pub fn delete_key(db: State<'_, SharedDatabase>, id: String) -> Result<(), String> {
    delete_private_key(&id).map_err(|err| err.to_string())?;
    db.lock().delete_key(&id).map_err(|err| err.to_string())
}

/// Gate every private-key export behind a native OS confirmation dialog.
///
/// The webview must ask the OS-native dialog for permission before the
/// private key material leaves the keyring. This prevents a compromised
/// frontend (or an injected script anywhere in the UI) from silently
/// exfiltrating every stored key via `list_keys` + `export_private_key`.
#[tauri::command]
pub async fn export_private_key(
    app: AppHandle,
    db: State<'_, SharedDatabase>,
    id: String,
) -> Result<String, String> {
    let key_name = db
        .lock()
        .get_key(&id)
        .map_err(|err| err.to_string())?
        .map(|k| k.name)
        .unwrap_or_else(|| "this key".to_string());

    let confirmed = confirm_export(&app, &key_name).await?;
    if !confirmed {
        return Err("Export cancelled.".into());
    }

    get_private_key(&id)
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "Private key not found in keyring".to_string())
}

async fn confirm_export(app: &AppHandle, key_name: &str) -> Result<bool, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(format!(
            "Reveal the private key for \"{key_name}\"?\n\nAnyone who sees the output can use it to sign into your servers as you. Only continue if you started this from the Azalea UI."
        ))
        .title("Export private key")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Reveal key".to_string(),
            "Cancel".to_string(),
        ))
        .show(move |confirmed| {
            let _ = tx.send(confirmed);
        });
    rx.await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn install_public_key(
    app: AppHandle,
    db: State<'_, SharedDatabase>,
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
