use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use chrono::{Duration, Utc};
use rusqlite::params;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use uuid::Uuid;

use crate::auth::{
    burn_dummy_verify, clear_refresh_cookie_value, hash_password, hash_token, issue_access_token,
    push_set_cookie, random_token, refresh_cookie_from_headers, refresh_cookie_value,
    verify_password, PublicUser, SessionResponse, ACCESS_TTL_SECS, REFRESH_TTL_DAYS,
};
use crate::captcha;
use crate::db::now_rfc3339;
use crate::error::{ApiError, ApiResult};
use crate::routes::extractors::{AuthUser, ClientKind};
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/v1/auth/register", post(register))
        .route("/v1/auth/login", post(login))
        .route("/v1/auth/refresh", post(refresh))
        .route("/v1/auth/logout", post(logout))
        .route("/v1/auth/forgot-password", post(forgot_password))
        .route("/v1/auth/reset-password", post(reset_password))
        .route("/v1/auth/desktop/begin", post(desktop_begin))
        .route("/v1/auth/desktop/approve", post(desktop_approve))
        .route("/v1/auth/desktop/exchange", post(desktop_exchange))
}

// ---------- helpers ----------

/// Pull a caller-IP hint out of the request headers. When behind nginx (the
/// intended deployment) `X-Forwarded-For` is set to the real client IP. If the
/// header is absent (e.g. someone hits the API port directly) the value
/// `"unknown"` is used, meaning all such callers share one bucket. That is
/// intentional: direct-to-API traffic is out of scope for the shipped
/// deployment model, and one bucket is a hard cap rather than a leak.
fn client_ip(headers: &HeaderMap) -> String {
    if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = xff.split(',').next() {
            let trimmed = first.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    if let Some(real) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
        let trimmed = real.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    "unknown".to_string()
}

fn identifier_key(kind: &str, value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(kind.as_bytes());
    hasher.update(b":");
    hasher.update(value.trim().to_lowercase().as_bytes());
    format!("{kind}:{}", hex::encode(hasher.finalize()))
}

fn check_limit(limiter: &crate::ratelimit::RateLimiter, key: &str) -> ApiResult<()> {
    if limiter.check(key) {
        Ok(())
    } else {
        Err(ApiError::TooManyRequests)
    }
}

fn base64url(data: &[u8]) -> String {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine as _;
    URL_SAFE_NO_PAD.encode(data)
}

fn base64url_decode(s: &str) -> Option<Vec<u8>> {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine as _;
    URL_SAFE_NO_PAD.decode(s.as_bytes()).ok()
}

/// Load captcha settings once per request handler that needs them.
fn load_captcha_secret(state: &AppState) -> ApiResult<String> {
    Ok(state.db.with_conn(|conn| {
        Ok(conn
            .query_row(
                "SELECT captcha_secret_key FROM settings WHERE id = 1",
                [],
                |r| r.get::<_, String>(0),
            )
            .unwrap_or_default())
    })?)
}

// ---------- register / login / refresh / logout ----------

#[derive(Deserialize)]
pub struct RegisterBody {
    email: String,
    password: String,
    #[serde(default)]
    captcha_token: Option<String>,
}

#[derive(Deserialize)]
pub struct LoginBody {
    email: String,
    password: String,
}

#[derive(Deserialize)]
pub struct RefreshBody {
    #[serde(default)]
    refresh_token: Option<String>,
}

async fn register(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    client: ClientKind,
    Json(body): Json<RegisterBody>,
) -> ApiResult<impl IntoResponse> {
    let ip = client_ip(&headers);
    check_limit(&state.auth_write_limiter, &format!("register:ip:{ip}"))?;

    let email = normalize_email(&body.email)?;
    validate_password(&body.password)?;

    let captcha_secret = load_captcha_secret(&state)?;
    captcha::verify(
        &captcha_secret,
        body.captcha_token.as_deref(),
        Some(&ip),
    )
    .await?;

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

    match insert {
        Ok(()) => {
            let (session, cookie) = create_session(&state, &user_id, &email, "user", client)?;
            let mut response_headers = HeaderMap::new();
            if let Some(cookie) = cookie {
                push_set_cookie(&mut response_headers, &cookie);
            }
            Ok((StatusCode::OK, response_headers, Json(session)).into_response())
        }
        Err(err) => {
            let msg = err.to_string();
            if msg.contains("UNIQUE") {
                // Do NOT leak "email already registered" - it enables account
                // enumeration. Return a generic "registration failed" instead.
                Err(ApiError::BadRequest("registration failed".into()))
            } else {
                Err(ApiError::Internal(err))
            }
        }
    }
}

async fn login(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    client: ClientKind,
    Json(body): Json<LoginBody>,
) -> ApiResult<impl IntoResponse> {
    let ip = client_ip(&headers);
    check_limit(&state.auth_login_limiter, &format!("login:ip:{ip}"))?;

    let email = normalize_email(&body.email)?;
    check_limit(&state.auth_identifier_limiter, &identifier_key("login", &email))?;

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
        // Burn the Argon2 cost so unknown-user timing matches real users.
        burn_dummy_verify();
        return Err(ApiError::Unauthorized("invalid credentials".into()));
    };
    if disabled != 0 {
        return Err(ApiError::Forbidden("account disabled".into()));
    }
    if !verify_password(&body.password, &password_hash)? {
        return Err(ApiError::Unauthorized("invalid credentials".into()));
    }

    let (session, cookie) = create_session(&state, &user_id, &email, &role, client)?;
    let mut response_headers = HeaderMap::new();
    if let Some(cookie) = cookie {
        push_set_cookie(&mut response_headers, &cookie);
    }
    Ok((StatusCode::OK, response_headers, Json(session)).into_response())
}

