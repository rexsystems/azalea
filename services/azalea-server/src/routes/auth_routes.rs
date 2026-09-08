use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};
use chrono::{Duration, Utc};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::auth::{
    hash_password, hash_token, issue_access_token, random_token, verify_password, PublicUser,
    SessionResponse, ACCESS_TTL_SECS, REFRESH_TTL_DAYS,
};
use crate::db::now_rfc3339;
use rusqlite::params;
use crate::error::{ApiError, ApiResult};
use crate::routes::extractors::AuthUser;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/v1/auth/register", post(register))
        .route("/v1/auth/login", post(login))
        .route("/v1/auth/refresh", post(refresh))
        .route("/v1/auth/logout", post(logout))
        .route("/v1/auth/forgot-password", post(forgot_password))
        .route("/v1/auth/reset-password", post(reset_password))
}

#[derive(Deserialize)]
pub struct RegisterBody {
    email: String,
    password: String,
    #[serde(default)]
    #[allow(dead_code)]
    captcha_token: Option<String>,
}

#[derive(Deserialize)]
pub struct LoginBody {
    email: String,
    password: String,
}

#[derive(Deserialize)]
pub struct RefreshBody {
    refresh_token: String,
}

async fn register(
    State(state): State<Arc<AppState>>,
    Json(body): Json<RegisterBody>,
) -> ApiResult<Json<SessionResponse>> {
    let email = normalize_email(&body.email)?;
    validate_password(&body.password)?;

    let signup_enabled: i64 = state.db.with_conn(|conn| {
        Ok(conn.query_row(
            "SELECT signup_enabled FROM settings WHERE id = 1",
            [],
            |r| r.get(0),
        )?)
    })?;
    if signup_enabled == 0 {
        return Err(ApiError::Forbidden("signup disabled".into()));
    }

    let password_hash = hash_password(&body.password)?;
    let user_id = Uuid::new_v4().to_string();
    let now = now_rfc3339();

    let insert = state.db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO users (id, email, password_hash, role, plan, disabled, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'user', 'free', 0, ?4, ?4)",
            params![user_id, email, password_hash, now],
        )?;
        Ok(())
    });

    if let Err(e) = insert {
        let msg = e.to_string();
        if msg.contains("UNIQUE") {
            return Err(ApiError::Conflict("email already registered".into()));
        }
        return Err(ApiError::Internal(e));
    }

    create_session(&state, &user_id, &email, "user")
}

async fn login(
    State(state): State<Arc<AppState>>,
    Json(body): Json<LoginBody>,
) -> ApiResult<Json<SessionResponse>> {
    let email = normalize_email(&body.email)?;
    let row: Option<(String, String, String, i64)> = state.db.with_conn(|conn| {
        Ok(conn
            .query_row(
                "SELECT id, password_hash, role, disabled FROM users WHERE email = ?1 COLLATE NOCASE",
                params![email],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .ok())
    })?;

    let Some((user_id, password_hash, role, disabled)) = row else {
        return Err(ApiError::Unauthorized("invalid credentials".into()));
    };
    if disabled != 0 {
        return Err(ApiError::Forbidden("account disabled".into()));
    }
    if !verify_password(&body.password, &password_hash)? {
        return Err(ApiError::Unauthorized("invalid credentials".into()));
    }

    create_session(&state, &user_id, &email, &role)
}

async fn refresh(
    State(state): State<Arc<AppState>>,
    Json(body): Json<RefreshBody>,
) -> ApiResult<Json<SessionResponse>> {
    let token_hash = hash_token(&body.refresh_token);

    let session: Option<(String, String, String, String, i64, String)> = state.db.with_conn(|conn| {
        Ok(conn
            .query_row(
                "SELECT s.id, s.user_id, u.email, u.role, u.disabled, s.expires_at
                 FROM sessions s JOIN users u ON u.id = s.user_id
                 WHERE s.refresh_token_hash = ?1",
                params![token_hash],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
            )
            .ok())
    })?;

    let Some((session_id, user_id, email, role, disabled, expires_at)) = session else {
        return Err(ApiError::Unauthorized("invalid refresh token".into()));
    };
    if disabled != 0 {
        return Err(ApiError::Forbidden("account disabled".into()));
    }
    if expires_at < now_rfc3339() {
        let _ = state.db.with_conn(|conn| {
            conn.execute("DELETE FROM sessions WHERE id = ?1", params![session_id])?;
            Ok(())
        });
        return Err(ApiError::Unauthorized("refresh token expired".into()));
    }

    let new_refresh = random_token();
    let new_hash = hash_token(&new_refresh);
    let new_exp = (Utc::now() + Duration::days(REFRESH_TTL_DAYS)).to_rfc3339();
    state.db.with_conn(|conn| {
        conn.execute(
            "UPDATE sessions SET refresh_token_hash = ?2, expires_at = ?3 WHERE id = ?1",
            params![session_id, new_hash, new_exp],
        )?;
        Ok(())
    })?;

    let access = issue_access_token(&state.jwt_secret, &user_id, &email, &role, ACCESS_TTL_SECS)?;
    Ok(Json(SessionResponse {
        access_token: access,
        refresh_token: new_refresh,
        expires_in: ACCESS_TTL_SECS,
        user: PublicUser {
            id: user_id,
            email,
            role,
        },
    }))
}

async fn logout(
    State(state): State<Arc<AppState>>,
    AuthUser(claims): AuthUser,
) -> ApiResult<Json<serde_json::Value>> {
    state.db.with_conn(|conn| {
        conn.execute(
            "DELETE FROM sessions WHERE user_id = ?1",
            params![claims.sub],
        )?;
        Ok(())
    })?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

fn create_session(
    state: &AppState,
    user_id: &str,
    email: &str,
    role: &str,
) -> ApiResult<Json<SessionResponse>> {
    let refresh = random_token();
    let refresh_hash = hash_token(&refresh);
    let session_id = Uuid::new_v4().to_string();
    let now = now_rfc3339();
    let expires = (Utc::now() + Duration::days(REFRESH_TTL_DAYS)).to_rfc3339();

    state.db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![session_id, user_id, refresh_hash, expires, now],
        )?;
        Ok(())
    })?;

    let access =
        issue_access_token(state.jwt_secret.as_str(), user_id, email, role, ACCESS_TTL_SECS)?;
    Ok(Json(SessionResponse {
        access_token: access,
        refresh_token: refresh,
        expires_in: ACCESS_TTL_SECS,
        user: PublicUser {
            id: user_id.to_string(),
            email: email.to_string(),
            role: role.to_string(),
        },
    }))
}

