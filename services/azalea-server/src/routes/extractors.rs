use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::header::AUTHORIZATION;
use std::sync::Arc;

use crate::auth::{decode_access_token, Claims};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

pub struct AuthUser(pub Claims);

impl FromRequestParts<Arc<AppState>> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| ApiError::Unauthorized("missing authorization".into()))?;

        let token = header
            .strip_prefix("Bearer ")
            .ok_or_else(|| ApiError::Unauthorized("invalid authorization".into()))?;

        let claims = decode_access_token(&state.jwt_secret, token)?;
        Ok(AuthUser(claims))
    }
}

pub fn require_admin(claims: &Claims) -> ApiResult<()> {
    if claims.role != "admin" {
        return Err(ApiError::Forbidden("admin only".into()));
    }
    Ok(())
}
