use axum::extract::FromRequestParts;
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use rusqlite::params;
use std::sync::Arc;

use crate::auth::{decode_access_token, Claims};
use crate::error::ApiError;
use crate::state::AppState;

/// Which kind of client made this request. Determined by the `x-azalea-client`
/// header. Web clients (default) receive their refresh token via an HttpOnly
/// cookie; desktop clients receive it in the JSON body.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClientKind {
    Web,
    Desktop,
}

impl ClientKind {
    pub fn is_desktop(self) -> bool {
        matches!(self, Self::Desktop)
    }
}

impl<S> FromRequestParts<S> for ClientKind
where
    S: Send + Sync,
{
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let kind = parts
            .headers
            .get("x-azalea-client")
            .and_then(|v| v.to_str().ok())
            .map(|v| v.trim().eq_ignore_ascii_case("desktop"))
            .unwrap_or(false);
        Ok(if kind {
            ClientKind::Desktop
        } else {
            ClientKind::Web
        })
    }
}

#[allow(dead_code)]
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

/// Extractor that verifies the caller is an admin by re-reading `role` and
/// `disabled` from the DB, not by trusting the JWT claim. Prevents a demoted
/// admin from retaining access until their access token expires.
#[allow(dead_code)]
pub struct AdminUser(pub Claims);

impl FromRequestParts<Arc<AppState>> for AdminUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let AuthUser(claims) = AuthUser::from_request_parts(parts, state).await?;

        let row: Option<(String, i64)> = state.db.with_conn(|conn| {
            Ok(conn
                .query_row(
                    "SELECT role, disabled FROM users WHERE id = ?1",
                    params![claims.sub],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .ok())
        })?;

        let (role, disabled) = row.ok_or_else(|| ApiError::Unauthorized("no such user".into()))?;
        if disabled != 0 {
            return Err(ApiError::Forbidden("account disabled".into()));
        }
        if role != "admin" {
            return Err(ApiError::Forbidden("admin only".into()));
        }
        Ok(AdminUser(claims))
    }
}

// require_admin() was removed - use the `AdminUser` extractor instead, which
// re-verifies the role from the database instead of trusting the JWT claim.
