use serde::Deserialize;
use serde_json::Value;

use crate::store::SharedDatabase;
use crate::sync::{self, SharedSyncState, SyncOutcome, SyncStatus};

#[derive(Debug, Deserialize)]
pub struct CredentialsInput {
    pub email: String,
    pub password: String,
}

#[tauri::command]
pub async fn sync_status(
    state: tauri::State<'_, SharedSyncState>,
    db: tauri::State<'_, SharedDatabase>,
) -> Result<SyncStatus, String> {
    let mut sync = state.lock().await;
    Ok(sync::status(&mut sync, &db).await)
}

#[tauri::command]
pub async fn sync_signup(
    state: tauri::State<'_, SharedSyncState>,
    input: CredentialsInput,
) -> Result<(), String> {
    let mut sync = state.lock().await;
    sync::signup(&mut sync, &input.email, &input.password)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn sync_login(
    state: tauri::State<'_, SharedSyncState>,
    input: CredentialsInput,
) -> Result<(), String> {
    let mut sync = state.lock().await;
    sync::login(&mut sync, &input.email, &input.password)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn sync_logout(
    state: tauri::State<'_, SharedSyncState>,
    db: tauri::State<'_, SharedDatabase>,
) -> Result<(), String> {
    let mut sync = state.lock().await;
    sync::logout(&mut sync, &db);
    Ok(())
}

#[tauri::command]
pub async fn sync_setup_passphrase(
    state: tauri::State<'_, SharedSyncState>,
    db: tauri::State<'_, SharedDatabase>,
    passphrase: String,
    settings: Option<Value>,
) -> Result<String, String> {
    let mut sync = state.lock().await;
    sync::setup_passphrase(&mut sync, &db, &passphrase, settings)
        .await
        .map_err(|err| err.to_string())
}

#[derive(Debug, Deserialize)]
pub struct UnlockInput {
    pub passphrase: Option<String>,
    pub recovery_key: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct UnlockResult {
    pub version: i64,
    pub settings: Option<Value>,
}

#[tauri::command]
pub async fn sync_unlock(
    state: tauri::State<'_, SharedSyncState>,
    db: tauri::State<'_, SharedDatabase>,
    input: UnlockInput,
) -> Result<UnlockResult, String> {
    let mut sync = state.lock().await;
    let (version, settings) = sync::unlock(
        &mut sync,
        &db,
        input.passphrase.as_deref(),
        input.recovery_key.as_deref(),
    )
    .await
    .map_err(|err| err.to_string())?;
    Ok(UnlockResult { version, settings })
}

#[tauri::command]
pub async fn sync_now(
    state: tauri::State<'_, SharedSyncState>,
    db: tauri::State<'_, SharedDatabase>,
    settings: Option<Value>,
    resolution: Option<String>,
) -> Result<SyncOutcome, String> {
    let mut sync = state.lock().await;
    sync::perform_sync(&mut sync, &db, settings, resolution.as_deref())
        .await
        .map_err(|err| err.to_string())
}