async fn refresh(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    client: ClientKind,
    body: Option<Json<RefreshBody>>,
) -> ApiResult<impl IntoResponse> {
    let ip = client_ip(&headers);
    check_limit(&state.auth_refresh_limiter, &format!("refresh:ip:{ip}"))?;

    // Prefer the HttpOnly cookie (web clients). Fall back to the JSON body,
    // which is how desktop clients still send the refresh token.
    let refresh_token = refresh_cookie_from_headers(&headers)
        .or_else(|| body.and_then(|Json(b)| b.refresh_token))
        .ok_or_else(|| ApiError::Unauthorized("missing refresh token".into()))?;

    let token_hash = hash_token(&refresh_token);

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
    let session = SessionResponse {
        access_token: access,
        refresh_token: if client.is_desktop() {
            Some(new_refresh.clone())
        } else {
            None
        },
        expires_in: ACCESS_TTL_SECS,
        user: PublicUser {
            id: user_id,
            email,
            role,
        },
    };

    let mut response_headers = HeaderMap::new();
    if !client.is_desktop() {
        push_set_cookie(
            &mut response_headers,
            &refresh_cookie_value(&new_refresh, state.secure_cookies()),
        );
    }

    Ok((StatusCode::OK, response_headers, Json(session)).into_response())
}

async fn logout(
    State(state): State<Arc<AppState>>,
    client: ClientKind,
    AuthUser(claims): AuthUser,
) -> ApiResult<impl IntoResponse> {
    state.db.with_conn(|conn| {
        conn.execute(
            "DELETE FROM sessions WHERE user_id = ?1",
            params![claims.sub],
        )?;
        Ok(())
    })?;

    let mut response_headers = HeaderMap::new();
    if !client.is_desktop() {
        push_set_cookie(
            &mut response_headers,
            &clear_refresh_cookie_value(state.secure_cookies()),
        );
    }

    Ok((StatusCode::OK, response_headers, Json(json!({ "ok": true }))).into_response())
}

/// Create a fresh session row and issue a `SessionResponse`. For desktop
/// clients the refresh token is returned in the JSON body; for web clients it
/// is returned as an HttpOnly cookie (caller must push it onto the response).
fn create_session(
    state: &AppState,
    user_id: &str,
    email: &str,
    role: &str,
    client: ClientKind,
) -> ApiResult<(SessionResponse, Option<String>)> {
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
    let session = SessionResponse {
        access_token: access,
        refresh_token: if client.is_desktop() {
            Some(refresh.clone())
        } else {
            None
        },
        expires_in: ACCESS_TTL_SECS,
        user: PublicUser {
            id: user_id.to_string(),
            email: email.to_string(),
            role: role.to_string(),
        },
    };
    let cookie = if client.is_desktop() {
        None
    } else {
        Some(refresh_cookie_value(&refresh, state.secure_cookies()))
    };
    Ok((session, cookie))
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

// ---------- forgot / reset password ----------

#[derive(Deserialize)]
struct ForgotBody {
    email: String,
    #[serde(default)]
    captcha_token: Option<String>,
}

#[derive(Deserialize)]
struct ResetBody {
    token: String,
    password: String,
    #[serde(default)]
    captcha_token: Option<String>,
}

async fn forgot_password(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<ForgotBody>,
) -> ApiResult<Json<serde_json::Value>> {
    let ip = client_ip(&headers);
    check_limit(&state.auth_write_limiter, &format!("forgot:ip:{ip}"))?;

    let email = normalize_email(&body.email)?;
    check_limit(
        &state.auth_identifier_limiter,
        &identifier_key("forgot", &email),
    )?;

    let captcha_secret = load_captcha_secret(&state)?;
    captcha::verify(&captcha_secret, body.captcha_token.as_deref(), Some(&ip)).await?;

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

    Ok(Json(json!({
        "ok": true,
        "message": "If that email exists, a reset link was sent."
    })))
}

async fn reset_password(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<ResetBody>,
) -> ApiResult<Json<serde_json::Value>> {
    let ip = client_ip(&headers);
    check_limit(&state.auth_write_limiter, &format!("reset:ip:{ip}"))?;

    validate_password(&body.password)?;

    let captcha_secret = load_captcha_secret(&state)?;
    captcha::verify(&captcha_secret, body.captcha_token.as_deref(), Some(&ip)).await?;

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
        conn.execute(
            "DELETE FROM password_resets WHERE user_id = ?1",
            params![user_id],
        )?;
        conn.execute("DELETE FROM sessions WHERE user_id = ?1", params![user_id])?;
        Ok(())
    })?;

    Ok(Json(json!({ "ok": true })))
}

