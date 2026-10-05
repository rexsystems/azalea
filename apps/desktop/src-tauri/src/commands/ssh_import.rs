use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::keys::{
    get_private_key, import_private_key, import_private_key_with_id, peek_private_key_meta,
    private_key_needs_passphrase,
};
use crate::models::Host;
use crate::store::SharedDatabase;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshDirKeyCandidate {
    pub path: String,
    pub name: String,
    pub key_type: Option<String>,
    pub fingerprint: Option<String>,
    pub encrypted: bool,
    pub already_imported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshDirHostCandidate {
    pub name: String,
    pub hostname: String,
    pub port: i64,
    pub username: String,
    pub identity_file: Option<String>,
    pub already_imported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshDirScanResult {
    pub ssh_dir: String,
    pub exists: bool,
    pub keys: Vec<SshDirKeyCandidate>,
    pub hosts: Vec<SshDirHostCandidate>,
}

#[derive(Debug, Deserialize)]
pub struct ImportSshDirInput {
    pub key_paths: Vec<String>,
    pub hosts: Vec<SshDirHostCandidate>,
    pub passphrase: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ImportSshDirResult {
    pub keys_imported: usize,
    pub keys_skipped: usize,
    pub keys_failed: Vec<String>,
    pub hosts_imported: usize,
    pub hosts_skipped: usize,
}

fn default_ssh_dir() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            return PathBuf::from(home).join(".ssh");
        }
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        if !profile.is_empty() {
            return PathBuf::from(profile).join(".ssh");
        }
    }
    PathBuf::from(".ssh")
}

fn home_dir() -> PathBuf {
    default_ssh_dir()
        .parent()
        .unwrap_or(Path::new("."))
        .to_path_buf()
}

fn looks_like_private_key(contents: &str) -> bool {
    let upper = contents.to_ascii_uppercase();
    upper.contains("PRIVATE KEY")
        || contents.lines().next().is_some_and(|l| l.starts_with("PuTTY-User-Key-File-"))
}

fn skip_ssh_filename(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        "config"
            | "known_hosts"
            | "known_hosts.old"
            | "authorized_keys"
            | "authorized_keys2"
            | "environment"
            | "rc"
    ) || lower.ends_with(".pub")
        || lower.ends_with(".json")
}

fn key_name_from_path(path: &Path) -> String {
    path.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("imported-key")
        .to_string()
}

fn expand_tilde(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        return home_dir().join(rest);
    }
    if path == "~" {
        return home_dir();
    }
    PathBuf::from(path)
}

/// True when `candidate` resolves to a path inside `base`. Canonicalises both
/// so `..` / symlinks cannot escape. Falls back to a lexical prefix check when
/// canonicalisation fails (e.g. the file was moved between scan and import).
///
/// This is the guard that prevents `import_ssh_dir` from being tricked into
/// reading arbitrary private keys off disk (e.g. `/etc/ssh/ssh_host_ed25519_key`,
/// another app's key material) and silently importing them into Azalea's
/// vault, from where they would be exportable, backup-able, and cloud-syncable.
fn is_within(base: &Path, candidate: &Path) -> bool {
    let base_canon = base.canonicalize().unwrap_or_else(|_| base.to_path_buf());
    let cand_canon = candidate
        .canonicalize()
        .unwrap_or_else(|_| candidate.to_path_buf());
    cand_canon.starts_with(&base_canon)
}

/// OpenSSH configs (esp. copied from Windows) often use `\`; treat as `/`.
fn normalize_ssh_path(path: &str) -> PathBuf {
    let trimmed = path.trim().trim_matches('"').trim_matches('\'');
    let unified = trimmed.replace('\\', "/");
    expand_tilde(&unified)
}

fn path_lookup_keys(path: &Path) -> Vec<String> {
    let mut keys = Vec::new();
    let display = path.display().to_string();
    keys.push(display.clone());
    if let Ok(canon) = path.canonicalize() {
        let c = canon.display().to_string();
        if c != display {
            keys.push(c);
        }
    }
    keys
}

fn remember_path_key(
    map: &mut std::collections::HashMap<String, String>,
    path: &Path,
    key_id: &str,
) {
    for k in path_lookup_keys(path) {
        map.insert(k, key_id.to_string());
    }
}

