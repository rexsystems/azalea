pub mod crypto;

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::commands::backup::{build_backup, import_azalea_backup_db, AzaleaBackup};
use crate::store::SharedDatabase;
use crypto::VaultKey;

const KEYRING_SERVICE: &str = "azalea";
const META_LAST_VERSION: &str = "sync_last_version";
const META_LAST_HASH: &str = "sync_last_hash";

pub struct SyncState {
    http: reqwest::Client,
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_at: i64,
    user_id: Option<String>,
    email: Option<String>,
    vault_key: Option<VaultKey>,
}

pub type SharedSyncState = Arc<tokio::sync::Mutex<SyncState>>;

pub fn init_sync_state() -> SharedSyncState {
    Arc::new(tokio::sync::Mutex::new(SyncState {
        http: reqwest::Client::new(),
        access_token: None,
        refresh_token: None,
        expires_at: 0,
        user_id: None,
        email: None,
        vault_key: None,
    }))
}

fn supabase_config() -> anyhow::Result<(String, String)> {
    let url = std::env::var("SUPABASE_URL")
        .ok()
        .filter(|v| !v.is_empty())
        .or_else(|| option_env!("SUPABASE_URL").map(str::to_string))
        .ok_or_else(|| anyhow::anyhow!("SUPABASE_URL is not configured (.env)"))?;
    let key = std::env::var("SUPABASE_ANON_KEY")
        .ok()
        .filter(|v| !v.is_empty())
        .or_else(|| option_env!("SUPABASE_ANON_KEY").map(str::to_string))
        .ok_or_else(|| anyhow::anyhow!("SUPABASE_ANON_KEY is not configured (.env)"))?;
    Ok((url.trim_end_matches('/').to_string(), key))
}

/// Base URL of the Azalea management website used for browser login.
/// Configurable via AZALEA_WEB_URL; falls back to the hosted site.
pub fn web_base_url() -> String {
    std::env::var("AZALEA_WEB_URL")
        .ok()
        .filter(|v| !v.is_empty())
        .or_else(|| option_env!("AZALEA_WEB_URL").map(str::to_string))
        .unwrap_or_else(|| "https://azalea-web.pages.dev".to_string())
        .trim_end_matches('/')
        .to_string()
}

// ---------- keyring persistence ----------

fn store_keyring(name: &str, value: &str) -> anyhow::Result<()> {
    keyring::Entry::new(KEYRING_SERVICE, name)?.set_password(value)?;
    Ok(())
}

fn get_keyring(name: &str) -> Option<String> {
    keyring::Entry::new(KEYRING_SERVICE, name)
        .ok()?
        .get_password()
        .ok()
}

fn delete_keyring(name: &str) {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, name) {
        let _ = entry.delete_credential();
    }
}

// ---------- Supabase auth ----------

#[derive(Debug, Deserialize)]
struct AuthUser {
    id: String,
    email: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AuthSession {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
    user: AuthUser,
}

fn auth_error_message(body: &Value) -> String {
    body.get("error_description")
        .or_else(|| body.get("msg"))
        .or_else(|| body.get("message"))
        .or_else(|| body.get("error").and_then(|e| e.get("message")))
        .or_else(|| body.get("error"))
        .and_then(|v| v.as_str())
        .unwrap_or("Authentication failed")
        .to_string()
}

impl SyncState {
    fn apply_session(&mut self, session: AuthSession) {
        self.access_token = Some(session.access_token);
        self.expires_at = chrono::Utc::now().timestamp() + session.expires_in - 60;
        self.user_id = Some(session.user.id.clone());
        self.email = session.user.email.clone();
        let _ = store_keyring("sync-refresh-token", &session.refresh_token);
        if let Some(email) = &session.user.email {
            let _ = store_keyring("sync-email", email);
        }
        self.refresh_token = Some(session.refresh_token);
    }

    pub fn is_unlocked(&self) -> bool {
        self.vault_key.is_some()
    }

    pub fn email(&self) -> Option<String> {
        self.email.clone().or_else(|| get_keyring("sync-email"))
    }
}

async fn auth_request(
    state: &SyncState,
    path_and_query: &str,
    body: Value,
) -> anyhow::Result<AuthSession> {
    let (url, anon) = supabase_config()?;
    let resp = state
        .http
        .post(format!("{url}/auth/v1/{path_and_query}"))
        .header("apikey", &anon)
        .json(&body)
        .send()
        .await
        .map_err(|err| anyhow::anyhow!("Network error: {err}"))?;

    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        anyhow::bail!(auth_error_message(&body));
    }

    if body.get("access_token").is_none() {
        // Signup with email confirmation enabled returns a user but no session.
        anyhow::bail!("CONFIRM_EMAIL");
    }

