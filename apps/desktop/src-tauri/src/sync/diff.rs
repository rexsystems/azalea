use std::collections::{HashMap, HashSet};

use serde::Serialize;
use serde_json::Value;

use crate::commands::backup::{AzaleaBackup, BackupHost, BackupKey};
use crate::models::HostGroup;
use crate::sync::crypto;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ItemDiff {
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub modified: Vec<String>,
}

impl ItemDiff {
    fn empty() -> Self {
        Self {
            added: Vec::new(),
            removed: Vec::new(),
            modified: Vec::new(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.added.is_empty() && self.removed.is_empty() && self.modified.is_empty()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct VaultDiff {
    pub hosts: ItemDiff,
    pub keys: ItemDiff,
    pub groups: ItemDiff,
}

impl VaultDiff {
    pub fn is_empty(&self) -> bool {
        self.hosts.is_empty() && self.keys.is_empty() && self.groups.is_empty()
    }
}

pub fn diff_backups(local: &AzaleaBackup, remote: &AzaleaBackup) -> VaultDiff {
    VaultDiff {
        hosts: diff_hosts(&local.hosts, &remote.hosts, &local.keys, &remote.keys, &local.groups, &remote.groups),
        keys: diff_keys(&local.keys, &remote.keys),
        groups: diff_groups(&local.groups, &remote.groups),
    }
}

/// Content hash that ignores UUIDs and timestamps so identical vaults match.
pub fn semantic_fingerprint(backup: &AzaleaBackup) -> String {
    #[derive(Serialize)]
    struct NormalizedKey {
        name: String,
        fingerprint: String,
        key_type: String,
    }

    #[derive(Serialize)]
    struct NormalizedHost {
        name: String,
        hostname: String,
        port: i64,
        username: String,
        auth_type: String,
        key_fingerprint: Option<String>,
        group_name: Option<String>,
        has_password: bool,
    }

    #[derive(Serialize)]
    struct NormalizedBackup {
        settings: Option<Value>,
        groups: Vec<String>,
        keys: Vec<NormalizedKey>,
        hosts: Vec<NormalizedHost>,
    }

    let local_key_fp: HashMap<String, String> = backup
        .keys
        .iter()
        .map(|k| (k.id.clone(), key_identity(k)))
        .collect();
    let group_names: HashMap<String, String> = backup
        .groups
        .iter()
        .map(|g| (g.id.clone(), g.name.clone()))
        .collect();

    let mut keys: Vec<NormalizedKey> = backup
        .keys
        .iter()
        .map(|k| NormalizedKey {
            name: k.name.clone(),
            fingerprint: key_identity(k),
            key_type: k.key_type.clone(),
        })
        .collect();
    keys.sort_by(|a, b| a.fingerprint.cmp(&b.fingerprint));

    let mut groups: Vec<String> = backup.groups.iter().map(|g| g.name.clone()).collect();
    groups.sort();

    let mut hosts: Vec<NormalizedHost> = backup
        .hosts
        .iter()
        .map(|h| NormalizedHost {
            name: h.name.clone(),
            hostname: h.hostname.clone(),
            port: h.port,
            username: h.username.clone(),
            auth_type: h.auth_type.clone(),
            key_fingerprint: resolve_key_fingerprint(h.key_id.as_deref(), &local_key_fp),
            group_name: resolve_group_name(h.group_id.as_deref(), &group_names),
            has_password: h.password.is_some(),
        })
        .collect();
    hosts.sort_by(|a, b| {
        (&a.hostname, a.port, &a.username).cmp(&(&b.hostname, b.port, &b.username))
    });

    let normalized = NormalizedBackup {
        settings: backup.settings.clone(),
        groups,
        keys,
        hosts,
    };

    let json = serde_json::to_string(&normalized).unwrap_or_default();
    crypto::vault_hash(&json)
}

fn key_identity(key: &BackupKey) -> String {
    if !key.fingerprint.is_empty() {
        key.fingerprint.clone()
    } else {
        key.public_key.clone()
    }
}

fn host_identity(host: &BackupHost) -> String {
    format!("{}:{}:{}", host.hostname, host.port, host.username)
}

fn group_identity(group: &HostGroup) -> String {
    group.name.clone()
}

fn resolve_key_fingerprint(
    key_id: Option<&str>,
    key_fps: &HashMap<String, String>,
) -> Option<String> {
    key_id.and_then(|id| key_fps.get(id).cloned())
}

fn resolve_group_name(group_id: Option<&str>, groups: &HashMap<String, String>) -> Option<String> {
    group_id.and_then(|id| groups.get(id).cloned())
}

fn diff_keys(local: &[BackupKey], remote: &[BackupKey]) -> ItemDiff {
    diff_by_identity(
        local,
        remote,
        key_identity,
        |k| format!("Key: {}", k.name),
        keys_equal,
    )
}

fn keys_equal(a: &BackupKey, b: &BackupKey) -> bool {
    a.name == b.name
        && key_identity(a) == key_identity(b)
        && a.key_type == b.key_type
        && a.public_key == b.public_key
}

fn diff_groups(local: &[HostGroup], remote: &[HostGroup]) -> ItemDiff {
    diff_by_identity(
        local,
        remote,
        |g| group_identity(g),
        |g| format!("Group: {}", g.name),
        |a, b| a.name == b.name,
    )
}

fn diff_hosts(
    local: &[BackupHost],
    remote: &[BackupHost],
    local_keys: &[BackupKey],
    remote_keys: &[BackupKey],
    local_groups: &[HostGroup],
    remote_groups: &[HostGroup],
) -> ItemDiff {
    let local_key_fps: HashMap<String, String> = local_keys
        .iter()
        .map(|k| (k.id.clone(), key_identity(k)))
        .collect();
    let remote_key_fps: HashMap<String, String> = remote_keys
        .iter()
        .map(|k| (k.id.clone(), key_identity(k)))
        .collect();
    let local_group_names: HashMap<String, String> = local_groups
        .iter()
        .map(|g| (g.id.clone(), g.name.clone()))
        .collect();
    let remote_group_names: HashMap<String, String> = remote_groups
        .iter()
        .map(|g| (g.id.clone(), g.name.clone()))
        .collect();

    let local_map: HashMap<String, &BackupHost> = local
        .iter()
        .map(|h| (host_identity(h), h))
        .collect();
    let remote_map: HashMap<String, &BackupHost> = remote
        .iter()
        .map(|h| (host_identity(h), h))
        .collect();
    let local_ids: HashSet<&str> = local_map.keys().map(String::as_str).collect();
    let remote_ids: HashSet<&str> = remote_map.keys().map(String::as_str).collect();

    let mut diff = ItemDiff::empty();

    for id in local_ids.difference(&remote_ids) {
        if let Some(host) = local_map.get(*id) {
            diff.added.push(format!("Host: {}", host.name));
        }
    }

    for id in remote_ids.difference(&local_ids) {
        if let Some(host) = remote_map.get(*id) {
            diff.removed.push(format!("Host: {}", host.name));
        }
    }

    for id in local_ids.intersection(&remote_ids) {
        let Some(local_host) = local_map.get(*id) else {
            continue;
        };
        let Some(remote_host) = remote_map.get(*id) else {
            continue;
        };
        if !hosts_equal(
            local_host,
            remote_host,
            &local_key_fps,
            &remote_key_fps,
            &local_group_names,
            &remote_group_names,
        ) {
            diff.modified.push(format!("Host: {}", local_host.name));
        }
    }

    diff
}

fn hosts_equal(
    a: &BackupHost,
    b: &BackupHost,
    a_key_fps: &HashMap<String, String>,
    b_key_fps: &HashMap<String, String>,
    a_groups: &HashMap<String, String>,
    b_groups: &HashMap<String, String>,
) -> bool {
    a.name == b.name
        && a.hostname == b.hostname
        && a.port == b.port
        && a.username == b.username
        && a.auth_type == b.auth_type
        && resolve_key_fingerprint(a.key_id.as_deref(), a_key_fps)
            == resolve_key_fingerprint(b.key_id.as_deref(), b_key_fps)
        && resolve_group_name(a.group_id.as_deref(), a_groups)
            == resolve_group_name(b.group_id.as_deref(), b_groups)
        && passwords_equal(a.password.as_deref(), b.password.as_deref())
}

fn passwords_equal(a: Option<&str>, b: Option<&str>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(left), Some(right)) => left == right,
        _ => false,
    }
}

fn diff_by_identity<T>(
    local: &[T],
    remote: &[T],
    identity: impl Fn(&T) -> String,
    label: impl Fn(&T) -> String,
    equal: impl Fn(&T, &T) -> bool,
) -> ItemDiff {
    let local_map: HashMap<String, &T> = local.iter().map(|item| (identity(item), item)).collect();
    let remote_map: HashMap<String, &T> = remote.iter().map(|item| (identity(item), item)).collect();
    let local_ids: HashSet<&str> = local_map.keys().map(String::as_str).collect();
    let remote_ids: HashSet<&str> = remote_map.keys().map(String::as_str).collect();

    let mut diff = ItemDiff::empty();

    for id in local_ids.difference(&remote_ids) {
        if let Some(item) = local_map.get(*id) {
            diff.added.push(label(item));
        }
    }

    for id in remote_ids.difference(&local_ids) {
        if let Some(item) = remote_map.get(*id) {
            diff.removed.push(label(item));
        }
    }

    for id in local_ids.intersection(&remote_ids) {
        let Some(local_item) = local_map.get(*id) else {
            continue;
        };
        let Some(remote_item) = remote_map.get(*id) else {
            continue;
        };
        if !equal(local_item, remote_item) {
            diff.modified.push(label(local_item));
        }
    }

    diff
}

pub fn local_side_diff(local: &AzaleaBackup, remote: &AzaleaBackup) -> VaultDiff {
    diff_backups(local, remote)
}

pub fn remote_side_diff(local: &AzaleaBackup, remote: &AzaleaBackup) -> VaultDiff {
    let raw = diff_backups(local, remote);
    VaultDiff {
        hosts: ItemDiff {
            added: raw.hosts.removed,
            removed: raw.hosts.added,
            modified: raw.hosts.modified,
        },
        keys: ItemDiff {
            added: raw.keys.removed,
            removed: raw.keys.added,
            modified: raw.keys.modified,
        },
        groups: ItemDiff {
            added: raw.groups.removed,
            removed: raw.groups.added,
            modified: raw.groups.modified,
        },
    }
}