fn resolve_identity_key_id(
    identity: &str,
    path_to_key_id: &std::collections::HashMap<String, String>,
) -> Option<String> {
    let expanded = normalize_ssh_path(identity);
    for k in path_lookup_keys(&expanded) {
        if let Some(id) = path_to_key_id.get(&k) {
            return Some(id.clone());
        }
    }
    let want_name = expanded.file_name()?.to_str()?;
    let mut by_name: Option<String> = None;
    for (p, id) in path_to_key_id {
        let candidate = normalize_ssh_path(p);
        if candidate.as_path() == expanded.as_path() {
            return Some(id.clone());
        }
        if candidate.file_name().and_then(|s| s.to_str()) == Some(want_name) {
            by_name = Some(id.clone());
        }
    }
    by_name
}

fn paths_equivalent(a: &Path, b: &Path) -> bool {
    if a == b {
        return true;
    }
    let a_keys = path_lookup_keys(a);
    let b_keys = path_lookup_keys(b);
    a_keys.iter().any(|ak| b_keys.iter().any(|bk| ak == bk))
}

/// Paths allowed for import: anything under ~/.ssh, plus IdentityFile entries
/// from the user's ~/.ssh/config (re-read on the backend; never trust arbitrary paths).
fn load_config_identity_paths(ssh_dir: &Path) -> Vec<PathBuf> {
    let config_path = ssh_dir.join("config");
    let Ok(config) = fs::read_to_string(&config_path) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for host in parse_config_hosts(&config) {
        let Some(identity) = host.identity_file else {
            continue;
        };
        let path = normalize_ssh_path(&identity);
        if out.iter().any(|p: &PathBuf| paths_equivalent(p, &path)) {
            continue;
        }
        out.push(path);
    }
    out
}

fn is_import_allowed(ssh_dir: &Path, path: &Path, config_identities: &[PathBuf]) -> bool {
    if is_within(ssh_dir, path) {
        return true;
    }
    config_identities
        .iter()
        .any(|allowed| paths_equivalent(allowed, path))
}

fn probe_key_candidate(
    path: &Path,
    existing_keys: &[crate::models::SshKeyRecord],
) -> Option<SshDirKeyCandidate> {
    if !path.is_file() {
        return None;
    }
    let file_name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
    if skip_ssh_filename(file_name) {
        return None;
    }
    let contents = fs::read_to_string(path).ok()?;
    if !looks_like_private_key(&contents) {
        return None;
    }
    let name = key_name_from_path(path);
    let encrypted = private_key_needs_passphrase(&contents);
    let (key_type, fingerprint, already_imported) = if encrypted {
        (None, None, false)
    } else if let Ok((kt, fp)) = peek_private_key_meta(&contents, None) {
        let already = existing_keys.iter().any(|k| k.fingerprint == fp);
        (Some(kt), Some(fp), already)
    } else {
        (None, None, false)
    };
    Some(SshDirKeyCandidate {
        path: path.display().to_string(),
        name,
        key_type,
        fingerprint,
        encrypted,
        already_imported,
    })
}

/// OpenSSH `Host a b` aliases → display name `a | b` (patterns skipped).
fn format_host_aliases(value: &str) -> Option<String> {
    let aliases: Vec<&str> = value
        .split_whitespace()
        .filter(|alias| !alias.contains('*') && !alias.contains('?'))
        .collect();
    if aliases.is_empty() {
        return None;
    }
    Some(aliases.join(" | "))
}

fn parse_config_hosts(config: &str) -> Vec<SshDirHostCandidate> {
    let mut out = Vec::new();
    let mut current_name: Option<String> = None;
    let mut current_hostname: Option<String> = None;
    let mut current_user = "root".to_string();
    let mut current_port = 22i64;
    let mut current_identity: Option<String> = None;

    let flush = |out: &mut Vec<SshDirHostCandidate>,
                 name: &str,
                 hostname: &str,
                 user: &str,
                 port: i64,
                 identity: Option<String>| {
        if hostname.is_empty() {
            return;
        }
        // One Host block = one candidate even when it has multiple aliases.
        if out.iter().any(|h| {
            h.hostname.eq_ignore_ascii_case(hostname)
                && h.port == port
                && h.username == user
        }) {
            return;
        }
        out.push(SshDirHostCandidate {
            name: name.to_string(),
            hostname: hostname.to_string(),
            port,
            username: user.to_string(),
            identity_file: identity,
            already_imported: false,
        });
    };

    for raw_line in config.lines() {
        let line = raw_line.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split_whitespace();
        let keyword = parts.next().unwrap_or("").to_ascii_lowercase();
        let value = parts.collect::<Vec<_>>().join(" ");

        if keyword == "host" {
            if let (Some(name), Some(hostname)) = (&current_name, &current_hostname) {
                flush(
                    &mut out,
                    name,
                    hostname,
                    &current_user,
                    current_port,
                    current_identity.clone(),
                );
            }
            current_name = format_host_aliases(&value);
            current_hostname = None;
            current_user = "root".to_string();
            current_port = 22;
            current_identity = None;
            continue;
        }

        match keyword.as_str() {
            "hostname" => current_hostname = Some(value),
            "user" => current_user = value,
            "port" => current_port = value.parse().unwrap_or(22),
            "identityfile" => {
                current_identity = Some(normalize_ssh_path(&value).display().to_string())
            }
            _ => {}
        }
    }

    if let (Some(name), Some(hostname)) = (&current_name, &current_hostname) {
        flush(
            &mut out,
            name,
            hostname,
            &current_user,
            current_port,
            current_identity,
        );
    }

    out
}