    serde_json::from_value(body).map_err(|_| anyhow::anyhow!("Unexpected auth response"))
}

pub async fn login(state: &mut SyncState, email: &str, password: &str) -> anyhow::Result<()> {
    let session = auth_request(
        state,
        "token?grant_type=password",
        json!({ "email": email, "password": password }),
    )
    .await?;
    state.apply_session(session);
    Ok(())
}

/// Signs in using a refresh token obtained from the browser login flow.
/// The token is exchanged for a fresh session (and persisted to the keyring).
pub async fn login_with_refresh_token(
    state: &mut SyncState,
    refresh_token: &str,
) -> anyhow::Result<()> {
    let session = auth_request(
        state,
        "token?grant_type=refresh_token",
        json!({ "refresh_token": refresh_token }),
    )
    .await?;
    state.apply_session(session);
    Ok(())
}

async fn refresh_session(state: &mut SyncState) -> anyhow::Result<()> {
    let refresh_token = state
        .refresh_token
        .clone()
        .or_else(|| get_keyring("sync-refresh-token"))
        .ok_or_else(|| anyhow::anyhow!("Not logged in"))?;

    let session = auth_request(
        state,
        "token?grant_type=refresh_token",
        json!({ "refresh_token": refresh_token }),
    )
    .await?;
    state.apply_session(session);
    Ok(())
}

/// Makes sure we have a valid access token; restores the session from the
/// keyring refresh token if needed.
pub async fn ensure_session(state: &mut SyncState) -> anyhow::Result<()> {
    let now = chrono::Utc::now().timestamp();
    if state.access_token.is_some() && now < state.expires_at {
        return Ok(());
    }
    refresh_session(state).await
}

pub fn logout(state: &mut SyncState, db: &SharedDatabase) {
    state.access_token = None;
    state.refresh_token = None;
    state.user_id = None;
    state.email = None;
    state.vault_key = None;
    state.expires_at = 0;
    delete_keyring("sync-refresh-token");
    delete_keyring("sync-email");
    let db = db.lock();
    let _ = db.delete_sync_meta(META_LAST_VERSION);
    let _ = db.delete_sync_meta(META_LAST_HASH);
}

// ---------- vault REST ----------

#[derive(Debug, Clone, Deserialize)]
pub struct VaultRow {
    pub version: i64,
    pub kdf_salt: String,
    pub verifier: String,
    pub recovery_envelope: Option<String>,
    pub ciphertext: String,
}

async fn rest_request(
    state: &SyncState,
    method: reqwest::Method,
    path_and_query: &str,
    body: Option<Value>,
    prefer: Option<&str>,
) -> anyhow::Result<(reqwest::StatusCode, Value)> {
    let (url, anon) = supabase_config()?;
    let token = state
        .access_token
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("Not logged in"))?;

    let mut req = state
        .http
        .request(method, format!("{url}/rest/v1/{path_and_query}"))
        .header("apikey", &anon)
        .header("Authorization", format!("Bearer {token}"));
    if let Some(prefer) = prefer {
        req = req.header("Prefer", prefer);
    }
    if let Some(body) = body {
        req = req.json(&body);
    }

    let resp = req
        .send()
        .await
        .map_err(|err| anyhow::anyhow!("Network error: {err}"))?;
    let status = resp.status();
    let value: Value = resp.json().await.unwrap_or(Value::Null);
    Ok((status, value))
}

pub async fn fetch_vault(state: &SyncState) -> anyhow::Result<Option<VaultRow>> {
    let (status, body) = rest_request(
        state,
        reqwest::Method::GET,
        "vaults?select=version,kdf_salt,verifier,recovery_envelope,ciphertext",
        None,
        None,
    )
    .await?;

    if !status.is_success() {
        anyhow::bail!("Could not fetch vault: {}", auth_error_message(&body));
    }

    let rows: Vec<VaultRow> = serde_json::from_value(body)
        .map_err(|_| anyhow::anyhow!("Unexpected vault response"))?;
    Ok(rows.into_iter().next())
}

async fn insert_vault(
    state: &SyncState,
    kdf_salt: &str,
    verifier: &str,
    recovery_envelope: &str,
    ciphertext: &str,
) -> anyhow::Result<()> {
    let user_id = state
        .user_id
        .clone()
        .ok_or_else(|| anyhow::anyhow!("Not logged in"))?;
    let (status, body) = rest_request(
        state,
        reqwest::Method::POST,
        "vaults",
        Some(json!({
            "user_id": user_id,
            "version": 1,
            "kdf_salt": kdf_salt,
            "verifier": verifier,
            "recovery_envelope": recovery_envelope,
            "ciphertext": ciphertext,
        })),
        Some("return=minimal"),
    )
    .await?;

    if !status.is_success() {
        anyhow::bail!("Could not create vault: {}", auth_error_message(&body));
    }
    Ok(())
}

