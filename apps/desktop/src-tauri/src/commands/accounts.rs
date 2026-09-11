use std::sync::Arc;

use parking_lot::Mutex;
use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::store::accounts::{
    account_db_path, valid_account_id, AccountKind, AccountRecord, AccountRegistry,
};
use crate::store::SharedDatabase;
use crate::sync::{self, SharedSyncState};

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

#[tauri::command]
pub async fn connect_selfhost(
    app: AppHandle,
    registry: State<'_, SharedAccountRegistry>,
    db: State<'_, SharedDatabase>,
    sync: State<'_, SharedSyncState>,
    input: ConnectSelfhostInput,
) -> Result<sync::ConnectSelfhostResult, String> {
    let email = input.email.trim().to_string();
    let base_url = input.base_url.trim().trim_end_matches('/').to_string();
    if base_url.is_empty() {
        return Err("Server URL is required".into());
    }
    if email.is_empty() || input.password.is_empty() {
        return Err("Email and password are required".into());
    }

    // Authenticate first — do not switch profiles until login succeeds.
    let session = sync::password_login_at_url(&base_url, &email, &input.password)
        .await
        .map_err(|e| e.to_string())?;

    let label = {
        let trimmed = input.label.trim();
        if trimmed.is_empty() {
            "Self-hosted".to_string()
        } else {
            trimmed.to_string()
        }
    };
    let web_url = input
        .web_url
        .map(|u| u.trim().trim_end_matches('/').to_string())
        .filter(|u| !u.is_empty());

    let account = registry
        .lock()
        .add(
            AccountKind::Selfhost,
            label,
            Some(base_url),
            web_url,
        )
        .map_err(|e| e.to_string())?;

    if let Err(err) = switch_to_account(&app, &registry, &db, &sync, &account.id).await {
        let id = account.id.clone();
        let _ = registry.lock().remove(&id);
        if let Ok(path) = account_db_path(&app, &id) {
            if let Some(dir) = path.parent() {
                let _ = std::fs::remove_dir_all(dir);
            }
        }
        return Err(err);
    }

    let vault_exists = {
        let mut state = sync.lock().await;
        state.apply_auth_session(session);
        let _ = registry.lock().set_email(&account.id, Some(email.clone()));
        match sync::fetch_vault(&state).await {
            Ok(Some(_)) => Some(true),
            Ok(None) => Some(false),
            Err(_) => None,
        }
    };

    let account = registry
        .lock()
        .active()
        .cloned()
        .ok_or_else(|| "No active account".to_string())?;

    Ok(sync::ConnectSelfhostResult {
        account,
        vault_exists,
        email,
    })
}

#[derive(Deserialize)]
pub struct ConnectSelfhostInput {
    label: String,
    base_url: String,
    web_url: Option<String>,
    email: String,
    password: String,
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
pub fn rename_account(
    registry: State<'_, SharedAccountRegistry>,
    id: String,
    label: String,
) -> Result<AccountRecord, String> {
    if !valid_account_id(&id) {
        return Err("invalid account id".into());
    }
    let mut reg = registry.lock();
    reg.set_label(&id, label).map_err(|e| e.to_string())?;
    reg.list()
        .iter()
        .find(|a| a.id == id)
        .cloned()
        .ok_or_else(|| "Account not found".to_string())
}

#[tauri::command]
pub async fn switch_account(
    app: AppHandle,
    registry: State<'_, SharedAccountRegistry>,
    db: State<'_, SharedDatabase>,
    sync: State<'_, SharedSyncState>,
    id: String,
) -> Result<AccountRecord, String> {
    if !valid_account_id(&id) {
        return Err("invalid account id".into());
    }
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
    // Guard at the IPC boundary so a malformed id fails loudly before we touch
    // the filesystem. `AccountRegistry::remove` and `account_db_path` both
    // re-check, but a nice error message beats a silent no-op.
    if !valid_account_id(&id) {
        return Err("invalid account id".into());
    }
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

#[derive(Deserialize)]
pub struct CopyAccountDataInput {
    from_id: String,
    #[serde(default)]
    replace: bool,
}

/// Copy hosts/keys/groups (and secrets) from another profile into the active one.
#[tauri::command]
pub fn copy_account_data(
    app: AppHandle,
    registry: State<'_, SharedAccountRegistry>,
    db: State<'_, SharedDatabase>,
    input: CopyAccountDataInput,
) -> Result<crate::commands::backup::ImportBackupResult, String> {
    use crate::commands::backup::{build_backup, import_azalea_backup_db};
    use crate::store::db::Database;
    use std::sync::Arc;

    let from_id = input.from_id.trim().to_string();
    if from_id.is_empty() {
        return Err("Source account is required".into());
    }
    if !valid_account_id(&from_id) {
        return Err("invalid account id".into());
    }

    let active_id = registry.lock().active_id().to_string();
    if from_id == active_id {
        return Err("Cannot copy a profile onto itself".into());
    }

    let source_exists = registry.lock().list().iter().any(|a| a.id == from_id);
    if !source_exists {
        return Err("Source account not found".into());
    }

    let path = account_db_path(&app, &from_id).map_err(|e| e.to_string())?;
    if !path.exists() {
        return Err("Source profile has no local data yet".into());
    }

    let source_db = Database::open_path(path).map_err(|e| e.to_string())?;
    let source = Arc::new(parking_lot::Mutex::new(source_db));
    let backup = build_backup(&source, None)?;
    import_azalea_backup_db(&db, backup, input.replace, None)
}