#[tauri::command]
pub fn scan_ssh_dir(db: tauri::State<'_, SharedDatabase>) -> Result<SshDirScanResult, String> {
    let ssh_dir = default_ssh_dir();
    let ssh_dir_str = ssh_dir.display().to_string();

    if !ssh_dir.is_dir() {
        return Ok(SshDirScanResult {
            ssh_dir: ssh_dir_str,
            exists: false,
            keys: vec![],
            hosts: vec![],
        });
    }

    let existing_keys = db.lock().list_keys().map_err(|e| e.to_string())?;
    let existing_hosts = db.lock().list_hosts().map_err(|e| e.to_string())?;

    let mut keys = Vec::new();
    let entries = fs::read_dir(&ssh_dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if let Some(candidate) = probe_key_candidate(&path, &existing_keys) {
            let dup = candidate.fingerprint.as_ref().is_some_and(|fp| {
                keys.iter().any(|k: &SshDirKeyCandidate| k.fingerprint.as_ref() == Some(fp))
            }) || keys
                .iter()
                .any(|k| paths_equivalent(&normalize_ssh_path(&k.path), &path));
            if !dup {
                keys.push(candidate);
            }
        }
    }

    let mut hosts = Vec::new();
    let config_path = ssh_dir.join("config");
    if config_path.is_file() {
        if let Ok(config) = fs::read_to_string(&config_path) {
            hosts = parse_config_hosts(&config);
            for host in &mut hosts {
                host.already_imported = existing_hosts.iter().any(|h| {
                    h.hostname.eq_ignore_ascii_case(&host.hostname)
                        && h.port == host.port
                        && h.username == host.username
                });
            }
        }
    }

    // Also surface IdentityFile paths that live outside ~/.ssh.
    for identity_path in load_config_identity_paths(&ssh_dir) {
        if keys
            .iter()
            .any(|k| paths_equivalent(&normalize_ssh_path(&k.path), &identity_path))
        {
            continue;
        }
        if let Some(candidate) = probe_key_candidate(&identity_path, &existing_keys) {
            let dup_fp = candidate.fingerprint.as_ref().is_some_and(|fp| {
                keys.iter().any(|k: &SshDirKeyCandidate| k.fingerprint.as_ref() == Some(fp))
            });
            if !dup_fp {
                keys.push(candidate);
            }
        }
    }

    keys.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(SshDirScanResult {
        ssh_dir: ssh_dir_str,
        exists: true,
        keys,
        hosts,
    })
}

