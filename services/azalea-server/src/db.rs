use std::path::Path;

use anyhow::{Context, Result};
use parking_lot::Mutex;
use rusqlite::Connection;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path).with_context(|| format!("open db {}", path.display()))?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;",
        )?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn migrate(&self) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute_batch(include_str!("../migrations/001_init.sql"))?;
        conn.execute_batch(include_str!("../migrations/002_password_reset.sql"))?;
        conn.execute_batch(include_str!("../migrations/003_desktop_auth_codes.sql"))?;
        Ok(())
    }

    pub fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        let conn = self.conn.lock();
        f(&conn)
    }
}

pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}
