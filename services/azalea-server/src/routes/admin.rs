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
use crate::plans::{self, Plan};
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
        .route("/v1/admin/plans", get(list_plans).post(create_plan))
        .route(
            "/v1/admin/plans/{id}",
            patch(patch_plan).delete(delete_plan),
        )
}

#[derive(Serialize)]
struct SettingsResponse {
    plans: Vec<Plan>,
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
    plan_name: String,
    quota_override_bytes: Option<i64>,
    vault_limit_bytes: i64,
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
    quota_override_bytes: Option<i64>,
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
    quota_override_bytes: Option<i64>,
    #[serde(default)]
    reset_quota: bool,
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
        plans: state.db.with_conn(plans::read_plans)?,
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
                    (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id),
                    p.name,u.quota_override_bytes,COALESCE(u.quota_override_bytes,p.limit_bytes)
             FROM users u JOIN plans p ON p.id=u.plan ORDER BY u.created_at ASC",
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
                plan_name: r.get(10)?,
                quota_override_bytes: r.get(11)?,
                vault_limit_bytes: r.get(12)?,
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
    let plan = body.plan.trim();
    let plan_info = state
        .db
        .with_conn(|conn| plans::find_plan(conn, plan))?
        .ok_or_else(|| ApiError::BadRequest("Choose an existing plan.".into()))?;
    if let Some(quota) = body.quota_override_bytes {
        plans::validate_quota(quota)?;
    }
    let password_hash = hash_password(&body.password)?;
    let id = Uuid::new_v4().to_string();
    let now = now_rfc3339();

    let insert = state.db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO users (id, email, password_hash, role, plan, disabled, created_at, updated_at,quota_override_bytes)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6, ?7)",
            params![id, email, password_hash, role, plan, now,body.quota_override_bytes],
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
        plan_name: plan_info.name,
        quota_override_bytes: body.quota_override_bytes,
        vault_limit_bytes: body.quota_override_bytes.unwrap_or(plan_info.limit_bytes),
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
    {
        return Err(ApiError::BadRequest("Invalid role or plan.".into()));
    }
    if let Some(quota) = body.quota_override_bytes {
        plans::validate_quota(quota)?;
    }
    if body.reset_quota && body.quota_override_bytes.is_some() {
        return Err(ApiError::BadRequest(
            "Choose a quota override or reset to the plan quota.".into(),
        ));
    }
    if let Some(plan) = &body.plan {
        if !state.db.with_conn(|conn| plans::plan_exists(conn, plan))? {
            return Err(ApiError::BadRequest("Choose an existing plan.".into()));
        }
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
        if body.reset_quota || body.quota_override_bytes.is_some() {
            tx.execute(
                "UPDATE users SET quota_override_bytes=?2,updated_at=?3 WHERE id=?1",
                params![id, body.quota_override_bytes, now],
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

#[derive(Deserialize)]
struct CreatePlanBody {
    id: String,
    name: String,
    limit_bytes: i64,
}

#[derive(Deserialize)]
struct PatchPlanBody {
    name: Option<String>,
    limit_bytes: Option<i64>,
}

fn validate_plan_name(name: &str) -> ApiResult<()> {
    if name.trim().is_empty() || name.chars().count() > 80 {
        return Err(ApiError::BadRequest(
            "Plan name must contain 1 to 80 characters.".into(),
        ));
    }
    Ok(())
}

async fn list_plans(
    State(state): State<Arc<AppState>>,
    _admin: AdminUser,
) -> ApiResult<Json<Vec<Plan>>> {
    Ok(Json(state.db.with_conn(plans::read_plans)?))
}

async fn create_plan(
    State(state): State<Arc<AppState>>,
    _admin: AdminUser,
    Json(body): Json<CreatePlanBody>,
) -> ApiResult<Json<Plan>> {
    let id = body.id.trim();
    if id.is_empty()
        || id.len() > 40
        || !id.as_bytes()[0].is_ascii_lowercase()
        || !id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'-')
        || ["personal", "all"].contains(&id)
    {
        return Err(ApiError::BadRequest("Plan ID must start with a lowercase letter and use up to 40 lowercase letters, digits, hyphens or underscores.".into()));
    }
    validate_plan_name(&body.name)?;
    plans::validate_quota(body.limit_bytes)?;
    let inserted = state.db.with_conn(|conn| {
        Ok(conn.execute(
            "INSERT INTO plans(id,name,limit_bytes) VALUES (?1,?2,?3) ON CONFLICT(id) DO NOTHING",
            params![id, body.name.trim(), body.limit_bytes],
        )?)
    })?;
    if inserted == 0 {
        return Err(ApiError::Conflict(
            "A plan with that ID already exists.".into(),
        ));
    }
    Ok(Json(Plan {
        id: id.into(),
        name: body.name.trim().into(),
        limit_bytes: body.limit_bytes,
        user_count: 0,
    }))
}

async fn patch_plan(
    State(state): State<Arc<AppState>>,
    _admin: AdminUser,
    Path(id): Path<String>,
    Json(body): Json<PatchPlanBody>,
) -> ApiResult<Json<Plan>> {
    if let Some(name) = &body.name {
        validate_plan_name(name)?;
    }
    if let Some(bytes) = body.limit_bytes {
        plans::validate_quota(bytes)?;
    }
    let plan = state
        .db
        .with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            if let Some(name) = &body.name {
                tx.execute(
                    "UPDATE plans SET name=?2 WHERE id=?1",
                    params![id, name.trim()],
                )?;
            }
            if let Some(bytes) = body.limit_bytes {
                tx.execute(
                    "UPDATE plans SET limit_bytes=?2 WHERE id=?1",
                    params![id, bytes],
                )?;
            }
            let result = plans::find_plan(&tx, &id)?;
            tx.commit()?;
            Ok(result)
        })?
        .ok_or_else(|| ApiError::NotFound("Plan not found.".into()))?;
    Ok(Json(plan))
}

async fn delete_plan(
    State(state): State<Arc<AppState>>,
    _admin: AdminUser,
    Path(id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    if ["free", "pro"].contains(&id.as_str()) {
        return Err(ApiError::BadRequest(
            "The Free and Pro defaults cannot be deleted.".into(),
        ));
    }
    let result = state.db.with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        let Some(plan) = plans::find_plan(&tx, &id)? else {
            return Ok(0);
        };
        if plan.user_count > 0 {
            return Ok(1);
        }
        tx.execute("DELETE FROM plans WHERE id=?1", params![id])?;
        tx.commit()?;
        Ok(2)
    })?;
    match result {
        0 => Err(ApiError::NotFound("Plan not found.".into())),
        1 => Err(ApiError::Conflict(
            "Move all users to another plan before deleting this plan.".into(),
        )),
        _ => Ok(Json(serde_json::json!({"ok":true}))),
    }
}
