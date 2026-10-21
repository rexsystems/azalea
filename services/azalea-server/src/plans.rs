use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::error::{ApiError, ApiResult};

pub const MIN_QUOTA: i64 = 1024;
pub const MAX_QUOTA: i64 = 1073741824;

#[derive(Serialize)]
pub struct Plan {
    pub id: String,
    pub name: String,
    pub limit_bytes: i64,
    pub user_count: i64,
}

pub fn validate_quota(bytes: i64) -> ApiResult<()> {
    if !(MIN_QUOTA..=MAX_QUOTA).contains(&bytes) {
        return Err(ApiError::BadRequest(
            "Storage quota must be between 1 KiB and 1 GiB.".into(),
        ));
    }
    Ok(())
}

pub fn read_plans(conn: &Connection) -> anyhow::Result<Vec<Plan>> {
    let mut stmt = conn.prepare(
        "SELECT p.id,p.name,p.limit_bytes,(SELECT count(*) FROM users u WHERE u.plan=p.id)
         FROM plans p ORDER BY CASE p.id WHEN 'free' THEN 0 WHEN 'pro' THEN 1 ELSE 2 END,p.name,p.id",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Plan {
            id: row.get(0)?,
            name: row.get(1)?,
            limit_bytes: row.get(2)?,
            user_count: row.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn plan_exists(conn: &Connection, id: &str) -> anyhow::Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM plans WHERE id=?1)",
        params![id],
        |r| r.get(0),
    )?)
}

pub fn user_quota(conn: &Connection, user_id: &str) -> anyhow::Result<i64> {
    Ok(conn.query_row(
        "SELECT COALESCE(u.quota_override_bytes,p.limit_bytes)
         FROM users u JOIN plans p ON p.id=u.plan WHERE u.id=?1",
        params![user_id],
        |r| r.get(0),
    )?)
}

pub fn find_plan(conn: &Connection, id: &str) -> anyhow::Result<Option<Plan>> {
    Ok(conn
        .query_row(
            "SELECT p.id,p.name,p.limit_bytes,(SELECT count(*) FROM users u WHERE u.plan=p.id)
         FROM plans p WHERE p.id=?1",
            params![id],
            |r| {
                Ok(Plan {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    limit_bytes: r.get(2)?,
                    user_count: r.get(3)?,
                })
            },
        )
        .optional()?)
}
