use std::sync::Arc;

use parking_lot::Mutex;
use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::store::accounts::{account_db_path, AccountKind, AccountRecord, AccountRegistry};
use crate::store::SharedDatabase;
use crate::sync::SharedSyncState;

pub type SharedAccountRegistry = Arc<Mutex<AccountRegistry>>;

pub fn init_accounts(app: &AppHandle) -> anyhow::Result<SharedAccountRegistry> {
    Ok(Arc::new(Mutex::new(AccountRegistry::load_or_init(app)?)))
}

#[tauri::command]
pub fn list_accounts(
    registry: State<'_, SharedAccountRegistry>,
) -> Result<Vec<AccountRecord>, String> {
    Ok(registry.lock().list().to_vec())
}

#[tauri::command]
pub fn active_account(
    registry: State<'_, SharedAccountRegistry>,
) -> Result<Option<AccountRecord>, String> {
    Ok(registry.lock().active().cloned())
}

#[tauri::command]
pub fn accounts_onboarded(registry: State<'_, SharedAccountRegistry>) -> Result<bool, String> {
    Ok(registry.lock().onboarded())
}

#[tauri::command]
pub fn set_accounts_onboarded(
    registry: State<'_, SharedAccountRegistry>,
    onboarded: bool,
) -> Result<(), String> {
    registry
        .lock()
        .set_onboarded(onboarded)
        .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
pub struct AddAccountInput {
    kind: String,
    label: String,
    base_url: Option<String>,
    web_url: Option<String>,
}

#[tauri::command]
pub async fn add_account(
    app: AppHandle,
    registry: State<'_, SharedAccountRegistry>,
    db: State<'_, SharedDatabase>,
    sync: State<'_, SharedSyncState>,
    input: AddAccountInput,
) -> Result<AccountRecord, String> {
    let kind = match input.kind.as_str() {
        "cloud" => AccountKind::Cloud,
        "selfhost" => AccountKind::Selfhost,
        _ => AccountKind::Offline,
    };
    let account = registry
        .lock()
        .add(kind, input.label, input.base_url, input.web_url)
        .map_err(|e| e.to_string())?;

    switch_to_account(&app, &registry, &db, &sync, &account.id).await?;
    Ok(account)
}

#[tauri::command]
pub async fn switch_account(
    app: AppHandle,
    registry: State<'_, SharedAccountRegistry>,
    db: State<'_, SharedDatabase>,
    sync: State<'_, SharedSyncState>,
    id: String,
) -> Result<AccountRecord, String> {
    switch_to_account(&app, &registry, &db, &sync, &id).await
}

async fn switch_to_account(
    app: &AppHandle,
    registry: &SharedAccountRegistry,
    db: &SharedDatabase,
    sync: &SharedSyncState,
    id: &str,
) -> Result<AccountRecord, String> {
    let account = {
        let mut reg = registry.lock();
        reg.switch(id).map_err(|e| e.to_string())?.clone()
    };

    let path = account_db_path(app, &account.id).map_err(|e| e.to_string())?;
    db.lock().reopen(path).map_err(|e| e.to_string())?;

    let mut sync = sync.lock().await;
    sync.bind_account(account.id.clone(), account.base_url.clone(), account.web_url.clone());
    Ok(account)
}

#[tauri::command]
pub async fn remove_account(
    app: AppHandle,
    registry: State<'_, SharedAccountRegistry>,
    db: State<'_, SharedDatabase>,
    sync: State<'_, SharedSyncState>,
    id: String,
) -> Result<AccountRecord, String> {
    let removed_was_active = {
        let mut reg = registry.lock();
        let was_active = reg.active_id() == id;
        reg.remove(&id).map_err(|e| e.to_string())?;
        was_active
    };

    if let Ok(path) = account_db_path(&app, &id) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    let next_id = registry
        .lock()
        .active_id()
        .to_string();

    if removed_was_active {
        switch_to_account(&app, &registry, &db, &sync, &next_id).await
    } else {
        registry
            .lock()
            .active()
            .cloned()
            .ok_or_else(|| "No active account".to_string())
    }
}
