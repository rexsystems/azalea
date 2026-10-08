use axum::extract::{Path, State};
use axum::routing::{get, patch};
use axum::{Json, Router};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::auth::hash_password;
use crate::db::now_rfc3339;
use crate::error::{ApiError, ApiResult};
use crate::routes::extractors::AdminUser;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/v1/admin/settings",
            get(get_settings).patch(patch_settings),
        )
        .route("/v1/admin/users", get(list_users).post(create_user))
        .route("/v1/admin/users/{id}", patch(patch_user))
}

#[derive(Serialize)]
struct SettingsResponse {
    signup_enabled: bool,
    captcha_provider: String,
    captcha_site_key: String,
    captcha_secret_configured: bool,
    free_limit_bytes: i64,
    pro_limit_bytes: i64,
    instance_name: String,
}

#[derive(Deserialize)]
struct PatchSettingsBody {
    signup_enabled: Option<bool>,
    captcha_provider: Option<String>,
    captcha_site_key: Option<String>,
    captcha_secret_key: Option<String>,
    free_limit_bytes: Option<i64>,
    pro_limit_bytes: Option<i64>,
    instance_name: Option<String>,
}

#[derive(Serialize)]
struct AdminUserRow {
    id: String,
    email: String,
    role: String,
    plan: String,
    disabled: bool,
    vault_bytes: i64,
    created_at: String,
    updated_at: String,
    vault_updated_at: Option<String>,
    last_sign_in_at: Option<String>,
}

#[derive(Deserialize)]
struct CreateUserBody {
    email: String,
    password: String,
    #[serde(default = "default_role")]
    role: String,
    #[serde(default = "default_plan")]
    plan: String,
}

fn default_role() -> String {
    "user".into()
}

fn default_plan() -> String {
    "free".into()
}

#[derive(Deserialize)]
struct PatchUserBody {
    disabled: Option<bool>,
    role: Option<String>,
    plan: Option<String>,
    password: Option<String>,
}

async fn get_settings(
    State(state): State<Arc<AppState>>,
    _admin: AdminUser,
) -> ApiResult<Json<SettingsResponse>> {
    read_settings(&state)
}

fn read_settings(state: &AppState) -> ApiResult<Json<SettingsResponse>> {
    let row = state.db.with_conn(|conn| {
        Ok(conn.query_row(
            "SELECT signup_enabled, captcha_provider, captcha_site_key, captcha_secret_key,
                    free_limit_bytes, pro_limit_bytes, instance_name
             FROM settings WHERE id = 1",
            [],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, String>(6)?,
                ))
            },
        )?)
    })?;

    Ok(Json(SettingsResponse {
        signup_enabled: row.0 != 0,
        captcha_provider: row.1,
        captcha_site_key: row.2,
        captcha_secret_configured: !row.3.is_empty(),
        free_limit_bytes: row.4,
        pro_limit_bytes: row.5,
        instance_name: row.6,
    }))
}

