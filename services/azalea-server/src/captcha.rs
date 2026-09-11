//! Cloudflare Turnstile captcha verification.
//!
//! When `settings.captcha_secret_key` is empty this module is a no-op; endpoints
//! that call [`verify`] should treat that as "captcha not configured, accept
//! without a challenge". When a secret IS configured, requests without a valid
//! token are rejected.

use serde::Deserialize;

use crate::error::{ApiError, ApiResult};

const VERIFY_URL: &str = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

#[derive(Debug, Deserialize)]
struct TurnstileResponse {
    success: bool,
    #[serde(default, rename = "error-codes")]
    _error_codes: Vec<String>,
}

/// Verify a Turnstile token against Cloudflare. Returns Ok(()) on success,
/// `ApiError::BadRequest` on any failure so we never leak upstream error
/// codes to the client.
pub async fn verify(
    secret_key: &str,
    token: Option<&str>,
    remote_ip: Option<&str>,
) -> ApiResult<()> {
    if secret_key.is_empty() {
        return Ok(());
    }
    let Some(token) = token.map(|t| t.trim()).filter(|t| !t.is_empty()) else {
        return Err(ApiError::BadRequest("captcha required".into()));
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;

    let mut form = vec![("secret", secret_key), ("response", token)];
    if let Some(ip) = remote_ip {
        form.push(("remoteip", ip));
    }

    let resp = client
        .post(VERIFY_URL)
        .form(&form)
        .send()
        .await
        .map_err(|_| ApiError::BadRequest("captcha verification failed".into()))?;

    let parsed: TurnstileResponse = resp
        .json()
        .await
        .map_err(|_| ApiError::BadRequest("captcha verification failed".into()))?;

    if parsed.success {
        Ok(())
    } else {
        Err(ApiError::BadRequest("captcha rejected".into()))
    }
}
