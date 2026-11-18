//! One-time copy of user data from the data directory used before the bundle
//! identifier changed. Without it, updated installs start on an empty profile.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

/// Identifier shipped up to v0.2.1-build.5.
const LEGACY_IDENTIFIER: &str = "com.azalea.desktop";
const MARKER_FILE: &str = ".legacy-migration";

/// Only app-owned entries. Webview storage is skipped because the webview may
/// already hold those files open when setup runs.
const APP_ENTRIES: &[&str] = &[
    "accounts.json",
    "accounts",
    "azalea.db",
    "keys",
    "passwords",
    "storage.key",
    "desktop.json",
    "voice",
];

#[derive(Debug, PartialEq, Eq)]
pub enum MigrationOutcome {
    NothingToDo,
    Migrated {
        backup: Option<PathBuf>,
    },
    /// Both directories hold data; the legacy one is left on disk untouched.
    KeptBoth {
        legacy: PathBuf,
    },
}

pub fn migrate_legacy_data_dir(data_dir: &Path) -> anyhow::Result<MigrationOutcome> {
    let Some(parent) = data_dir.parent() else {
        return Ok(MigrationOutcome::NothingToDo);
    };
    let legacy = parent.join(LEGACY_IDENTIFIER);
    migrate_from(&legacy, data_dir)
}

fn migrate_from(legacy: &Path, data_dir: &Path) -> anyhow::Result<MigrationOutcome> {
    if legacy == data_dir || !legacy.is_dir() || data_dir.join(MARKER_FILE).exists() {
        return Ok(MigrationOutcome::NothingToDo);
    }
    if !legacy.join("accounts.json").exists() && !legacy.join("azalea.db").exists() {
        return Ok(MigrationOutcome::NothingToDo);
    }

    fs::create_dir_all(data_dir)?;

    if has_user_data(data_dir) {
        write_marker(data_dir, &format!("kept-both {}", legacy.display()))?;
        return Ok(MigrationOutcome::KeptBoth {
            legacy: legacy.to_path_buf(),
        });
    }

    // The empty profile created by the updated build is moved aside, not deleted.
    let mut backup = None;
    for entry in APP_ENTRIES {
        let current = data_dir.join(entry);
        if current.exists() {
            let dir = backup.get_or_insert_with(|| {
                data_dir.join(format!(
                    "pre-migration-{}",
                    chrono::Utc::now().format("%Y%m%d%H%M%S")
                ))
            });
            fs::create_dir_all(&*dir)?;
            fs::rename(&current, dir.join(entry))?;
        }
    }

    for entry in APP_ENTRIES {
        let from = legacy.join(entry);
        if from.exists() {
            copy_recursive(&from, &data_dir.join(entry))?;
        }
    }

    write_marker(data_dir, &format!("migrated {}", legacy.display()))?;
    Ok(MigrationOutcome::Migrated { backup })
}

fn write_marker(data_dir: &Path, note: &str) -> anyhow::Result<()> {
    fs::write(data_dir.join(MARKER_FILE), note)?;
    Ok(())
}

fn copy_recursive(from: &Path, to: &Path) -> anyhow::Result<()> {
    if from.is_dir() {
        fs::create_dir_all(to)?;
        for entry in fs::read_dir(from)? {
            let entry = entry?;
            copy_recursive(&entry.path(), &to.join(entry.file_name()))?;
        }
    } else {
        // fs::copy keeps the 0600 mode on key and password files.
        fs::copy(from, to)?;
    }
    Ok(())
}

fn dir_has_files(dir: &Path) -> bool {
    fs::read_dir(dir)
        .map(|mut entries| entries.next().is_some())
        .unwrap_or(false)
}