#[tauri::command]
pub fn import_ssh_dir(
    db: tauri::State<'_, SharedDatabase>,
    input: ImportSshDirInput,
) -> Result<ImportSshDirResult, String> {
    let mut keys_imported = 0usize;
    let mut keys_skipped = 0usize;
    let mut keys_failed = Vec::new();
    let mut path_to_key_id: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    let ensure_key_for_path =
        |path: &Path,
         passphrase: Option<&str>,
         path_to_key_id: &mut std::collections::HashMap<String, String>,
         keys_imported: &mut usize,
         keys_skipped: &mut usize,
         keys_failed: &mut Vec<String>,
         db: &SharedDatabase|
         -> Option<String> {
            for k in path_lookup_keys(path) {
                if let Some(id) = path_to_key_id.get(&k) {
                    return Some(id.clone());
                }
            }

            let name = key_name_from_path(path);
            let contents = match fs::read_to_string(path) {
                Ok(c) => c,
                Err(err) => {
                    keys_failed.push(format!("{name}: {err}"));
                    return None;
                }
            };

            let meta = match peek_private_key_meta(&contents, passphrase) {
                Ok(m) => m,
                Err(err) => {
                    keys_failed.push(format!("{name}: {err}"));
                    return None;
                }
            };
            let fingerprint = meta.1;

            let existing_keys = match db.lock().list_keys() {
                Ok(k) => k,
                Err(err) => {
                    keys_failed.push(format!("{name}: {err}"));
                    return None;
                }
            };

            if let Some(existing) = existing_keys.iter().find(|k| k.fingerprint == fingerprint) {
                // Metadata can outlive keychain material (delete + partial restore).
                // Refresh the private key under the existing id when missing.
                let material_ok = get_private_key(&existing.id)
                    .ok()
                    .flatten()
                    .is_some();
                if !material_ok {
                    match import_private_key_with_id(&name, &contents, passphrase, Some(&existing.id))
                    {
                        Ok(_) => {
                            remember_path_key(path_to_key_id, path, &existing.id);
                            *keys_imported += 1;
                            return Some(existing.id.clone());
                        }
                        Err(err) => {
                            keys_failed.push(format!("{name}: {err}"));
                            return None;
                        }
                    }
                }
                *keys_skipped += 1;
                remember_path_key(path_to_key_id, path, &existing.id);
                return Some(existing.id.clone());
            }

            match import_private_key(&name, &contents, passphrase) {
                Ok(key) => {
                    if let Err(err) = db.lock().insert_key(&key) {
                        keys_failed.push(format!("{name}: {err}"));
                        return None;
                    }
                    remember_path_key(path_to_key_id, path, &key.id);
                    *keys_imported += 1;
                    Some(key.id)
                }
                Err(err) => {
                    keys_failed.push(format!("{name}: {err}"));
                    None
                }
            }
        };

    let passphrase = input.passphrase.as_deref();
    let ssh_dir_for_scope = default_ssh_dir();
    let config_identities = load_config_identity_paths(&ssh_dir_for_scope);
    for path_str in &input.key_paths {
        let path = normalize_ssh_path(path_str);
        // Allow ~/.ssh keys and IdentityFile paths declared in ~/.ssh/config.
        // Arbitrary paths are still refused so a compromised webview cannot
        // vacuum /etc/ssh/ssh_host_*_key or unrelated private key material.
        if !is_import_allowed(&ssh_dir_for_scope, &path, &config_identities) {
            keys_failed.push(format!(
                "{}: refused (not in ~/.ssh or config IdentityFile)",
                key_name_from_path(&path)
            ));
            continue;
        }
        let _ = ensure_key_for_path(
            &path,
            passphrase,
            &mut path_to_key_id,
            &mut keys_imported,
            &mut keys_skipped,
            &mut keys_failed,
            &db,
        );
    }

    // Index every on-disk private key that already matches a vault fingerprint,
    // so IdentityFile links work even when the key wasn't re-selected this run.
    let ssh_dir = default_ssh_dir();
    if ssh_dir.is_dir() {
        let vault_keys = db.lock().list_keys().map_err(|e| e.to_string())?;
        if let Ok(entries) = fs::read_dir(&ssh_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let file_name = path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("");
                if skip_ssh_filename(file_name) {
                    continue;
                }
                let Ok(contents) = fs::read_to_string(&path) else {
                    continue;
                };
                if !looks_like_private_key(&contents) {
                    continue;
                }
                let Ok((_, fp)) = peek_private_key_meta(&contents, passphrase)
                    .or_else(|_| peek_private_key_meta(&contents, None))
                else {
                    continue;
                };
                if let Some(existing) = vault_keys.iter().find(|k| k.fingerprint == fp) {
                    remember_path_key(&mut path_to_key_id, &path, &existing.id);
                }
            }
        }
        // Also index allowed IdentityFile paths outside ~/.ssh.
        for identity_path in &config_identities {
            if is_within(&ssh_dir, identity_path) {
                continue;
            }
            let Ok(contents) = fs::read_to_string(identity_path) else {
                continue;
            };
            if !looks_like_private_key(&contents) {
                continue;
            }
            let Ok((_, fp)) = peek_private_key_meta(&contents, passphrase)
                .or_else(|_| peek_private_key_meta(&contents, None))
            else {
                continue;
            };
            if let Some(existing) = vault_keys.iter().find(|k| k.fingerprint == fp) {
                remember_path_key(&mut path_to_key_id, identity_path, &existing.id);
            }
        }
    }

    let mut hosts_imported = 0usize;
    let mut hosts_skipped = 0usize;
    let existing_hosts = db.lock().list_hosts().map_err(|e| e.to_string())?;
    let mut seen_hosts: Vec<(String, i64, String)> = existing_hosts
        .iter()
        .map(|h| (h.hostname.to_ascii_lowercase(), h.port, h.username.clone()))
        .collect();

    for host in &input.hosts {
        let mut key_id = None;
        if let Some(identity) = &host.identity_file {
            let identity_path = normalize_ssh_path(identity);
            key_id = resolve_identity_key_id(identity, &path_to_key_id);
            if key_id.is_none()
                && identity_path.is_file()
                && is_import_allowed(&ssh_dir_for_scope, &identity_path, &config_identities)
            {
                key_id = ensure_key_for_path(
                    &identity_path,
                    passphrase,
                    &mut path_to_key_id,
                    &mut keys_imported,
                    &mut keys_skipped,
                    &mut keys_failed,
                    &db,
                );
            }
        }

        let host_key = (
            host.hostname.to_ascii_lowercase(),
            host.port,
            host.username.clone(),
        );
        if let Some(existing) = existing_hosts.iter().find(|h| {
            h.hostname.eq_ignore_ascii_case(&host.hostname)
                && h.port == host.port
                && h.username == host.username
        }) {
            hosts_skipped += 1;
            // Repair prior imports that missed IdentityFile linking, or hosts
            // still pointing at a deleted / ghost key_id.
            let key_broken = match existing.key_id.as_deref() {
                None => true,
                Some(kid) => get_private_key(kid).ok().flatten().is_none(),
            };
            if key_broken {
                if let Some(kid) = key_id {
                    let mut updated = existing.clone();
                    updated.key_id = Some(kid);
                    updated.auth_type = "key".to_string();
                    updated.updated_at = chrono::Utc::now().timestamp();
                    db.lock()
                        .update_host(&updated)
                        .map_err(|e| e.to_string())?;
                }
            }
            continue;
        }
        if seen_hosts.iter().any(|(h, p, u)| {
            h == &host_key.0 && *p == host_key.1 && u == &host_key.2
        }) {
            hosts_skipped += 1;
            continue;
        }

        let now = chrono::Utc::now().timestamp();
        let auth_type = if key_id.is_some() { "key" } else { "none" };
        let record = Host {
            id: Uuid::new_v4().to_string(),
            name: host.name.clone(),
            hostname: host.hostname.clone(),
            port: host.port,
            username: host.username.clone(),
            auth_type: auth_type.to_string(),
            key_id,
            group_id: None,
            mac_address: None,
            os_id: None,
            last_connected_at: None,
            created_at: now,
            updated_at: now,
        };
        db.lock()
            .insert_host(&record)
            .map_err(|e| e.to_string())?;
        seen_hosts.push(host_key);
        hosts_imported += 1;
    }

    // Repair any vault host still missing a key when ~/.ssh/config has IdentityFile.
    let config_path = default_ssh_dir().join("config");
    if config_path.is_file() {
        if let Ok(config) = fs::read_to_string(&config_path) {
            let config_hosts = parse_config_hosts(&config);
            let vault_hosts = db.lock().list_hosts().map_err(|e| e.to_string())?;
            for ch in &config_hosts {
                let Some(identity) = &ch.identity_file else {
                    continue;
                };
                let Some(existing) = vault_hosts.iter().find(|h| {
                    let key_broken = match h.key_id.as_deref() {
                        None => true,
                        Some(kid) => get_private_key(kid).ok().flatten().is_none(),
                    };
                    key_broken
                        && h.hostname.eq_ignore_ascii_case(&ch.hostname)
                        && h.port == ch.port
                        && h.username == ch.username
                }) else {
                    continue;
                };
                let identity_path = normalize_ssh_path(identity);
                let mut kid = resolve_identity_key_id(identity, &path_to_key_id);
                if kid.is_none()
                    && identity_path.is_file()
                    && is_import_allowed(&ssh_dir_for_scope, &identity_path, &config_identities)
                {
                    kid = ensure_key_for_path(
                        &identity_path,
                        passphrase,
                        &mut path_to_key_id,
                        &mut keys_imported,
                        &mut keys_skipped,
                        &mut keys_failed,
                        &db,
                    );
                }
                if let Some(kid) = kid {
                    let mut updated = existing.clone();
                    updated.key_id = Some(kid);
                    updated.auth_type = "key".to_string();
                    updated.updated_at = chrono::Utc::now().timestamp();
                    db.lock()
                        .update_host(&updated)
                        .map_err(|e| e.to_string())?;
                }
            }
        }
    }

    Ok(ImportSshDirResult {
        keys_imported,
        keys_skipped,
        keys_failed,
        hosts_imported,
        hosts_skipped,
    })
}
