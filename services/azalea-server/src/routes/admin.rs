use axum::extract::{Path, State};
use axum::routing::{get, patch};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::auth::hash_password;
use crate::db::now_rfc3339;
use rusqlite::params;
use crate::error::{ApiError, ApiResult};
use crate::routes::extractors::{require_admin, AuthUser};
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
struct AdminUser {
    id: String,
    email: String,
    role: String,
    plan: String,
    disabled: bool,
    vault_bytes: i64,
    created_at: String,
}

#[derive(Deserialize)]
struct CreateUserBody {
    email: String,
    password: String,
    #[serde(default = "default_role")]
    role: String,
}

fn default_role() -> String {
    "user".into()
}

#[derive(Deserialize)]
struct PatchUserBody {
    disabled: Option<bool>,
    role: Option<String>,
    plan: Option<String>,
}

async fn get_settings(
    State(state): State<Arc<AppState>>,
    AuthUser(claims): AuthUser,
) -> ApiResult<Json<SettingsResponse>> {
    require_admin(&claims)?;
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
    AuthUser(claims): AuthUser,
    Json(body): Json<PatchSettingsBody>,
) -> ApiResult<Json<SettingsResponse>> {
    require_admin(&claims)?;

    state.db.with_conn(|conn| {
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
                params![v],
            )?;
        }
        Ok(())
    })?;

    get_settings(State(state), AuthUser(claims)).await
}

async fn list_users(
    State(state): State<Arc<AppState>>,
    AuthUser(claims): AuthUser,
) -> ApiResult<Json<Vec<AdminUser>>> {
    require_admin(&claims)?;
    let users = state.db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT u.id, u.email, u.role, u.plan, u.disabled, u.created_at,
                    COALESCE((
                      SELECT length(kdf_salt)+length(verifier)+length(ifnull(recovery_envelope,''))+length(ciphertext)
                      FROM vaults v WHERE v.user_id = u.id
                    ), 0)
             FROM users u ORDER BY u.created_at ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(AdminUser {
                id: r.get(0)?,
                email: r.get(1)?,
                role: r.get(2)?,
                plan: r.get(3)?,
                disabled: r.get::<_, i64>(4)? != 0,
                created_at: r.get(5)?,
                vault_bytes: r.get(6)?,
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
    AuthUser(claims): AuthUser,
    Json(body): Json<CreateUserBody>,
) -> ApiResult<Json<AdminUser>> {
    require_admin(&claims)?;
    let email = body.email.trim().to_lowercase();
    if !email.contains('@') {
        return Err(ApiError::BadRequest("invalid email".into()));
    }
    if body.password.len() < 8 {
        return Err(ApiError::BadRequest(
            "password must be at least 8 characters".into(),
        ));
    }
    let role = if body.role == "admin" { "admin" } else { "user" };
    let password_hash = hash_password(&body.password)?;
    let id = Uuid::new_v4().to_string();
    let now = now_rfc3339();

    let insert = state.db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO users (id, email, password_hash, role, plan, disabled, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'free', 0, ?5, ?5)",
            params![id, email, password_hash, role, now],
        )?;
        Ok(())
    });
    if let Err(e) = insert {
        if e.to_string().contains("UNIQUE") {
            return Err(ApiError::Conflict("email already registered".into()));
        }
        return Err(ApiError::Internal(e));
    }

    Ok(Json(AdminUser {
        id,
        email,
        role: role.into(),
        plan: "free".into(),
        disabled: false,
        vault_bytes: 0,
        created_at: now,
    }))
}

async fn patch_user(
    State(state): State<Arc<AppState>>,
    AuthUser(claims): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<PatchUserBody>,
) -> ApiResult<Json<serde_json::Value>> {
    require_admin(&claims)?;
    let now = now_rfc3339();
    state.db.with_conn(|conn| {
        if let Some(disabled) = body.disabled {
            conn.execute(
                "UPDATE users SET disabled = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, if disabled { 1 } else { 0 }, now],
            )?;
        }
        if let Some(role) = &body.role {
            if role == "admin" || role == "user" {
                conn.execute(
                    "UPDATE users SET role = ?2, updated_at = ?3 WHERE id = ?1",
                    params![id, role, now],
                )?;
            }
        }
        if let Some(plan) = &body.plan {
            if plan == "free" || plan == "pro" {
                conn.execute(
                    "UPDATE users SET plan = ?2, updated_at = ?3 WHERE id = ?1",
                    params![id, plan, now],
                )?;
            }
        }
        Ok(())
    })?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