/// Conservative: anything unreadable counts as user data so it is never moved.
fn has_user_data(data_dir: &Path) -> bool {
    if dir_has_files(&data_dir.join("keys")) || dir_has_files(&data_dir.join("passwords")) {
        return true;
    }

    let registry = data_dir.join("accounts.json");
    if registry.exists() {
        let Ok(raw) = fs::read_to_string(&registry) else {
            return true;
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
            return true;
        };
        let count = value
            .get("accounts")
            .and_then(|a| a.as_array())
            .map(Vec::len)
            .unwrap_or(0);
        if count > 1 {
            return true;
        }
    }

    let mut dbs = vec![data_dir.join("azalea.db")];
    if let Ok(entries) = fs::read_dir(data_dir.join("accounts")) {
        dbs.extend(entries.flatten().map(|e| e.path().join("azalea.db")));
    }
    dbs.iter()
        .filter(|db| db.exists())
        .any(|db| db_has_rows(db))
}

fn db_has_rows(path: &Path) -> bool {
    let Ok(conn) = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY) else {
        return true;
    };
    conn.query_row(
        "SELECT (SELECT COUNT(*) FROM hosts) + (SELECT COUNT(*) FROM keys)
              + (SELECT COUNT(*) FROM snippets) + (SELECT COUNT(*) FROM host_groups)",
        [],
        |row| row.get::<_, i64>(0),
    )
    .map(|n| n > 0)
    .unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("azalea-migration-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_profile(dir: &Path, hosts: usize) {
        let account = dir
            .join("accounts")
            .join("11111111-2222-3333-4444-555555555555");
        fs::create_dir_all(&account).unwrap();
        fs::write(
            dir.join("accounts.json"),
            r#"{"active_id":"11111111-2222-3333-4444-555555555555","accounts":[{"id":"11111111-2222-3333-4444-555555555555","kind":"offline","label":"Local"}]}"#,
        )
        .unwrap();
        let db = crate::store::db::Database::open_path(account.join("azalea.db")).unwrap();
        drop(db);
        let conn = Connection::open(account.join("azalea.db")).unwrap();
        for i in 0..hosts {
            conn.execute(
                "INSERT INTO hosts (id, name, hostname, port, username, auth_type, sync_version, created_at, updated_at)
                 VALUES (?1, 'h', 'example.org', 22, 'root', 'password', 0, 0, 0)",
                [format!("host-{i}")],
            )
            .unwrap();
        }
    }

    #[test]
    fn copies_legacy_over_empty_profile() {
        let root = temp_root("empty");
        let legacy = root.join(LEGACY_IDENTIFIER);
        let current = root.join("me.rexsystems.azalea.desktop");
        make_profile(&legacy, 3);
        make_profile(&current, 0);

        let outcome = migrate_from(&legacy, &current).unwrap();
        assert!(matches!(
            outcome,
            MigrationOutcome::Migrated { backup: Some(_) }
        ));
        let db = current.join("accounts/11111111-2222-3333-4444-555555555555/azalea.db");
        assert!(db_has_rows(&db));
        assert!(legacy.join("accounts.json").exists());
        assert_eq!(
            migrate_from(&legacy, &current).unwrap(),
            MigrationOutcome::NothingToDo
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn leaves_both_when_current_has_data() {
        let root = temp_root("both");
        let legacy = root.join(LEGACY_IDENTIFIER);
        let current = root.join("me.rexsystems.azalea.desktop");
        make_profile(&legacy, 2);
        make_profile(&current, 1);

        let outcome = migrate_from(&legacy, &current).unwrap();
        assert!(matches!(outcome, MigrationOutcome::KeptBoth { .. }));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn fresh_install_gets_legacy_data() {
        let root = temp_root("fresh");
        let legacy = root.join(LEGACY_IDENTIFIER);
        let current = root.join("me.rexsystems.azalea.desktop");
        make_profile(&legacy, 1);

        let outcome = migrate_from(&legacy, &current).unwrap();
        assert_eq!(outcome, MigrationOutcome::Migrated { backup: None });
        assert!(current.join("accounts.json").exists());
        fs::remove_dir_all(root).ok();
    }
}
