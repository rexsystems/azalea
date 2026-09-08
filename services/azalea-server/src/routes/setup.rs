use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::auth::{hash_password, hash_token, issue_access_token, random_token, PublicUser, SessionResponse, ACCESS_TTL_SECS, REFRESH_TTL_DAYS};
use crate::db::now_rfc3339;
use rusqlite::params;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use chrono::{Duration, Utc};

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/v1/setup/status", get(setup_status))
        .route("/v1/setup/bootstrap", post(bootstrap))
}

#[derive(Deserialize)]
struct BootstrapBody {
    #[serde(default)]
    setup_secret: Option<String>,
    admin_email: String,
    admin_password: String,
    #[serde(default)]
    instance_name: Option<String>,
}

async fn setup_status(State(state): State<Arc<AppState>>) -> ApiResult<Json<serde_json::Value>> {
    let admins: i64 = state.db.with_conn(|conn| {
        Ok(conn.query_row(
            "SELECT COUNT(*) FROM users WHERE role = 'admin'",
            [],
            |r| r.get(0),
        )?)
    })?;
    Ok(Json(serde_json::json!({
        "needs_setup": admins == 0,
        "mail_configured": state.mail.is_some(),
    })))
}

async fn bootstrap(
    State(state): State<Arc<AppState>>,
    Json(body): Json<BootstrapBody>,
) -> ApiResult<Json<SessionResponse>> {
    let admins: i64 = state.db.with_conn(|conn| {
        Ok(conn.query_row(
            "SELECT COUNT(*) FROM users WHERE role = 'admin'",
            [],
            |r| r.get(0),
        )?)
    })?;
    if admins > 0 {
        return Err(ApiError::Forbidden("already bootstrapped".into()));
    }

    if let Some(expected) = &state.setup_secret {
        match &body.setup_secret {
            Some(got) if got == expected => {}
            _ => return Err(ApiError::Unauthorized("invalid setup secret".into())),
        }
    }

    let email = body.admin_email.trim().to_lowercase();
    if !email.contains('@') {
        return Err(ApiError::BadRequest("invalid email".into()));
    }
    if body.admin_password.len() < 8 {
        return Err(ApiError::BadRequest(
            "password must be at least 8 characters".into(),
        ));
    }

    let password_hash = hash_password(&body.admin_password)?;
    let user_id = Uuid::new_v4().to_string();
    let now = now_rfc3339();
    let instance = body
        .instance_name
        .as_deref()
        .unwrap_or("Azalea")
        .trim()
        .to_string();

    state.db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO users (id, email, password_hash, role, plan, disabled, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'admin', 'pro', 0, ?4, ?4)",
            params![user_id, email, password_hash, now],
        )?;
        conn.execute(
            "UPDATE settings SET instance_name = ?1 WHERE id = 1",
            params![instance],
        )?;
        Ok(())
    })?;

    let refresh = random_token();
    let refresh_hash = hash_token(&refresh);
    let session_id = Uuid::new_v4().to_string();
    let expires = (Utc::now() + Duration::days(REFRESH_TTL_DAYS)).to_rfc3339();
    state.db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![session_id, user_id, refresh_hash, expires, now],
        )?;
        Ok(())
    })?;

    let access = issue_access_token(
        &state.jwt_secret,
        &user_id,
        &email,
        "admin",
        ACCESS_TTL_SECS,
    )?;

    Ok(Json(SessionResponse {
        access_token: access,
        refresh_token: refresh,
        expires_in: ACCESS_TTL_SECS,
        user: PublicUser {
            id: user_id,
            email,
            role: "admin".into(),
        },
    }))
}
