use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::db::now_rfc3339;
use rusqlite::params;
use crate::error::{ApiError, ApiResult};
use crate::routes::extractors::AuthUser;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/v1/vault", get(get_vault).put(put_vault).delete(delete_vault))
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
    Json(body): Json<PutVaultBody>,
) -> ApiResult<Json<PutVaultResponse>> {
    let expected = body.expected_version.unwrap_or(0);
    let size = (body.kdf_salt.len()
        + body.verifier.len()
        + body.recovery_envelope.as_ref().map(|s| s.len()).unwrap_or(0)
        + body.ciphertext.len()) as i64;

    let (plan, free_limit, pro_limit): (String, i64, i64) = state.db.with_conn(|conn| {
        let plan: String = conn.query_row(
            "SELECT plan FROM users WHERE id = ?1",
            params![claims.sub],
            |r| r.get(0),
        )?;
        let (free_limit, pro_limit): (i64, i64) = conn.query_row(
            "SELECT free_limit_bytes, pro_limit_bytes FROM settings WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        Ok((plan, free_limit, pro_limit))
    })?;

    let limit = if plan == "pro" { pro_limit } else { free_limit };
    if size > limit {
        return Err(ApiError::PayloadTooLarge(format!(
            "vault exceeds limit ({size} > {limit} bytes)"
        )));
    }

    let now = now_rfc3339();
    let current: Option<i64> = state.db.with_conn(|conn| {
        Ok(conn
            .query_row(
                "SELECT version FROM vaults WHERE user_id = ?1",
                params![claims.sub],
                |r| r.get(0),
            )
            .ok())
    })?;

    match current {
        None => {
            if expected != 0 {
                return Err(ApiError::Conflict("version_conflict".into()));
            }
            state.db.with_conn(|conn| {
                conn.execute(
                    "INSERT INTO vaults (user_id, version, kdf_salt, verifier, recovery_envelope, ciphertext, updated_at)
                     VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        claims.sub,
                        body.kdf_salt,
                        body.verifier,
                        body.recovery_envelope,
                        body.ciphertext,
                        now
                    ],
                )?;
                Ok(())
            })?;
            Ok(Json(PutVaultResponse { version: 1 }))
        }
        Some(v) => {
            if v != expected {
                return Err(ApiError::Conflict(format!(
                    "version_conflict current={v}"
                )));
            }
            let new_version = v + 1;
            state.db.with_conn(|conn| {
                conn.execute(
                    "UPDATE vaults SET version = ?2, kdf_salt = ?3, verifier = ?4,
                     recovery_envelope = ?5, ciphertext = ?6, updated_at = ?7
                     WHERE user_id = ?1 AND version = ?8",
                    params![
                        claims.sub,
                        new_version,
                        body.kdf_salt,
                        body.verifier,
                        body.recovery_envelope,
                        body.ciphertext,
                        now,
                        expected
                    ],
                )?;
                Ok(())
            })?;
            Ok(Json(PutVaultResponse {
                version: new_version,
            }))
        }
    }
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
    let (email, role, plan): (String, String, String) = state.db.with_conn(|conn| {
        Ok(conn.query_row(
            "SELECT email, role, plan FROM users WHERE id = ?1",
            params![claims.sub],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?)
    })?;

    let vault_bytes: i64 = state.db.with_conn(|conn| {
        Ok(conn
            .query_row(
                "SELECT length(kdf_salt)+length(verifier)+length(ifnull(recovery_envelope,''))+length(ciphertext)
                 FROM vaults WHERE user_id = ?1",
                params![claims.sub],
                |r| r.get(0),
            )
            .unwrap_or(0))
    })?;

    let (free_limit, pro_limit): (i64, i64) = state.db.with_conn(|conn| {
        Ok(conn.query_row(
            "SELECT free_limit_bytes, pro_limit_bytes FROM settings WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?)
    })?;

    Ok(Json(AccountResponse {
        email,
        role,
        plan: plan.clone(),
        vault_bytes,
        vault_limit_bytes: if plan == "pro" { pro_limit } else { free_limit },
    }))
}
