use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::db::now_rfc3339;
use crate::error::{ApiError, ApiResult};
use crate::routes::extractors::AuthUser;
use crate::state::AppState;
use rusqlite::params;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/v1/vault",
            get(get_vault).put(put_vault).delete(delete_vault),
        )
        .route("/v1/account", get(get_account))
}

#[derive(Serialize)]
struct VaultResponse {
    exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    kdf_salt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    verifier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    recovery_envelope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ciphertext: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    size_bytes: Option<i64>,
}

#[derive(Deserialize)]
struct PutVaultBody {
    #[serde(default)]
    expected_version: Option<i64>,
    kdf_salt: String,
    verifier: String,
    #[serde(default)]
    recovery_envelope: Option<String>,
    ciphertext: String,
}

#[derive(Serialize)]
struct PutVaultResponse {
    version: i64,
}

#[derive(Serialize)]
struct AccountResponse {
    email: String,
    role: String,
    plan: String,
    vault_bytes: i64,
    vault_limit_bytes: i64,
    plan_name: String,
}

async fn get_vault(
    State(state): State<Arc<AppState>>,
    AuthUser(claims): AuthUser,
) -> ApiResult<Json<VaultResponse>> {
    let row: Option<(i64, String, String, Option<String>, String, String)> =
        state.db.with_conn(|conn| {
            Ok(conn
                .query_row(
                    "SELECT version, kdf_salt, verifier, recovery_envelope, ciphertext, updated_at
                     FROM vaults WHERE user_id = ?1",
                    params![claims.sub],
                    |r| {
                        Ok((
                            r.get(0)?,
                            r.get(1)?,
                            r.get(2)?,
                            r.get(3)?,
                            r.get(4)?,
                            r.get(5)?,
                        ))
                    },
                )
                .ok())
        })?;

    let Some((version, kdf_salt, verifier, recovery_envelope, ciphertext, updated_at)) = row else {
        return Ok(Json(VaultResponse {
            exists: false,
            version: None,
            kdf_salt: None,
            verifier: None,
            recovery_envelope: None,
            ciphertext: None,
            updated_at: None,
            size_bytes: None,
        }));
    };

    let size_bytes = (kdf_salt.len()
        + verifier.len()
        + recovery_envelope.as_ref().map(|s| s.len()).unwrap_or(0)
        + ciphertext.len()) as i64;

    Ok(Json(VaultResponse {
        exists: true,
        version: Some(version),
        kdf_salt: Some(kdf_salt),
        verifier: Some(verifier),
        recovery_envelope,
        ciphertext: Some(ciphertext),
        updated_at: Some(updated_at),
        size_bytes: Some(size_bytes),
    }))
}

async fn put_vault(
    State(state): State<Arc<AppState>>,
    AuthUser(claims): AuthUser,
    request: axum::extract::Request,
) -> ApiResult<Json<PutVaultResponse>> {
    let content_type = request
        .headers()
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if content_type != "application/json"
        && !(content_type.starts_with("application/") && content_type.ends_with("+json"))
    {
        return Err(ApiError::BadRequest("Send the vault as JSON.".into()));
    }
    let quota = state
        .db
        .with_conn(|conn| crate::plans::user_quota(conn, &claims.sub))?;
    let bytes = axum::body::to_bytes(request.into_body(), quota as usize + 65536)
        .await
        .map_err(|_| {
            ApiError::PayloadTooLarge("Vault request exceeds this account's quota.".into())
        })?;
    let body: PutVaultBody = serde_json::from_slice(&bytes)
        .map_err(|_| ApiError::BadRequest("Invalid vault JSON.".into()))?;
    let expected = body.expected_version.unwrap_or(0);
    let size = (body.kdf_salt.len()
        + body.verifier.len()
        + body
            .recovery_envelope
            .as_ref()
            .map(|s| s.len())
            .unwrap_or(0)
        + body.ciphertext.len()) as i64;

    let result = state.db.with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        let limit = crate::plans::user_quota(&tx, &claims.sub)?;
        if size > limit {
            return Ok(Err(ApiError::PayloadTooLarge(format!(
                "vault exceeds limit ({size} > {limit} bytes)"
            ))));
        }
        use rusqlite::OptionalExtension;
        let current: Option<i64> = tx.query_row(
            "SELECT version FROM vaults WHERE user_id=?1", params![claims.sub], |r| r.get(0),
        ).optional()?;
        if current.unwrap_or(0) != expected {
            return Ok(Err(ApiError::Conflict("version_conflict".into())));
        }
        let version = current.unwrap_or(0) + 1;
        tx.execute(
            "INSERT INTO vaults(user_id,version,kdf_salt,verifier,recovery_envelope,ciphertext,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7)
             ON CONFLICT(user_id) DO UPDATE SET version=excluded.version,kdf_salt=excluded.kdf_salt,
             verifier=excluded.verifier,recovery_envelope=excluded.recovery_envelope,
             ciphertext=excluded.ciphertext,updated_at=excluded.updated_at",
            params![claims.sub,version,body.kdf_salt,body.verifier,body.recovery_envelope,body.ciphertext,now_rfc3339()],
        )?;
        tx.commit()?;
        Ok(Ok(PutVaultResponse { version }))
    })??;
    Ok(Json(result))
}

async fn delete_vault(
    State(state): State<Arc<AppState>>,
    AuthUser(claims): AuthUser,
) -> ApiResult<Json<serde_json::Value>> {
    state.db.with_conn(|conn| {
        conn.execute("DELETE FROM vaults WHERE user_id = ?1", params![claims.sub])?;
        Ok(())
    })?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn get_account(
    State(state): State<Arc<AppState>>,
    AuthUser(claims): AuthUser,
) -> ApiResult<Json<AccountResponse>> {
    let account = state.db.with_conn(|conn| {
        Ok(conn.query_row(
            "SELECT u.email,u.role,u.plan,p.name,COALESCE(u.quota_override_bytes,p.limit_bytes),
                    COALESCE(length(v.kdf_salt)+length(v.verifier)+length(ifnull(v.recovery_envelope,''))+length(v.ciphertext),0)
             FROM users u JOIN plans p ON p.id=u.plan LEFT JOIN vaults v ON v.user_id=u.id WHERE u.id=?1",
            params![claims.sub],
            |r| Ok(AccountResponse { email:r.get(0)?,role:r.get(1)?,plan:r.get(2)?,plan_name:r.get(3)?,vault_limit_bytes:r.get(4)?,vault_bytes:r.get(5)? }),
        )?)
    })?;
    Ok(Json(account))
}