async fn patch_settings(
    State(state): State<Arc<AppState>>,
    _admin: AdminUser,
    Json(body): Json<PatchSettingsBody>,
) -> ApiResult<Json<SettingsResponse>> {
    if body
        .instance_name
        .as_ref()
        .is_some_and(|value| value.trim().is_empty() || value.len() > 100)
        || body
            .free_limit_bytes
            .is_some_and(|value| !(1024..=1073741824).contains(&value))
        || body
            .pro_limit_bytes
            .is_some_and(|value| !(1024..=1073741824).contains(&value))
    {
        return Err(ApiError::BadRequest("Use a nonempty instance name (up to 100 characters) and storage limits between 1 KiB and 1 GiB.".into()));
    }
    if body
        .captcha_provider
        .as_ref()
        .is_some_and(|provider| !["none", "turnstile"].contains(&provider.as_str()))
    {
        return Err(ApiError::BadRequest(
            "Supported captcha providers are none and turnstile.".into(),
        ));
    }
    let (current_provider, current_site, current_secret) = state.db.with_conn(|conn| {
        Ok(conn.query_row(
            "SELECT captcha_provider,captcha_site_key,captcha_secret_key FROM settings WHERE id=1",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )?)
    })?;
    if body
        .captcha_provider
        .as_deref()
        .unwrap_or(&current_provider)
        == "turnstile"
        && (body
            .captcha_site_key
            .as_deref()
            .unwrap_or(&current_site)
            .trim()
            .is_empty()
            || body
                .captcha_secret_key
                .as_deref()
                .unwrap_or(&current_secret)
                .trim()
                .is_empty())
    {
        return Err(ApiError::BadRequest(
            "Turnstile needs a site key and a secret key.".into(),
        ));
    }
    state.db.with_conn(|conn| {
        let conn = conn.unchecked_transaction()?;
        if let Some(v) = body.signup_enabled {
            conn.execute(
                "UPDATE settings SET signup_enabled = ?1 WHERE id = 1",
                params![if v { 1 } else { 0 }],
            )?;
        }
        if let Some(v) = &body.captcha_provider {
            conn.execute(
                "UPDATE settings SET captcha_provider = ?1 WHERE id = 1",
                params![v],
            )?;
        }
        if let Some(v) = &body.captcha_site_key {
            conn.execute(
                "UPDATE settings SET captcha_site_key = ?1 WHERE id = 1",
                params![v],
            )?;
        }
        if let Some(v) = &body.captcha_secret_key {
            conn.execute(
                "UPDATE settings SET captcha_secret_key = ?1 WHERE id = 1",
                params![v],
            )?;
        }
        if let Some(v) = body.free_limit_bytes {
            conn.execute(
                "UPDATE settings SET free_limit_bytes = ?1 WHERE id = 1",
                params![v],
            )?;
        }
        if let Some(v) = body.pro_limit_bytes {
            conn.execute(
                "UPDATE settings SET pro_limit_bytes = ?1 WHERE id = 1",
                params![v],
            )?;
        }
        if let Some(v) = &body.instance_name {
            conn.execute(
                "UPDATE settings SET instance_name = ?1 WHERE id = 1",
                params![v.trim()],
            )?;
        }
        conn.commit()?;
        Ok(())
    })?;

    read_settings(&state)
}

async fn list_users(
    State(state): State<Arc<AppState>>,
    _admin: AdminUser,
) -> ApiResult<Json<Vec<AdminUserRow>>> {
    let users = state.db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT u.id, u.email, u.role, u.plan, u.disabled, u.created_at, u.updated_at,
                    COALESCE((
                      SELECT length(kdf_salt)+length(verifier)+length(ifnull(recovery_envelope,''))+length(ciphertext)
                      FROM vaults v WHERE v.user_id = u.id
                    ), 0),
                    (SELECT v.updated_at FROM vaults v WHERE v.user_id = u.id),
                    (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id)
             FROM users u ORDER BY u.created_at ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(AdminUserRow {
                id: r.get(0)?,
                email: r.get(1)?,
                role: r.get(2)?,
                plan: r.get(3)?,
                disabled: r.get::<_, i64>(4)? != 0,
                created_at: r.get(5)?,
                updated_at: r.get(6)?,
                vault_bytes: r.get(7)?,
                vault_updated_at: r.get(8)?,
                last_sign_in_at: r.get(9)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    })?;
    Ok(Json(users))
}

