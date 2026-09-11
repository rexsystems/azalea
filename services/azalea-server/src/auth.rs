use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::http::header::{HeaderValue, SET_COOKIE};
use axum::http::HeaderMap;
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{ApiError, ApiResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub email: String,
    pub role: String,
    pub exp: i64,
    pub iat: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PublicUser {
    pub id: String,
    pub email: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionResponse {
    pub access_token: String,
    /// Only set for desktop clients (identified via `x-azalea-client: desktop`).
    /// Web clients receive the refresh token via an HttpOnly cookie instead.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    pub expires_in: i64,
    pub user: PublicUser,
}

pub fn hash_password(password: &str) -> ApiResult<String> {
    let salt = SaltString::generate(&mut rand::thread_rng());
    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?
        .to_string();
    Ok(hash)
}

pub fn verify_password(password: &str, password_hash: &str) -> ApiResult<bool> {
    let parsed = PasswordHash::new(password_hash)
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

/// Dummy Argon2id hash for a well-known throwaway password. Runs the same
/// Argon2 verification path as a real user, closing the "user does not exist"
/// timing side-channel on /v1/auth/login.
const DUMMY_ARGON2_HASH: &str = "$argon2id$v=19$m=19456,t=2,p=1$YXphbGVhZHVtbXlzYWx0MTIzNA$1YnKf1jVK1xJ2Q4qYQg9k5A0P1kQZm7Th4M5Yq6VwZg";

/// Call this when the login target user does not exist so the request still
/// pays the Argon2 cost. Result is discarded.
pub fn burn_dummy_verify() {
    if let Ok(parsed) = PasswordHash::new(DUMMY_ARGON2_HASH) {
        let _ = Argon2::default().verify_password(b"not-a-real-password", &parsed);
    }
}

pub fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn random_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

pub fn issue_access_token(
    secret: &str,
    user_id: &str,
    email: &str,
    role: &str,
    expires_in_secs: i64,
) -> ApiResult<String> {
    let now = Utc::now();
    let claims = Claims {
        sub: user_id.to_string(),
        email: email.to_string(),
        role: role.to_string(),
        iat: now.timestamp(),
        exp: (now + Duration::seconds(expires_in_secs)).timestamp(),
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))
}

pub fn decode_access_token(secret: &str, token: &str) -> ApiResult<Claims> {
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map(|d| d.claims)
    .map_err(|_| ApiError::Unauthorized("invalid access token".into()))
}

/// Short-lived access token TTL. Kept short (10 minutes) so a role/disabled
/// change made by an admin propagates within one refresh cycle instead of
/// waiting an hour. Refresh tokens stay long-lived (see [`REFRESH_TTL_DAYS`]).
pub const ACCESS_TTL_SECS: i64 = 600;
pub const REFRESH_TTL_DAYS: i64 = 30;

pub const REFRESH_COOKIE_NAME: &str = "azalea_refresh";

/// Build the `Set-Cookie` header value for the refresh-token cookie. When
/// `secure` is false the cookie omits the `Secure` attribute so browsers on
/// plain-HTTP localhost dev boxes still send it. Production must set
/// `secure = true`.
pub fn refresh_cookie_value(token: &str, secure: bool) -> String {
    let max_age = REFRESH_TTL_DAYS * 24 * 60 * 60;
    let mut parts = vec![
        format!("{REFRESH_COOKIE_NAME}={token}"),
        "HttpOnly".to_string(),
        "SameSite=Lax".to_string(),
        "Path=/v1/auth".to_string(),
        format!("Max-Age={max_age}"),
    ];
    if secure {
        parts.push("Secure".to_string());
    }
    parts.join("; ")
}

/// Build the `Set-Cookie` header value that deletes the refresh-token cookie.
pub fn clear_refresh_cookie_value(secure: bool) -> String {
    let mut parts = vec![
        format!("{REFRESH_COOKIE_NAME}=deleted"),
        "HttpOnly".to_string(),
        "SameSite=Lax".to_string(),
        "Path=/v1/auth".to_string(),
        "Max-Age=0".to_string(),
    ];
    if secure {
        parts.push("Secure".to_string());
    }
    parts.join("; ")
}

/// Parse the incoming `Cookie` header and pull out `azalea_refresh` if present.
pub fn refresh_cookie_from_headers(headers: &HeaderMap) -> Option<String> {
    let header = headers.get(axum::http::header::COOKIE)?.to_str().ok()?;
    for part in header.split(';') {
        let part = part.trim();
        if let Some(value) = part.strip_prefix(&format!("{REFRESH_COOKIE_NAME}=")) {
            if !value.is_empty() && value != "deleted" {
                return Some(value.to_string());
            }
        }
    }
    None
}

/// Push a `Set-Cookie` header into an outgoing response's header map.
pub fn push_set_cookie(headers: &mut HeaderMap, cookie_value: &str) {
    if let Ok(value) = HeaderValue::from_str(cookie_value) {
        headers.append(SET_COOKIE, value);
    }
}
