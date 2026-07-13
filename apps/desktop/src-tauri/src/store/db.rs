use std::path::PathBuf;
use std::sync::Arc;

use rusqlite::{Connection, params};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::models::{Host, HostGroup, KnownHostRecord, PortForward, Snippet, SshKeyRecord};

const MIGRATIONS: &str = "
CREATE TABLE IF NOT EXISTS host_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hosts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hostname TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 22,
    username TEXT NOT NULL,
    auth_type TEXT NOT NULL,
    key_id TEXT,
    group_id TEXT REFERENCES host_groups(id) ON DELETE SET NULL,
    sync_version INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    key_type TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    sync_version INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS known_hosts (
    hostname TEXT NOT NULL,
    port INTEGER NOT NULL,
    key_type TEXT NOT NULL,
    public_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (hostname, port)
);

CREATE TABLE IF NOT EXISTS snippets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    command TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS port_forwards (
    id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    local_port INTEGER NOT NULL,
    remote_host TEXT NOT NULL,
    remote_port INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
";

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new(app: &AppHandle) -> anyhow::Result<Self> {
        let db_path = db_path(app)?;
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(db_path)?;
        conn.execute_batch(MIGRATIONS)?;
        let db = Self { conn };
        db.run_migrations()?;
        Ok(db)
    }

    fn run_migrations(&self) -> anyhow::Result<()> {
        if !Self::column_exists(&self.conn, "hosts", "group_id") {
            self.conn
                .execute("ALTER TABLE hosts ADD COLUMN group_id TEXT", [])?;
        }

        if Self::column_exists(&self.conn, "hosts", "group_name") {
            let mut stmt = self
                .conn
                .prepare("SELECT DISTINCT group_name FROM hosts WHERE group_name IS NOT NULL AND group_name != ''")?;
            let legacy_names: Vec<String> = stmt
                .query_map([], |row| row.get(0))?
                .filter_map(|r| r.ok())
                .collect();

            let now = chrono::Utc::now().timestamp();
            for name in legacy_names {
                let id = Uuid::new_v4().to_string();
                let _ = self.conn.execute(
                    "INSERT OR IGNORE INTO host_groups (id, name, created_at) VALUES (?1, ?2, ?3)",
                    params![id, name, now],
                );

                self.conn.execute(
                    "UPDATE hosts SET group_id = (SELECT id FROM host_groups WHERE name = ?1 LIMIT 1) WHERE group_name = ?1",
                    params![name],
                )?;
            }

            self.conn
                .execute_batch("ALTER TABLE hosts DROP COLUMN group_name;")
                .ok();
        }

        Ok(())
    }

    fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
        conn.prepare(&format!("PRAGMA table_info({table})"))
            .ok()
            .and_then(|mut stmt| {
                stmt.query_map([], |row| row.get::<_, String>(1))
                    .ok()
                    .map(|rows| rows.filter_map(|r| r.ok()).any(|name| name == column))
            })
            .unwrap_or(false)
    }

    pub fn list_groups(&self) -> anyhow::Result<Vec<HostGroup>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, created_at FROM host_groups ORDER BY name ASC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(HostGroup {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn create_group(&self, name: &str) -> anyhow::Result<HostGroup> {
        let group = HostGroup {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            created_at: chrono::Utc::now().timestamp(),
        };

        self.conn.execute(
            "INSERT INTO host_groups (id, name, created_at) VALUES (?1, ?2, ?3)",
            params![group.id, group.name, group.created_at],
        )?;

        Ok(group)
    }

    pub fn update_group(&self, id: &str, name: &str) -> anyhow::Result<HostGroup> {
        self.conn.execute(
            "UPDATE host_groups SET name = ?2 WHERE id = ?1",
            params![id, name],
        )?;

        self.conn
            .query_row(
                "SELECT id, name, created_at FROM host_groups WHERE id = ?1",
                params![id],
                |row| {
                    Ok(HostGroup {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        created_at: row.get(2)?,
                    })
                },
            )
            .map_err(Into::into)
    }

    pub fn delete_group(&self, id: &str) -> anyhow::Result<()> {
        self.conn.execute("UPDATE hosts SET group_id = NULL WHERE group_id = ?1", params![id])?;
        self.conn
            .execute("DELETE FROM host_groups WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn move_host_to_group(&self, host_id: &str, group_id: Option<&str>) -> anyhow::Result<()> {
        self.conn.execute(
            "UPDATE hosts SET group_id = ?2, updated_at = ?3 WHERE id = ?1",
            params![host_id, group_id, chrono::Utc::now().timestamp()],
        )?;
        Ok(())
    }

    pub fn list_hosts(&self) -> anyhow::Result<Vec<Host>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, hostname, port, username, auth_type, key_id, group_id, created_at, updated_at
             FROM hosts ORDER BY name ASC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(Host {
                id: row.get(0)?,
                name: row.get(1)?,
                hostname: row.get(2)?,
                port: row.get(3)?,
                username: row.get(4)?,
                auth_type: row.get(5)?,
                key_id: row.get(6)?,
                group_id: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn get_host(&self, id: &str) -> anyhow::Result<Option<Host>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, hostname, port, username, auth_type, key_id, group_id, created_at, updated_at
             FROM hosts WHERE id = ?1",
        )?;

        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(Host {
                id: row.get(0)?,
                name: row.get(1)?,
                hostname: row.get(2)?,
                port: row.get(3)?,
                username: row.get(4)?,
                auth_type: row.get(5)?,
                key_id: row.get(6)?,
                group_id: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn insert_host(&self, host: &Host) -> anyhow::Result<()> {
        self.conn.execute(
            "INSERT INTO hosts (id, name, hostname, port, username, auth_type, key_id, group_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                host.id,
                host.name,
                host.hostname,
                host.port,
                host.username,
                host.auth_type,
                host.key_id,
                host.group_id,
                host.created_at,
                host.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn update_host(&self, host: &Host) -> anyhow::Result<()> {
        self.conn.execute(
            "UPDATE hosts SET name = ?2, hostname = ?3, port = ?4, username = ?5, auth_type = ?6,
             key_id = ?7, group_id = ?8, updated_at = ?9 WHERE id = ?1",
            params![
                host.id,
                host.name,
                host.hostname,
                host.port,
                host.username,
                host.auth_type,
                host.key_id,
                host.group_id,
                host.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn delete_host(&self, id: &str) -> anyhow::Result<()> {
        self.conn
            .execute("DELETE FROM hosts WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn list_keys(&self) -> anyhow::Result<Vec<SshKeyRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, public_key, key_type, fingerprint, created_at FROM keys ORDER BY name ASC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(SshKeyRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                public_key: row.get(2)?,
                key_type: row.get(3)?,
                fingerprint: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn insert_key(&self, key: &SshKeyRecord) -> anyhow::Result<()> {
        self.conn.execute(
            "INSERT INTO keys (id, name, public_key, key_type, fingerprint, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                key.id,
                key.name,
                key.public_key,
                key.key_type,
                key.fingerprint,
                key.created_at,
            ],
        )?;
        Ok(())
    }

    pub fn delete_key(&self, id: &str) -> anyhow::Result<()> {
        self.conn
            .execute("DELETE FROM keys WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn clear_all_hosts(&self) -> anyhow::Result<()> {
        self.conn.execute("DELETE FROM hosts", [])?;
        Ok(())
    }

    pub fn clear_all_keys(&self) -> anyhow::Result<()> {
        self.conn.execute("DELETE FROM keys", [])?;
        Ok(())
    }

    pub fn clear_all_groups(&self) -> anyhow::Result<()> {
        self.conn.execute("DELETE FROM host_groups", [])?;
        Ok(())
    }

    pub fn get_known_host(&self, hostname: &str, port: i64) -> anyhow::Result<Option<KnownHostRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT hostname, port, key_type, public_key, fingerprint, created_at
             FROM known_hosts WHERE hostname = ?1 AND port = ?2",
        )?;
        let mut rows = stmt.query(params![hostname, port])?;
        if let Some(row) = rows.next()? {
            Ok(Some(KnownHostRecord {
                hostname: row.get(0)?,
                port: row.get(1)?,
                key_type: row.get(2)?,
                public_key: row.get(3)?,
                fingerprint: row.get(4)?,
                created_at: row.get(5)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn upsert_known_host(&self, record: &KnownHostRecord) -> anyhow::Result<()> {
        self.conn.execute(
            "INSERT INTO known_hosts (hostname, port, key_type, public_key, fingerprint, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(hostname, port) DO UPDATE SET
               key_type = excluded.key_type,
               public_key = excluded.public_key,
               fingerprint = excluded.fingerprint,
               created_at = excluded.created_at",
            params![
                record.hostname,
                record.port,
                record.key_type,
                record.public_key,
                record.fingerprint,
                record.created_at,
            ],
        )?;
        Ok(())
    }

    pub fn list_snippets(&self) -> anyhow::Result<Vec<Snippet>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, command, created_at FROM snippets ORDER BY name ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Snippet {
                id: row.get(0)?,
                name: row.get(1)?,
                command: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn insert_snippet(&self, snippet: &Snippet) -> anyhow::Result<()> {
        self.conn.execute(
            "INSERT INTO snippets (id, name, command, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![snippet.id, snippet.name, snippet.command, snippet.created_at],
        )?;
        Ok(())
    }

    pub fn update_snippet(&self, id: &str, name: &str, command: &str) -> anyhow::Result<()> {
        self.conn.execute(
            "UPDATE snippets SET name = ?2, command = ?3 WHERE id = ?1",
            params![id, name, command],
        )?;
        Ok(())
    }

    pub fn delete_snippet(&self, id: &str) -> anyhow::Result<()> {
        self.conn.execute("DELETE FROM snippets WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn list_port_forwards(&self, host_id: Option<&str>) -> anyhow::Result<Vec<PortForward>> {
        let (sql, use_filter) = match host_id {
            Some(_) => (
                "SELECT id, host_id, label, local_port, remote_host, remote_port, created_at
                 FROM port_forwards WHERE host_id = ?1 ORDER BY created_at ASC",
                true,
            ),
            None => (
                "SELECT id, host_id, label, local_port, remote_host, remote_port, created_at
                 FROM port_forwards ORDER BY created_at ASC",
                false,
            ),
        };

        let mut stmt = self.conn.prepare(sql)?;
        let map_row = |row: &rusqlite::Row<'_>| {
            Ok(PortForward {
                id: row.get(0)?,
                host_id: row.get(1)?,
                label: row.get(2)?,
                local_port: row.get(3)?,
                remote_host: row.get(4)?,
                remote_port: row.get(5)?,
                created_at: row.get(6)?,
            })
        };

        let rows = if use_filter {
            stmt.query_map(params![host_id.unwrap()], map_row)?
                .collect::<Result<Vec<_>, _>>()?
        } else {
            stmt.query_map([], map_row)?
                .collect::<Result<Vec<_>, _>>()?
        };
        Ok(rows)
    }

    pub fn insert_port_forward(&self, fwd: &PortForward) -> anyhow::Result<()> {
        self.conn.execute(
            "INSERT INTO port_forwards (id, host_id, label, local_port, remote_host, remote_port, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                fwd.id,
                fwd.host_id,
                fwd.label,
                fwd.local_port,
                fwd.remote_host,
                fwd.remote_port,
                fwd.created_at,
            ],
        )?;
        Ok(())
    }

    pub fn delete_port_forward(&self, id: &str) -> anyhow::Result<()> {
        self.conn.execute("DELETE FROM port_forwards WHERE id = ?1", params![id])?;
        Ok(())
    }
}

fn db_path(app: &AppHandle) -> anyhow::Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    Ok(dir.join("azalea.db"))
}

pub type SharedDatabase = Arc<parking_lot::Mutex<Database>>;

pub fn init_database(app: &AppHandle) -> anyhow::Result<SharedDatabase> {
    Ok(Arc::new(parking_lot::Mutex::new(Database::new(app)?)))
}