/// Optimistic-lock update: only succeeds if the remote version is still
/// `expected_version`. Returns false when someone else pushed in between.
async fn update_vault(
    state: &SyncState,
    expected_version: i64,
    new_version: i64,
    ciphertext: &str,
) -> anyhow::Result<bool> {
    let user_id = state
        .user_id
        .clone()
        .ok_or_else(|| anyhow::anyhow!("Not logged in"))?;
    let (status, body) = rest_request(
        state,
        reqwest::Method::PATCH,
        &format!("vaults?user_id=eq.{user_id}&version=eq.{expected_version}"),
        Some(json!({
            "version": new_version,
            "ciphertext": ciphertext,
            "updated_at": chrono::Utc::now().to_rfc3339(),
        })),
        Some("return=representation"),
    )
    .await?;

    if !status.is_success() {
        anyhow::bail!("Could not push vault: {}", auth_error_message(&body));
    }
    Ok(body.as_array().map(|rows| !rows.is_empty()).unwrap_or(false))
}

// ---------- vault build / apply ----------

fn local_vault_json(db: &SharedDatabase, settings: Option<Value>) -> anyhow::Result<(String, String)> {
    let backup = build_backup(db, settings).map_err(|err| anyhow::anyhow!(err))?;
    let json = serde_json::to_string(&backup)?;

    // Fingerprint ignores exported_at so an untouched vault hashes identically.
    let mut fingerprint_backup = backup;
    fingerprint_backup.exported_at = 0;
    let fingerprint = crypto::vault_hash(&serde_json::to_string(&fingerprint_backup)?);

    Ok((json, fingerprint))
}

fn apply_remote_vault(
    db: &SharedDatabase,
    plaintext: &[u8],
) -> anyhow::Result<Option<Value>> {
    let json = String::from_utf8(plaintext.to_vec())
        .map_err(|_| anyhow::anyhow!("Corrupted vault payload"))?;
    let backup: AzaleaBackup =
        serde_json::from_str(&json).map_err(|_| anyhow::anyhow!("Unrecognized vault format"))?;
    let result =
        import_azalea_backup_db(db, backup, true, None).map_err(|err| anyhow::anyhow!(err))?;
    Ok(result.settings)
}

fn set_synced_meta(db: &SharedDatabase, version: i64, settings: Option<&Value>) -> anyhow::Result<()> {
    // Recompute the fingerprint from the just-synced local state.
    let (_, fingerprint) = local_vault_json(db, settings.cloned())?;
    let db = db.lock();
    db.set_sync_meta(META_LAST_VERSION, &version.to_string())?;
    db.set_sync_meta(META_LAST_HASH, &fingerprint)?;
    Ok(())
}

fn synced_meta(db: &SharedDatabase) -> (i64, Option<String>) {
    let db = db.lock();
    let version = db
        .get_sync_meta(META_LAST_VERSION)
        .ok()
        .flatten()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let hash = db.get_sync_meta(META_LAST_HASH).ok().flatten();
    (version, hash)
}

// ---------- high-level flows ----------

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum SyncOutcome {
    NeedsSetup,
    Locked,
    InSync { version: i64 },
    Pushed { version: i64 },
    Pulled { version: i64, settings: Option<Value> },
    Conflict { remote_version: i64 },
}

pub async fn setup_passphrase(
    state: &mut SyncState,
    db: &SharedDatabase,
    passphrase: &str,
    settings: Option<Value>,
) -> anyhow::Result<String> {
    ensure_session(state).await?;

    if fetch_vault(state).await?.is_some() {
        anyhow::bail!("A vault already exists for this account. Unlock it with your passphrase instead.");
    }

    let salt = crypto::generate_salt();
    let vault_key = crypto::generate_key();
    let kek = crypto::derive_key(passphrase, &salt)?;
    let verifier = crypto::seal_vault_key(&kek, &vault_key)?;

    let recovery_raw = crypto::generate_key();
    let recovery_string = crypto::format_recovery_key(&recovery_raw);
    let recovery_kek = crypto::recovery_kek_from_string(&recovery_string);
    let recovery_envelope = crypto::seal_vault_key(&recovery_kek, &vault_key)?;

    let (json, _) = local_vault_json(db, settings.clone())?;
    let ciphertext = crypto::encrypt(&vault_key, json.as_bytes())?;

    insert_vault(state, &salt, &verifier, &recovery_envelope, &ciphertext).await?;

    state.vault_key = Some(vault_key);
    set_synced_meta(db, 1, settings.as_ref())?;

    Ok(recovery_string)
}