// ---------- desktop PKCE code exchange ----------

/// Handle / code TTLs. Both are short-lived and single-use.
const DESKTOP_HANDLE_TTL_SECS: i64 = 5 * 60;
const DESKTOP_CODE_TTL_SECS: i64 = 60;

#[derive(Deserialize)]
struct DesktopBeginBody {
    code_challenge: String,
    #[serde(default)]
    code_challenge_method: Option<String>,
    client_state: String,
}

async fn desktop_begin(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<DesktopBeginBody>,
) -> ApiResult<Json<serde_json::Value>> {
    let ip = client_ip(&headers);
    check_limit(&state.auth_write_limiter, &format!("dbegin:ip:{ip}"))?;

    let method = body
        .code_challenge_method
        .as_deref()
        .unwrap_or("S256")
        .to_ascii_uppercase();
    if method != "S256" {
        return Err(ApiError::BadRequest(
            "unsupported code_challenge_method".into(),
        ));
    }
    if body.code_challenge.len() < 43 || body.code_challenge.len() > 128 {
        return Err(ApiError::BadRequest("invalid code_challenge".into()));
    }
    if body.client_state.len() < 8 || body.client_state.len() > 128 {
        return Err(ApiError::BadRequest("invalid client_state".into()));
    }

    prune_expired_desktop_codes(&state)?;

    let handle = random_token();
    let handle_hash = hash_token(&handle);
    let now = now_rfc3339();
    let expires =
        (Utc::now() + Duration::seconds(DESKTOP_HANDLE_TTL_SECS)).to_rfc3339();

    state.db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO desktop_auth_codes
             (handle_hash, code_challenge, client_state, code_hash, user_id,
              created_at, approved_at, expires_at)
             VALUES (?1, ?2, ?3, NULL, NULL, ?4, NULL, ?5)",
            params![
                handle_hash,
                body.code_challenge,
                body.client_state,
                now,
                expires
            ],
        )?;
        Ok(())
    })?;

    Ok(Json(json!({
        "handle": handle,
        "expires_in": DESKTOP_HANDLE_TTL_SECS,
    })))
}

#[derive(Deserialize)]
struct DesktopApproveBody {
    handle: String,
    client_state: String,
}

