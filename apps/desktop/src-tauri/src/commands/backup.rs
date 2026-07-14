use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::keys::{
    delete_host_password, delete_private_key, get_host_password, get_private_key,
    store_host_password,
};
use crate::keys::generate::import_private_key_with_id;
use crate::models::{Host, HostGroup};
use crate::store::SharedDatabase;

const BACKUP_FORMAT: &str = "azalea-backup";
const BACKUP_VERSION: i64 = 1;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct BackupHost {
    pub id: String,
    pub name: String,
    pub hostname: String,
    pub port: i64,
    pub username: String,
    pub auth_type: String,
    pub key_id: Option<String>,
    pub group_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct BackupKey {
    pub id: String,
    pub name: String,
    pub public_key: String,
    pub key_type: String,
    pub fingerprint: String,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub private_key_pem: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AzaleaBackup {
    pub format: String,
    pub version: i64,
    pub exported_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings: Option<Value>,
    pub groups: Vec<HostGroup>,
    pub hosts: Vec<BackupHost>,
    pub keys: Vec<BackupKey>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ImportBackupResult {
    pub hosts_imported: usize,
    pub keys_imported: usize,
    pub groups_imported: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ImportResult {
    pub hosts_imported: usize,
    pub keys_imported: usize,
    pub groups_imported: usize,
    pub format: String,
}

#[derive(Debug, Deserialize)]
pub struct ImportBackupInput {
    data: String,
    replace: bool,
}

#[tauri::command]
pub fn export_backup(
    db: tauri::State<'_, SharedDatabase>,
    settings: Option<Value>,
) -> Result<String, String> {
    let backup = build_backup(&db, settings)?;
    serde_json::to_string_pretty(&backup).map_err(|err| err.to_string())
}

pub fn build_backup(db: &SharedDatabase, settings: Option<Value>) -> Result<AzaleaBackup, String> {
    let db = db.lock();
    let groups = db.list_groups().map_err(|err| err.to_string())?;
    let hosts = db.list_hosts().map_err(|err| err.to_string())?;
    let keys = db.list_keys().map_err(|err| err.to_string())?;

    let backup_hosts: Vec<BackupHost> = hosts
        .into_iter()
        .map(|host| {
            let password = get_host_password(&host.id).ok().flatten();
            BackupHost {
                id: host.id,
                name: host.name,
                hostname: host.hostname,
                port: host.port,
                username: host.username,
                auth_type: host.auth_type,
                key_id: host.key_id,
                group_id: host.group_id,
                created_at: host.created_at,
                updated_at: host.updated_at,
                password,
            }
        })
        .collect();

    let backup_keys: Vec<BackupKey> = keys
        .into_iter()
        .map(|key| {
            let private_key_pem = get_private_key(&key.id).ok().flatten();
            BackupKey {
                id: key.id,
                name: key.name,
                public_key: key.public_key,
                key_type: key.key_type,
                fingerprint: key.fingerprint,
                created_at: key.created_at,
                private_key_pem,
            }
        })
        .collect();

    Ok(AzaleaBackup {
        format: BACKUP_FORMAT.to_string(),
        version: BACKUP_VERSION,
        exported_at: chrono::Utc::now().timestamp(),
        settings,
        groups,
        hosts: backup_hosts,
        keys: backup_keys,
    })
}

#[tauri::command]
pub fn import_backup(
    db: tauri::State<'_, SharedDatabase>,
    input: ImportBackupInput,
) -> Result<ImportBackupResult, String> {
    let backup: AzaleaBackup = serde_json::from_str(&input.data)
        .map_err(|_| "Unrecognized backup format. Expected an Azalea backup file.".to_string())?;

    if backup.format != BACKUP_FORMAT {
        return Err("Invalid backup format.".to_string());
    }

    import_azalea_backup_db(&db, backup, input.replace, None)
}

#[tauri::command]
pub fn import_data_file(
    db: tauri::State<'_, SharedDatabase>,
    data: String,
    replace: bool,
) -> Result<ImportResult, String> {
    if let Ok(backup) = serde_json::from_str::<AzaleaBackup>(&data) {
        if backup.format == BACKUP_FORMAT {
            let result = import_azalea_backup_db(&db, backup, replace, None)?;
            return Ok(ImportResult {
                hosts_imported: result.hosts_imported,
                keys_imported: result.keys_imported,
                groups_imported: result.groups_imported,
                format: "azalea-backup".to_string(),
            });
        }
    }

    if data.contains("Host ") {
        let count = import_ssh_config(&db, &data, replace)?;
        return Ok(ImportResult {
            hosts_imported: count,
            keys_imported: 0,
            groups_imported: 0,
            format: "ssh-config".to_string(),
        });
    }

    let termius = import_termius_json(&db, &data, replace)?;
    Ok(ImportResult {
        hosts_imported: termius.hosts,
        keys_imported: termius.keys,
        groups_imported: termius.groups,
        format: "termius-json".to_string(),
    })
}

pub fn import_azalea_backup_db(
    db: &SharedDatabase,
    backup: AzaleaBackup,
    replace: bool,
    settings: Option<Value>,
) -> Result<ImportBackupResult, String> {
    let db = db.lock();

    if replace {
        let existing_hosts = db.list_hosts().map_err(|err| err.to_string())?;
        for host in existing_hosts {
            let _ = delete_host_password(&host.id);
        }
        let existing_keys = db.list_keys().map_err(|err| err.to_string())?;
        for key in existing_keys {
            let _ = delete_private_key(&key.id);
        }
        db.clear_all_hosts().map_err(|err| err.to_string())?;
        db.clear_all_keys().map_err(|err| err.to_string())?;
        db.clear_all_groups().map_err(|err| err.to_string())?;
    }

    let mut group_id_map = std::collections::HashMap::new();
    let mut groups_imported = 0usize;

    for group in backup.groups {
        if replace {
            let record = HostGroup {
                id: group.id.clone(),
                name: group.name.clone(),
                created_at: group.created_at,
            };
            db.insert_group(&record).map_err(|err| err.to_string())?;
            group_id_map.insert(group.id.clone(), group.id);
            groups_imported += 1;
        } else {
            match db.create_group(&group.name) {
                Ok(created) => {
                    group_id_map.insert(group.id, created.id);
                    groups_imported += 1;
                }
                Err(_) => {
                    if let Ok(existing) = db.list_groups() {
                        if let Some(found) = existing.iter().find(|g| g.name == group.name) {
                            group_id_map.insert(group.id, found.id.clone());
                        }
                    }
                }
            }
        }
    }

    let mut key_id_map = std::collections::HashMap::new();
    let mut keys_imported = 0usize;

    for key in backup.keys {
        let pem = key.private_key_pem.ok_or_else(|| {
            format!("Backup key \"{}\" is missing its private key material.", key.name)
        })?;
        let imported = if replace {
            import_private_key_with_id(&key.name, &pem, None, Some(&key.id))
        } else {
            import_private_key_with_id(&key.name, &pem, None, None)
        }
        .map_err(|err| err.to_string())?;
        db.insert_key(&imported).map_err(|err| err.to_string())?;
        key_id_map.insert(key.id, imported.id.clone());
        keys_imported += 1;
    }

    let mut hosts_imported = 0usize;
    for host in backup.hosts {
        let now = chrono::Utc::now().timestamp();
        let id = if replace {
            host.id.clone()
        } else {
            Uuid::new_v4().to_string()
        };
        let mapped_key_id = host.key_id.as_ref().and_then(|old| key_id_map.get(old).cloned());
        let mapped_group_id = host
            .group_id
            .as_ref()
            .and_then(|old| group_id_map.get(old).cloned());

        if let Some(password) = host.password.as_ref() {
            store_host_password(&id, password).map_err(|err| err.to_string())?;
        }

        let record = Host {
            id: id.clone(),
            name: host.name,
            hostname: host.hostname,
            port: host.port,
            username: host.username,
            auth_type: normalize_auth_type(
                &host.auth_type,
                mapped_key_id.is_some(),
                host.password.is_some(),
            ),
            key_id: mapped_key_id,
            group_id: mapped_group_id,
            created_at: host.created_at.max(0).min(now),
            updated_at: now,
        };

        db.insert_host(&record).map_err(|err| err.to_string())?;
        hosts_imported += 1;
    }

    Ok(ImportBackupResult {
        hosts_imported,
        keys_imported,
        groups_imported,
        settings: settings.or(backup.settings),
    })
}

struct TermiusImportCounts {
    hosts: usize,
    keys: usize,
    groups: usize,
}

fn import_termius_json(
    db: &tauri::State<'_, SharedDatabase>,
    data: &str,
    replace: bool,
) -> Result<TermiusImportCounts, String> {
    let value: Value =
        serde_json::from_str(data).map_err(|_| "Could not parse JSON import file.".to_string())?;

    if replace {
        let db = db.lock();
        let existing_hosts = db.list_hosts().map_err(|err| err.to_string())?;
        for host in existing_hosts {
            let _ = delete_host_password(&host.id);
        }
        db.clear_all_hosts().map_err(|err| err.to_string())?;
    }

    let entries = extract_termius_entries(&value);
    if entries.is_empty() {
        return Err(
            "No hosts found. Use Termius JSON export or an OpenSSH config (Host blocks).".to_string(),
        );
    }

    let db = db.lock();
    let mut hosts_imported = 0usize;
    for entry in entries {
        let now = chrono::Utc::now().timestamp();
        let id = Uuid::new_v4().to_string();
        let auth_type = if entry.password.is_some() {
            "password".to_string()
        } else {
            "none".to_string()
        };

        if let Some(password) = entry.password.as_ref() {
            store_host_password(&id, password).map_err(|err| err.to_string())?;
        }

        let host = Host {
            id,
            name: entry.name,
            hostname: entry.hostname,
            port: entry.port,
            username: entry.username,
            auth_type,
            key_id: None,
            group_id: None,
            created_at: now,
            updated_at: now,
        };

        db.insert_host(&host).map_err(|err| err.to_string())?;
        hosts_imported += 1;
    }

    Ok(TermiusImportCounts {
        hosts: hosts_imported,
        keys: 0,
        groups: 0,
    })
}

struct ParsedHostEntry {
    name: String,
    hostname: String,
    port: i64,
    username: String,
    password: Option<String>,
}

fn extract_termius_entries(value: &Value) -> Vec<ParsedHostEntry> {
    match value {
        Value::Array(items) => items.iter().filter_map(parse_termius_object).collect(),
        Value::Object(map) => {
            if let Some(hosts) = map.get("hosts").and_then(|v| v.as_array()) {
                return hosts.iter().filter_map(parse_termius_object).collect();
            }
            if let Some(hosts) = map.get("data").and_then(|v| v.as_array()) {
                return hosts.iter().filter_map(parse_termius_object).collect();
            }
            map.get("host")
                .and_then(parse_termius_object)
                .into_iter()
                .collect()
        }
        _ => Vec::new(),
    }
}

fn parse_termius_object(value: &Value) -> Option<ParsedHostEntry> {
    let obj = value.as_object()?;
    let ssh = obj.get("ssh").and_then(|v| v.as_object());

    let hostname = pick_string(obj, &["hostname", "address", "host", "ip"])
        .or_else(|| ssh.and_then(|s| pick_string(s, &["hostname", "address", "host"])))?;

    if hostname.is_empty() {
        return None;
    }

    let username = pick_string(obj, &["username", "user"])
        .or_else(|| ssh.and_then(|s| pick_string(s, &["username", "user"])))
        .unwrap_or_else(|| "root".to_string());

    let port = pick_i64(obj, &["port"])
        .or_else(|| ssh.and_then(|s| pick_i64(s, &["port"])))
        .unwrap_or(22);

    let name = pick_string(obj, &["label", "name", "title"])
        .unwrap_or_else(|| hostname.split('.').next().unwrap_or(&hostname).to_string());

    let password = pick_string(obj, &["password"]).or_else(|| {
        obj.get("credentials")
            .and_then(|c| c.as_object())
            .and_then(|cred| pick_string(cred, &["password"]))
    });

    Some(ParsedHostEntry {
        name,
        hostname,
        port,
        username,
        password,
    })
}

fn import_ssh_config(db: &tauri::State<'_, SharedDatabase>, data: &str, replace: bool) -> Result<usize, String> {
    if replace {
        let db = db.lock();
        let existing_hosts = db.list_hosts().map_err(|err| err.to_string())?;
        for host in existing_hosts {
            let _ = delete_host_password(&host.id);
        }
        db.clear_all_hosts().map_err(|err| err.to_string())?;
    }

    let mut current_name: Option<String> = None;
    let mut current_hostname: Option<String> = None;
    let mut current_user = "root".to_string();
    let mut current_port = 22i64;
    let mut imported = 0usize;
    let db = db.lock();

    let mut flush = |name: &str, hostname: &str, user: &str, port: i64| -> Result<(), String> {
        let now = chrono::Utc::now().timestamp();
        let id = Uuid::new_v4().to_string();
        let host = Host {
            id,
            name: name.to_string(),
            hostname: hostname.to_string(),
            port,
            username: user.to_string(),
            auth_type: "none".to_string(),
            key_id: None,
            group_id: None,
            created_at: now,
            updated_at: now,
        };
        db.insert_host(&host).map_err(|err| err.to_string())?;
        imported += 1;
        Ok(())
    };

    for raw_line in data.lines() {
        let line = raw_line.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }

        let mut parts = line.split_whitespace();
        let keyword = parts.next().unwrap_or("").to_ascii_lowercase();
        let value = parts.collect::<Vec<_>>().join(" ");

        if keyword == "host" {
            if let (Some(name), Some(hostname)) = (current_name.as_ref(), current_hostname.as_ref()) {
                flush(name, hostname, &current_user, current_port)?;
            }
            current_name = Some(value.split('*').next().unwrap_or(&value).trim().to_string());
            current_hostname = None;
            current_user = "root".to_string();
            current_port = 22;
            continue;
        }

        match keyword.as_str() {
            "hostname" => current_hostname = Some(value),
            "user" => current_user = value,
            "port" => current_port = value.parse().unwrap_or(22),
            _ => {}
        }
    }

    if let (Some(name), Some(hostname)) = (current_name.as_ref(), current_hostname.as_ref()) {
        flush(name, hostname, &current_user, current_port)?;
    }

    Ok(imported)
}

fn normalize_auth_type(auth_type: &str, has_key: bool, has_password: bool) -> String {
    match auth_type {
        "none" => "none".to_string(),
        "key" if has_key => "key".to_string(),
        "password" if has_password => "password".to_string(),
        _ if has_key => "key".to_string(),
        _ if has_password => "password".to_string(),
        _ => "none".to_string(),
    }
}

fn pick_string(map: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| map.get(*key))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn pick_i64(map: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<i64> {
    keys.iter().find_map(|key| map.get(*key)).and_then(|v| {
        v.as_i64()
            .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
    })
}
