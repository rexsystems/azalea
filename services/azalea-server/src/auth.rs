use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
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
    pub refresh_token: String,
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

pub const ACCESS_TTL_SECS: i64 = 3600;
pub const REFRESH_TTL_DAYS: i64 = 30;