pub async fn unlock(
    state: &mut SyncState,
    db: &SharedDatabase,
    passphrase: Option<&str>,
    recovery_key: Option<&str>,
) -> anyhow::Result<(i64, Option<Value>)> {
    ensure_session(state).await?;

    let vault = fetch_vault(state)
        .await?
        .ok_or_else(|| anyhow::anyhow!("No vault exists for this account yet."))?;

    let vault_key = if let Some(passphrase) = passphrase {
        let kek = crypto::derive_key(passphrase, &vault.kdf_salt)?;
        crypto::open_vault_key(&kek, &vault.verifier)
            .map_err(|_| anyhow::anyhow!("Wrong passphrase."))?
    } else if let Some(recovery) = recovery_key {
        let envelope = vault
            .recovery_envelope
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("This vault has no recovery key."))?;
        let kek = crypto::recovery_kek_from_string(recovery);
        crypto::open_vault_key(&kek, envelope)
            .map_err(|_| anyhow::anyhow!("Wrong recovery key."))?
    } else {
        anyhow::bail!("Passphrase or recovery key required.");
    };

    let plaintext = crypto::decrypt(&vault_key, &vault.ciphertext)?;
    let settings = apply_remote_vault(db, &plaintext)?;

    state.vault_key = Some(vault_key);
    set_synced_meta(db, vault.version, settings.as_ref())?;

    Ok((vault.version, settings))
}

async fn push_local(
    state: &SyncState,
    vault_key: &VaultKey,
    local_json: &str,
    expected: i64,
) -> anyhow::Result<Option<i64>> {
    let ciphertext = crypto::encrypt(vault_key, local_json.as_bytes())?;
    let new_version = expected + 1;
    if update_vault(state, expected, new_version, &ciphertext).await? {
        Ok(Some(new_version))
    } else {
        Ok(None)
    }
}

pub async fn perform_sync(
    state: &mut SyncState,
    db: &SharedDatabase,
    settings: Option<Value>,
    resolution: Option<&str>,
) -> anyhow::Result<SyncOutcome> {
    ensure_session(state).await?;

    let Some(vault) = fetch_vault(state).await? else {
        return Ok(SyncOutcome::NeedsSetup);
    };

    let Some(vault_key) = state.vault_key else {
        return Ok(SyncOutcome::Locked);
    };

    let (local_json, fingerprint) = local_vault_json(db, settings.clone())?;
    let (last_version, last_hash) = synced_meta(db);
    let dirty = last_hash.as_deref() != Some(fingerprint.as_str());

    if vault.version <= last_version {
        // We are up to date with (or ahead of) the remote.
        if !dirty {
            return Ok(SyncOutcome::InSync { version: vault.version });
        }
        match push_local(state, &vault_key, &local_json, vault.version).await? {
            Some(new_version) => {
                set_synced_meta(db, new_version, settings.as_ref())?;
                Ok(SyncOutcome::Pushed { version: new_version })
            }
            None => Ok(SyncOutcome::Conflict { remote_version: vault.version }),
        }
    } else {
        // Remote moved ahead of us.
        if !dirty || resolution == Some("keep_cloud") {
            let plaintext = crypto::decrypt(&vault_key, &vault.ciphertext)?;
            let settings = apply_remote_vault(db, &plaintext)?;
            set_synced_meta(db, vault.version, settings.as_ref())?;
            return Ok(SyncOutcome::Pulled { version: vault.version, settings });
        }
        if resolution == Some("keep_local") {
            return match push_local(state, &vault_key, &local_json, vault.version).await? {
                Some(new_version) => {
                    set_synced_meta(db, new_version, settings.as_ref())?;
                    Ok(SyncOutcome::Pushed { version: new_version })
                }
                None => Ok(SyncOutcome::Conflict { remote_version: vault.version }),
            };
        }
        Ok(SyncOutcome::Conflict { remote_version: vault.version })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct SyncStatus {
    pub configured: bool,
    pub logged_in: bool,
    pub email: Option<String>,
    pub unlocked: bool,
    pub vault_exists: Option<bool>,
    pub remote_version: Option<i64>,
    pub last_synced_version: i64,
}

pub async fn status(state: &mut SyncState, db: &SharedDatabase) -> SyncStatus {
    let configured = supabase_config().is_ok();
    let mut logged_in = false;

    if configured {
        logged_in = ensure_session(state).await.is_ok();
    }

    let (vault_exists, remote_version) = if logged_in {
        match fetch_vault(state).await {
            Ok(Some(vault)) => (Some(true), Some(vault.version)),
            Ok(None) => (Some(false), None),
            Err(_) => (None, None),
        }
    } else {
        (None, None)
    };

    let (last_version, _) = synced_meta(db);

    SyncStatus {
        configured,
        logged_in,
        email: if logged_in { state.email() } else { None },
        unlocked: state.is_unlocked(),
        vault_exists,
        remote_version,
        last_synced_version: last_version,
    }
}