async fn create_user(
    State(state): State<Arc<AppState>>,
    _admin: AdminUser,
    Json(body): Json<CreateUserBody>,
) -> ApiResult<Json<AdminUserRow>> {
    let email = body.email.trim().to_lowercase();
    if !email.contains('@') {
        return Err(ApiError::BadRequest("invalid email".into()));
    }
    if body.password.len() < 8 {
        return Err(ApiError::BadRequest(
            "password must be at least 8 characters".into(),
        ));
    }
    let role = if body.role == "admin" {
        "admin"
    } else {
        "user"
    };
    let plan = if body.plan == "pro" { "pro" } else { "free" };
    let password_hash = hash_password(&body.password)?;
    let id = Uuid::new_v4().to_string();
    let now = now_rfc3339();

    let insert = state.db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO users (id, email, password_hash, role, plan, disabled, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)",
            params![id, email, password_hash, role, plan, now],
        )?;
        Ok(())
    });
    if let Err(e) = insert {
        if e.to_string().contains("UNIQUE") {
            return Err(ApiError::Conflict("email already registered".into()));
        }
        return Err(ApiError::Internal(e));
    }

    Ok(Json(AdminUserRow {
        id,
        email,
        role: role.into(),
        plan: plan.into(),
        disabled: false,
        vault_bytes: 0,
        created_at: now.clone(),
        updated_at: now,
        vault_updated_at: None,
        last_sign_in_at: None,
    }))
}

async fn patch_user(
    State(state): State<Arc<AppState>>,
    _admin: AdminUser,
    Path(id): Path<String>,
    Json(body): Json<PatchUserBody>,
) -> ApiResult<Json<serde_json::Value>> {
    use rusqlite::OptionalExtension;
    if body
        .role
        .as_deref()
        .is_some_and(|role| !["admin", "user"].contains(&role))
        || body
            .plan
            .as_deref()
            .is_some_and(|plan| !["free", "pro"].contains(&plan))
    {
        return Err(ApiError::BadRequest("Invalid role or plan.".into()));
    }
    if body
        .password
        .as_ref()
        .is_some_and(|password| !password.is_empty() && password.len() < 8)
    {
        return Err(ApiError::BadRequest(
            "Password must contain at least 8 characters.".into(),
        ));
    }
    let password_hash = body
        .password
        .as_deref()
        .filter(|password| !password.is_empty())
        .map(hash_password)
        .transpose()?;
    let now = now_rfc3339();
    let result = state.db.with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        let target: Option<(String, i64)> = tx
            .query_row(
                "SELECT role,disabled FROM users WHERE id=?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let Some((role, disabled)) = target else {
            return Ok(0);
        };
        if role == "admin"
            && disabled == 0
            && (body.disabled == Some(true) || body.role.as_deref() == Some("user"))
        {
            let admins: i64 = tx.query_row(
                "SELECT count(*) FROM users WHERE role='admin' AND disabled=0",
                [],
                |row| row.get(0),
            )?;
            if admins <= 1 {
                return Ok(1);
            }
        }
        if let Some(disabled) = body.disabled {
            tx.execute(
                "UPDATE users SET disabled=?2,updated_at=?3 WHERE id=?1",
                params![id, disabled, now],
            )?;
        }
        if let Some(role) = &body.role {
            tx.execute(
                "UPDATE users SET role=?2,updated_at=?3 WHERE id=?1",
                params![id, role, now],
            )?;
        }
        if let Some(plan) = &body.plan {
            tx.execute(
                "UPDATE users SET plan=?2,updated_at=?3 WHERE id=?1",
                params![id, plan, now],
            )?;
        }
        if let Some(hash) = &password_hash {
            tx.execute(
                "UPDATE users SET password_hash=?2,updated_at=?3 WHERE id=?1",
                params![id, hash, now],
            )?;
        }
        if body.disabled == Some(true) || password_hash.is_some() {
            tx.execute("DELETE FROM sessions WHERE user_id=?1", params![id])?;
        }
        tx.commit()?;
        Ok(2)
    })?;
    match result {
        0 => Err(ApiError::NotFound("User not found.".into())),
        1 => Err(ApiError::BadRequest(
            "Keep at least one active administrator.".into(),
        )),
        _ => Ok(Json(serde_json::json!({ "ok": true }))),
    }
}
