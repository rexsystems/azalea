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

    if input.auth_type == "password" {
        if let Some(password) = input.password.as_ref() {
            store_host_password(&id, password).map_err(|err| err.to_string())?;
        }
    }

    let host = Host {
        id: id.clone(),
        name: input.name,
        hostname: input.hostname,
        port: input.port,
        username: input.username,
        auth_type: input.auth_type,
        key_id: input.key_id,
        group_id: input.group_id,
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
    if let Some(auth_type) = input.auth_type {
        if auth_type == "password" || auth_type == "none" {
            host.key_id = None;
        }
        host.auth_type = auth_type;
    }
    if let Some(key_id) = input.key_id {
        host.key_id = Some(key_id);
    }
    if let Some(group_id) = input.group_id {
        host.group_id = group_id;
    }
    if let Some(password) = input.password {
        store_host_password(&id, &password).map_err(|err| err.to_string())?;
    }

    host.updated_at = chrono::Utc::now().timestamp();

    db.lock()
        .update_host(&host)
        .map_err(|err| err.to_string())?;

    Ok(host)
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
