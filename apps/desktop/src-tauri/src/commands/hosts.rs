use uuid::Uuid;

use crate::keys::store_host_password;
use crate::models::{CreateHostInput, Host, UpdateHostInput};
use crate::store::SharedDatabase;

#[tauri::command]
pub fn list_hosts(db: tauri::State<'_, SharedDatabase>) -> Result<Vec<Host>, String> {
    db.lock()
        .list_hosts()
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn create_host(
    db: tauri::State<'_, SharedDatabase>,
    input: CreateHostInput,
) -> Result<Host, String> {
    let now = chrono::Utc::now().timestamp();
    let id = Uuid::new_v4().to_string();

    if let Some(password) = input.password.as_ref().filter(|p| !p.is_empty()) {
        store_host_password(&id, password).map_err(|err| err.to_string())?;
    }

    let key_id = input.key_id.filter(|value| !value.is_empty());
    let has_password = input.password.as_ref().is_some_and(|p| !p.is_empty());
    let auth_type = resolve_auth_type(&input.auth_type, key_id.is_some(), has_password);

    let host = Host {
        id: id.clone(),
        name: input.name,
        hostname: input.hostname,
        port: input.port,
        username: input.username,
        auth_type,
        key_id,
        group_id: input.group_id,
        mac_address: normalize_mac(input.mac_address),
        os_id: None,
        created_at: now,
        updated_at: now,
    };

    db.lock()
        .insert_host(&host)
        .map_err(|err| err.to_string())?;

    Ok(host)
}

#[tauri::command]
pub fn update_host(
    db: tauri::State<'_, SharedDatabase>,
    id: String,
    input: UpdateHostInput,
) -> Result<Host, String> {
    let mut host = db
        .lock()
        .get_host(&id)
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "Host not found".to_string())?;

    if let Some(name) = input.name {
        host.name = name;
    }
    if let Some(hostname) = input.hostname {
        host.hostname = hostname;
    }
    if let Some(port) = input.port {
        host.port = port;
    }
    if let Some(username) = input.username {
        host.username = username;
    }
    if let Some(key_id) = input.key_id {
        host.key_id = key_id.filter(|value| !value.is_empty());
    }
    if let Some(group_id) = input.group_id {
        host.group_id = group_id;
    }
    if let Some(mac_address) = input.mac_address {
        host.mac_address = normalize_mac(mac_address);
    }
    if let Some(password) = input.password {
        if !password.is_empty() {
            store_host_password(&id, &password).map_err(|err| err.to_string())?;
        }
    }

    let has_password = crate::keys::get_host_password(&id)
        .map(|p| p.is_some())
        .unwrap_or(false);
    let preferred = input.auth_type.unwrap_or_else(|| host.auth_type.clone());
    host.auth_type = resolve_auth_type(&preferred, host.key_id.is_some(), has_password);

    host.updated_at = chrono::Utc::now().timestamp();

    db.lock()
        .update_host(&host)
        .map_err(|err| err.to_string())?;

    Ok(host)
}

fn resolve_auth_type(preferred: &str, has_key: bool, has_password: bool) -> String {
    match preferred {
        "key" if has_key => "key".to_string(),
        "password" if has_password => "password".to_string(),
        _ if has_key => "key".to_string(),
        _ if has_password => "password".to_string(),
        _ => "none".to_string(),
    }
}

fn normalize_mac(mac: Option<String>) -> Option<String> {
    mac.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

#[tauri::command]
pub fn host_has_password(id: String) -> Result<bool, String> {
    crate::keys::get_host_password(&id)
        .map(|p| p.is_some())
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn delete_host(db: tauri::State<'_, SharedDatabase>, id: String) -> Result<(), String> {
    crate::keys::delete_host_password(&id).map_err(|err| err.to_string())?;
    db.lock()
        .delete_host(&id)
        .map_err(|err| err.to_string())
}