fn normalize_email(email: &str) -> ApiResult<String> {
    let email = email.trim().to_lowercase();
    if !email.contains('@') || email.len() < 3 {
        return Err(ApiError::BadRequest("invalid email".into()));
    }
    Ok(email)
}

fn validate_password(password: &str) -> ApiResult<()> {
    if password.len() < 8 {
        return Err(ApiError::BadRequest(
            "password must be at least 8 characters".into(),
        ));
    }
    Ok(())
}

#[derive(Deserialize)]
struct ForgotBody {
    email: String,
}

#[derive(Deserialize)]
struct ResetBody {
    token: String,
    password: String,
}

async fn forgot_password(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ForgotBody>,
) -> ApiResult<Json<serde_json::Value>> {
    let email = normalize_email(&body.email)?;
    let Some(mail) = &state.mail else {
        return Err(ApiError::BadRequest(
            "Email is not configured on this server (set RESEND_API_KEY)".into(),
        ));
    };

    let user: Option<(String,)> = state.db.with_conn(|conn| {
        Ok(conn
            .query_row(
                "SELECT id FROM users WHERE email = ?1 COLLATE NOCASE AND disabled = 0",
                params![email],
                |r| Ok((r.get(0)?,)),
            )
            .ok())
    })?;

    if let Some((user_id,)) = user {
        let token = random_token();
        let token_hash = hash_token(&token);
        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339();
        let expires = (Utc::now() + Duration::hours(1)).to_rfc3339();
        state.db.with_conn(|conn| {
            conn.execute(
                "DELETE FROM password_resets WHERE user_id = ?1",
                params![user_id],
            )?;
            conn.execute(
                "INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, user_id, token_hash, expires, now],
            )?;
            Ok(())
        })?;
        crate::mail::send_password_reset(mail, &email, &token).await?;
    }

    Ok(Json(serde_json::json!({
        "ok": true,
        "message": "If that email exists, a reset link was sent."
    })))
}

async fn reset_password(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ResetBody>,
) -> ApiResult<Json<serde_json::Value>> {
    validate_password(&body.password)?;
    let token_hash = hash_token(body.token.trim());
    let now = now_rfc3339();

    let row: Option<(String, String, String)> = state.db.with_conn(|conn| {
        Ok(conn
            .query_row(
                "SELECT id, user_id, expires_at FROM password_resets WHERE token_hash = ?1",
                params![token_hash],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .ok())
    })?;

    let Some((reset_id, user_id, expires_at)) = row else {
        return Err(ApiError::BadRequest("Invalid or expired reset link".into()));
    };
    if expires_at < now {
        let _ = state.db.with_conn(|conn| {
            conn.execute("DELETE FROM password_resets WHERE id = ?1", params![reset_id])?;
            Ok(())
        });
        return Err(ApiError::BadRequest("Invalid or expired reset link".into()));
    }

    let password_hash = hash_password(&body.password)?;
    state.db.with_conn(|conn| {
        conn.execute(
            "UPDATE users SET password_hash = ?2, updated_at = ?3 WHERE id = ?1",
            params![user_id, password_hash, now],
        )?;
        conn.execute("DELETE FROM password_resets WHERE user_id = ?1", params![user_id])?;
        conn.execute("DELETE FROM sessions WHERE user_id = ?1", params![user_id])?;
        Ok(())
    })?;

    Ok(Json(serde_json::json!({ "ok": true })))
}
