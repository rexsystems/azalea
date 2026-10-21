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
        conn.busy_timeout(std::time::Duration::from_secs(15))?;
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
        conn.execute_batch(include_str!("../migrations/004_ai.sql"))?;
        let migrated: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM meta WHERE key='schema_005_plans')",
            [],
            |row| row.get(0),
        )?;
        if !migrated {
            conn.pragma_update(None, "foreign_keys", false)?;
            let result = (|| -> Result<()> {
                let tx = conn.unchecked_transaction()?;
                tx.execute_batch(include_str!("../migrations/005_plans.sql"))?;
                let violations = tx.prepare("PRAGMA foreign_key_check")?.exists([])?;
                anyhow::ensure!(!violations, "Plan migration would break foreign keys");
                tx.commit()?;
                Ok(())
            })();
            conn.pragma_update(None, "foreign_keys", true)?;
            result?;
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_migration_preserves_related_data_and_legacy_quota_settings() {
        let db = Database::open(Path::new(":memory:")).unwrap();
        db.with_conn(|conn| {
            conn.execute_batch(include_str!("../migrations/001_init.sql"))?;
            conn.execute_batch(include_str!("../migrations/002_password_reset.sql"))?;
            conn.execute_batch(include_str!("../migrations/003_desktop_auth_codes.sql"))?;
            conn.execute_batch(include_str!("../migrations/004_ai.sql"))?;
            conn.execute_batch("UPDATE settings SET free_limit_bytes=4096,pro_limit_bytes=8192;
                INSERT INTO users VALUES('u','u@example.com','hash','admin','pro',0,'created','updated');
                INSERT INTO sessions VALUES('s','u','refresh','expires','created');
                INSERT INTO vaults VALUES('u',7,'salt','verifier','recovery','ciphertext','updated');
                INSERT INTO password_resets VALUES('r','u','token','expires','created');
                INSERT INTO desktop_auth_codes VALUES('handle','challenge','state','code','u','created','approved','expires');
                INSERT INTO ai_usage VALUES('u',1,2);")?;
            Ok(())
        }).unwrap();
        db.migrate().unwrap();
        db.migrate().unwrap();
        db.with_conn(|conn| {
            assert_eq!(
                conn.query_row(
                    "SELECT password_hash||':'||plan FROM users WHERE id='u'",
                    [],
                    |r| r.get::<_, String>(0)
                )?,
                "hash:pro"
            );
            assert_eq!(
                conn.query_row("SELECT version FROM vaults WHERE user_id='u'", [], |r| r
                    .get::<_, i64>(0))?,
                7
            );
            assert_eq!(crate::plans::user_quota(conn, "u")?, 8192);
            for table in [
                "sessions",
                "vaults",
                "password_resets",
                "desktop_auth_codes",
                "ai_usage",
            ] {
                assert_eq!(
                    conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                        .get::<_, i64>(0))?,
                    1
                );
            }
            assert_eq!(
                conn.query_row("PRAGMA foreign_keys", [], |r| r.get::<_, i64>(0))?,
                1
            );
            assert!(!conn.prepare("PRAGMA foreign_key_check")?.exists([])?);
            conn.execute("UPDATE settings SET pro_limit_bytes=16384", [])?;
            assert_eq!(crate::plans::user_quota(conn, "u")?, 16384);
            conn.execute("UPDATE plans SET limit_bytes=32768 WHERE id='pro'", [])?;
            assert_eq!(
                conn.query_row("SELECT pro_limit_bytes FROM settings", [], |r| r
                    .get::<_, i64>(0))?,
                32768
            );
            conn.execute("DELETE FROM users WHERE id='u'", [])?;
            for table in [
                "sessions",
                "vaults",
                "password_resets",
                "desktop_auth_codes",
                "ai_usage",
            ] {
                assert_eq!(
                    conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                        .get::<_, i64>(0))?,
                    0
                );
            }
            Ok(())
        })
        .unwrap();
    }
}