async fn desktop_approve(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AuthUser(claims): AuthUser,
    Json(body): Json<DesktopApproveBody>,
) -> ApiResult<Json<serde_json::Value>> {
    let ip = client_ip(&headers);
    check_limit(&state.auth_write_limiter, &format!("dapprove:ip:{ip}"))?;

    prune_expired_desktop_codes(&state)?;

    let handle_hash = hash_token(&body.handle);
    let now_str = now_rfc3339();

    // Load the pending row and enforce it hasn't already been approved.
    let row: Option<(String, String)> = state.db.with_conn(|conn| {
        Ok(conn
            .query_row(
                "SELECT client_state, expires_at
                 FROM desktop_auth_codes
                 WHERE handle_hash = ?1 AND approved_at IS NULL",
                params![handle_hash],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok())
    })?;

    let Some((stored_state, expires_at)) = row else {
        return Err(ApiError::BadRequest("invalid or expired handle".into()));
    };
    if expires_at < now_str {
        let _ = state.db.with_conn(|conn| {
            conn.execute(
                "DELETE FROM desktop_auth_codes WHERE handle_hash = ?1",
                params![handle_hash],
            )?;
            Ok(())
        });
        return Err(ApiError::BadRequest("invalid or expired handle".into()));
    }
    if stored_state != body.client_state {
        return Err(ApiError::BadRequest("client_state mismatch".into()));
    }

    // Issue the one-time authorization code.
    let code = random_token();
    let code_hash = hash_token(&code);
    let code_expires =
        (Utc::now() + Duration::seconds(DESKTOP_CODE_TTL_SECS)).to_rfc3339();

    state.db.with_conn(|conn| {
        conn.execute(
            "UPDATE desktop_auth_codes
             SET code_hash = ?2, user_id = ?3, approved_at = ?4, expires_at = ?5
             WHERE handle_hash = ?1",
            params![handle_hash, code_hash, claims.sub, now_str, code_expires],
        )?;
        Ok(())
    })?;

    Ok(Json(json!({
        "code": code,
        "expires_in": DESKTOP_CODE_TTL_SECS,
    })))
}

#[derive(Deserialize)]
struct DesktopExchangeBody {
    handle: String,
    code: String,
    code_verifier: String,
}

async fn desktop_exchange(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    client: ClientKind,
    Json(body): Json<DesktopExchangeBody>,
) -> ApiResult<impl IntoResponse> {
    let ip = client_ip(&headers);
    check_limit(&state.auth_login_limiter, &format!("dexchange:ip:{ip}"))?;

    prune_expired_desktop_codes(&state)?;

    let handle_hash = hash_token(&body.handle);
    let now_str = now_rfc3339();

    let row: Option<(String, Option<String>, Option<String>, String)> = state.db.with_conn(|conn| {
        Ok(conn
            .query_row(
                "SELECT code_challenge, code_hash, user_id, expires_at
                 FROM desktop_auth_codes
                 WHERE handle_hash = ?1 AND approved_at IS NOT NULL",
                params![handle_hash],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .ok())
    })?;

    let Some((code_challenge, code_hash_opt, user_id_opt, expires_at)) = row else {
        return Err(ApiError::BadRequest("invalid or expired code".into()));
    };

    // Whether it worked or not, this handle is now spent.
    let _ = state.db.with_conn(|conn| {
        conn.execute(
            "DELETE FROM desktop_auth_codes WHERE handle_hash = ?1",
            params![handle_hash],
        )?;
        Ok(())
    });

    if expires_at < now_str {
        return Err(ApiError::BadRequest("invalid or expired code".into()));
    }

    let expected_hash = code_hash_opt
        .ok_or_else(|| ApiError::BadRequest("invalid or expired code".into()))?;
    let user_id =
        user_id_opt.ok_or_else(|| ApiError::BadRequest("invalid or expired code".into()))?;

    if hash_token(&body.code) != expected_hash {
        return Err(ApiError::BadRequest("invalid or expired code".into()));
    }

    // Verify PKCE: SHA-256(code_verifier), base64url-nopad, must equal
    // code_challenge from /begin.
    let verifier_hash = Sha256::digest(body.code_verifier.as_bytes());
    let expected_challenge = base64url(&verifier_hash);
    // Also accept a verifier that was already sent pre-encoded (defensive):
    let matches_direct = expected_challenge == code_challenge;
    let matches_decoded = base64url_decode(&code_challenge)
        .map(|d| d.as_slice() == verifier_hash.as_slice())
        .unwrap_or(false);
    if !matches_direct && !matches_decoded {
        return Err(ApiError::BadRequest("pkce mismatch".into()));
    }

    // Load user for email + role.
    let user: Option<(String, String, i64)> = state.db.with_conn(|conn| {
        Ok(conn
            .query_row(
                "SELECT email, role, disabled FROM users WHERE id = ?1",
                params![user_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .ok())
    })?;
    let Some((email, role, disabled)) = user else {
        return Err(ApiError::Unauthorized("user gone".into()));
    };
    if disabled != 0 {
        return Err(ApiError::Forbidden("account disabled".into()));
    }

    let (session, cookie) = create_session(&state, &user_id, &email, &role, client)?;
    let mut response_headers = HeaderMap::new();
    if let Some(cookie) = cookie {
        push_set_cookie(&mut response_headers, &cookie);
    }
    Ok((StatusCode::OK, response_headers, Json(session)).into_response())
}

fn prune_expired_desktop_codes(state: &AppState) -> ApiResult<()> {
    let now = now_rfc3339();
    state.db.with_conn(|conn| {
        conn.execute(
            "DELETE FROM desktop_auth_codes WHERE expires_at < ?1",
            params![now],
        )?;
        Ok(())
    })?;
    Ok(())
}
