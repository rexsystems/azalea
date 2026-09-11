pub mod crypto;
pub mod diff;

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::commands::backup::{build_backup, import_azalea_backup_db, AzaleaBackup};
use crate::store::SharedDatabase;
use crypto::VaultKey;

const KEYRING_SERVICE: &str = "azalea";
const META_LAST_VERSION: &str = "sync_last_version";
const META_LAST_HASH: &str = "sync_last_hash";
const FREE_VAULT_LIMIT_BYTES: i64 = 262_144;

fn vault_row_bytes(
    ciphertext: &str,
    verifier: &str,
    kdf_salt: &str,
    recovery_envelope: Option<&str>,
) -> i64 {
    let recovery = recovery_envelope.unwrap_or("");
    (ciphertext.len() + verifier.len() + kdf_salt.len() + recovery.len()) as i64
}

fn ensure_vault_within_limit(limit_bytes: i64, total_bytes: i64) -> anyhow::Result<()> {
    if total_bytes > limit_bytes {
        let used_kb = total_bytes / 1024;
        let limit_kb = limit_bytes / 1024;
        anyhow::bail!(
            "Cloud vault exceeds your plan limit ({used_kb} KB / {limit_kb} KB). Remove hosts or keys locally, then sync again, or upgrade to Pro."
        );
    }
    Ok(())
}

fn vault_error_message(body: &Value) -> String {
    let msg = auth_error_message(body);
    if msg.contains("Cloud vault exceeds") || msg.contains("storage limit") {
        return "Cloud vault is full. Remove hosts or keys locally, then sync again, or upgrade to Pro on the website.".to_string();
    }
    msg
}

#[derive(Debug, Clone, Deserialize)]
struct AccountPlanRow {
    plan: String,
    role: String,
    limit_bytes: i64,
    used_bytes: i64,
    #[allow(dead_code)]
    remaining_bytes: i64,
}

impl Default for AccountPlanRow {
    fn default() -> Self {
        Self {
            plan: "free".to_string(),
            role: "user".to_string(),
            limit_bytes: FREE_VAULT_LIMIT_BYTES,
            used_bytes: 0,
            remaining_bytes: FREE_VAULT_LIMIT_BYTES,
        }
    }
}

async fn fetch_account_plan(state: &SyncState) -> AccountPlanRow {
    let Ok((status, body)) = api_request(state, reqwest::Method::GET, "/v1/account", None).await
    else {
        return AccountPlanRow::default();
    };

    if !status.is_success() {
        return AccountPlanRow::default();
    }

    #[derive(Deserialize)]
    struct AccountBody {
        plan: String,
        #[serde(default)]
        role: String,
        vault_bytes: i64,
        vault_limit_bytes: i64,
    }

    let Ok(account) = serde_json::from_value::<AccountBody>(body) else {
        return AccountPlanRow::default();
    };

    let mut row = normalize_plan_row(AccountPlanRow {
        plan: account.plan,
        role: account.role,
        limit_bytes: account.vault_limit_bytes,
        used_bytes: account.vault_bytes,
        remaining_bytes: (account.vault_limit_bytes - account.vault_bytes).max(0),
    });
    let role = row.role.trim().to_ascii_lowercase();
    row.role = if role == "admin" {
        "admin".into()
    } else {
        "user".into()
    };
    row
}

fn normalize_plan_row(mut row: AccountPlanRow) -> AccountPlanRow {
    let plan = row.plan.trim().to_ascii_lowercase();
    row.plan = if plan == "pro" { "pro".into() } else { "free".into() };
    if row.limit_bytes <= 0 {
        row.limit_bytes = if row.plan == "pro" {
            10 * 1024 * 1024
        } else {
            FREE_VAULT_LIMIT_BYTES
        };
    }
    row
}

pub struct SyncState {
    http: reqwest::Client,
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_at: i64,
    user_id: Option<String>,
    email: Option<String>,
    vault_key: Option<VaultKey>,
    account_id: Option<String>,
    api_base: Option<String>,
    web_url: Option<String>,
}

pub type SharedSyncState = Arc<tokio::sync::Mutex<SyncState>>;

pub fn init_sync_state() -> SharedSyncState {
    Arc::new(tokio::sync::Mutex::new(SyncState {
        http: desktop_http_client(),
        access_token: None,
        refresh_token: None,
        expires_at: 0,
        user_id: None,
        email: None,
        vault_key: None,
        account_id: None,
        api_base: None,
        web_url: None,
    }))
}

/// Builds a reqwest client tagged with the `x-azalea-client: desktop` header
/// on every request. The server uses this header to decide whether to return
/// the refresh token in the JSON body (desktop) or set an HttpOnly cookie
/// (web).
fn desktop_http_client() -> reqwest::Client {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::HeaderName::from_static("x-azalea-client"),
        reqwest::header::HeaderValue::from_static("desktop"),
    );
    reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// Rejects `http://` for non-loopback hosts unless the operator explicitly
/// opts in with `AZALEA_ALLOW_INSECURE_SYNC=1`. Loopback / `.local` / RFC1918
/// hosts are always allowed. Prevents plaintext credentials from being sent to
/// a public sync server.
fn ensure_https_or_loopback(base_url: &str) -> anyhow::Result<()> {
    let (scheme, host) = split_scheme_host(base_url)
        .ok_or_else(|| anyhow::anyhow!("Invalid server URL"))?;
    if scheme == "https" {
        return Ok(());
    }
    if scheme != "http" {
        anyhow::bail!("Unsupported URL scheme: {scheme}");
    }
    if std::env::var("AZALEA_ALLOW_INSECURE_SYNC").ok().as_deref() == Some("1") {
        return Ok(());
    }
    let host = host.to_ascii_lowercase();
    let is_loopback = host == "localhost"
        || host == "127.0.0.1"
        || host == "::1"
        || host.ends_with(".local")
        || is_private_ipv4(&host);
    if is_loopback {
        return Ok(());
    }
    anyhow::bail!(
        "Refusing plaintext http:// for a public server. Use https:// (or set AZALEA_ALLOW_INSECURE_SYNC=1 to override)."
    );
}

/// Cheap scheme+host extractor. Returns None if the URL is malformed.
/// Only the parts we care about for HTTPS enforcement.
fn split_scheme_host(url: &str) -> Option<(&str, &str)> {
    let (scheme, rest) = url.split_once("://")?;
    let after_userinfo = rest.rsplit_once('@').map(|(_, r)| r).unwrap_or(rest);
    let host_and_port = after_userinfo
        .split_once('/')
        .map(|(h, _)| h)
        .unwrap_or(after_userinfo);
    // Strip port. IPv6 (bracketed) hosts also work: `[::1]:8080`.
    let host = if let Some(stripped) = host_and_port.strip_prefix('[') {
        stripped.split_once(']').map(|(h, _)| h).unwrap_or(stripped)
    } else if let Some((h, _)) = host_and_port.rsplit_once(':') {
        h
    } else {
        host_and_port
    };
    Some((scheme, host))
}

fn is_private_ipv4(host: &str) -> bool {
    let Ok(ip) = host.parse::<std::net::Ipv4Addr>() else {
        return false;
    };
    let o = ip.octets();
    // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10 (CGNAT)
    o[0] == 10
        || (o[0] == 172 && (16..=31).contains(&o[1]))
        || (o[0] == 192 && o[1] == 168)
        || (o[0] == 100 && (64..=127).contains(&o[1]))
}

/// Public wrapper around the internal `api_base_url` for use from
/// `commands/sync.rs`. Kept separate so we don't accidentally leak the
/// internal helper across the module boundary.
pub fn api_base_url_public(state: &SyncState) -> anyhow::Result<String> {
    api_base_url(state)
}

fn api_base_url(state: &SyncState) -> anyhow::Result<String> {
    if let Some(url) = state
        .api_base
        .as_ref()
        .map(|u| u.trim().trim_end_matches('/'))
        .filter(|u| !u.is_empty())
    {
        return Ok(url.to_string());
    }
    std::env::var("AZALEA_API_URL")
        .ok()
        .filter(|v| !v.is_empty())
        .or_else(|| option_env!("AZALEA_API_URL").map(str::to_string))
        .map(|u| u.trim_end_matches('/').to_string())
        .ok_or_else(|| anyhow::anyhow!("AZALEA_API_URL is not configured"))
}

fn api_configured(state: &SyncState) -> bool {
    api_base_url(state).is_ok()
}

fn keyring_name(state: &SyncState, key: &str) -> String {
    match &state.account_id {
        Some(id) => format!("{key}:{id}"),
        None => key.to_string(),
    }
}


/// Base URL of the Azalea management website used for browser login.
pub fn web_base_url(state: Option<&SyncState>) -> String {
    if let Some(url) = state
        .and_then(|s| s.web_url.as_ref())
        .map(|u| u.trim().trim_end_matches('/'))
        .filter(|u| !u.is_empty())
    {
        return url.to_string();
    }
    std::env::var("AZALEA_WEB_URL")
        .ok()
        .filter(|v| !v.is_empty())
        .or_else(|| option_env!("AZALEA_WEB_URL").map(str::to_string))
        .unwrap_or_else(|| "https://azalea.rexsystems.me".to_string())
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

// ---------- Auth session ----------

#[derive(Debug, Deserialize)]
struct AuthUser {
    id: String,
    email: String,
    #[serde(default)]
    role: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AuthSession {
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
        self.email = Some(session.user.email.clone());
        let _ = store_keyring(
            &keyring_name(self, "sync-refresh-token"),
            &session.refresh_token,
        );
        let _ = store_keyring(&keyring_name(self, "sync-email"), &session.user.email);
        delete_keyring(&keyring_name(self, "sync-auth-disconnected"));
        self.refresh_token = Some(session.refresh_token);
    }

    pub(crate) fn apply_auth_session(&mut self, session: AuthSession) {
        self.apply_session(session);
    }

    pub fn is_unlocked(&self) -> bool {
        self.vault_key.is_some()
    }

    pub fn email(&self) -> Option<String> {
        self.email
            .clone()
            .or_else(|| get_keyring(&keyring_name(self, "sync-email")))
    }

    pub fn account_id_clone(&self) -> Option<String> {
        self.account_id.clone()
    }

    pub fn bind_account(
        &mut self,
        account_id: String,
        api_base: Option<String>,
        web_url: Option<String>,
    ) {
        self.account_id = Some(account_id);
        self.api_base = api_base;
        self.web_url = web_url;
        self.access_token = None;
        self.refresh_token = None;
        self.expires_at = 0;
        self.user_id = None;
        self.email = None;
        self.vault_key = None;
        if let Some(token) = get_keyring(&keyring_name(self, "sync-refresh-token")) {
            self.refresh_token = Some(token);
        }
        if let Some(email) = get_keyring(&keyring_name(self, "sync-email")) {
            self.email = Some(email);
        }
    }
}

async fn auth_refresh(state: &SyncState, refresh_token: &str) -> anyhow::Result<AuthSession> {
    let base = api_base_url(state)?;
    let resp = state
        .http
        .post(format!("{base}/v1/auth/refresh"))
        .json(&json!({ "refresh_token": refresh_token }))
        .send()
        .await
        .map_err(|err| anyhow::anyhow!("Network error: {err}"))?;

    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        anyhow::bail!(auth_error_message(&body));
    }

    serde_json::from_value(body).map_err(|_| anyhow::anyhow!("Unexpected auth response"))
}

/// Signs in using a refresh token obtained from the browser login flow.
///
/// Retained for tooling / migrations; the primary browser-login path is now
/// `exchange_desktop_code` + `login_with_desktop_session`, which uses a PKCE
/// code exchange instead of passing the refresh token through the browser.
#[allow(dead_code)]
pub async fn login_with_refresh_token(
    state: &mut SyncState,
    refresh_token: &str,
) -> anyhow::Result<()> {
    let session = auth_refresh(state, refresh_token).await?;
    state.apply_session(session);
    Ok(())
}

/// Direct email/password login against azalea-server `/v1/auth/login`.
pub async fn login_with_password(
    state: &mut SyncState,
    email: &str,
    password: &str,
) -> anyhow::Result<()> {
    let base = api_base_url(state)?;
    let session = password_login_at_url(&base, email, password).await?;
    state.apply_session(session);
    Ok(())
}

/// Login against an arbitrary API base without binding/switching accounts.
pub async fn password_login_at_url(
    base_url: &str,
    email: &str,
    password: &str,
) -> anyhow::Result<AuthSession> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        anyhow::bail!("Server URL is required");
    }
    ensure_https_or_loopback(base)?;
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::HeaderName::from_static("x-azalea-client"),
        reqwest::header::HeaderValue::from_static("desktop"),
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .default_headers(headers)
        .build()?;
    let resp = client
        .post(format!("{base}/v1/auth/login"))
        .json(&json!({ "email": email.trim(), "password": password }))
        .send()
        .await
        .map_err(|err| anyhow::anyhow!("Network error: {err}"))?;

    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        anyhow::bail!(auth_error_message(&body));
    }

    serde_json::from_value(body).map_err(|_| anyhow::anyhow!("Unexpected auth response"))
}

// ---------- Desktop PKCE handoff ----------

/// PKCE code verifier + derived challenge. The verifier stays in this process;
/// only the challenge crosses the wire (and later the auth code, which is
/// worthless without the verifier).
#[derive(Debug, Clone)]
pub struct PkceMaterial {
    pub verifier: String,
    pub challenge: String,
}

pub fn new_pkce_material() -> PkceMaterial {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine as _;
    use rand::rngs::OsRng;
    use sha2::{Digest, Sha256};

    let mut bytes = [0u8; 32];
    rand::RngCore::fill_bytes(&mut OsRng, &mut bytes);
    let verifier = URL_SAFE_NO_PAD.encode(bytes);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    PkceMaterial { verifier, challenge }
}

/// Ask the server to open a PKCE handle. Returns the handle string that goes
/// into the browser URL (`/authorize?...&handle=...`).
pub async fn begin_desktop_pkce(
    base_url: &str,
    challenge: &str,
    client_state: &str,
) -> anyhow::Result<String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        anyhow::bail!("Server URL is required");
    }
    ensure_https_or_loopback(base)?;
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::HeaderName::from_static("x-azalea-client"),
        reqwest::header::HeaderValue::from_static("desktop"),
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .default_headers(headers)
        .build()?;
    let resp = client
        .post(format!("{base}/v1/auth/desktop/begin"))
        .json(&json!({
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "client_state": client_state,
        }))
        .send()
        .await
        .map_err(|err| anyhow::anyhow!("Network error: {err}"))?;

    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        anyhow::bail!(auth_error_message(&body));
    }
    let handle = body
        .get("handle")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("Unexpected /desktop/begin response"))?;
    Ok(handle.to_string())
}

/// Redeem a `code` returned by the browser callback for a full session.
pub async fn exchange_desktop_code(
    base_url: &str,
    handle: &str,
    code: &str,
    verifier: &str,
) -> anyhow::Result<AuthSession> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        anyhow::bail!("Server URL is required");
    }
    ensure_https_or_loopback(base)?;
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::HeaderName::from_static("x-azalea-client"),
        reqwest::header::HeaderValue::from_static("desktop"),
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .default_headers(headers)
        .build()?;
    let resp = client
        .post(format!("{base}/v1/auth/desktop/exchange"))
        .json(&json!({
            "handle": handle,
            "code": code,
            "code_verifier": verifier,
        }))
        .send()
        .await
        .map_err(|err| anyhow::anyhow!("Network error: {err}"))?;

    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        anyhow::bail!(auth_error_message(&body));
    }
    serde_json::from_value(body).map_err(|_| anyhow::anyhow!("Unexpected exchange response"))
}

/// Sign in using a fresh session returned from /v1/auth/desktop/exchange.
pub async fn login_with_desktop_session(
    state: &mut SyncState,
    session: AuthSession,
) -> anyhow::Result<()> {
    state.apply_session(session);
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct ConnectSelfhostResult {
    pub account: crate::store::accounts::AccountRecord,
    pub vault_exists: Option<bool>,
    pub email: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SelfHostProbe {
    pub ok: bool,
    pub instance_name: String,
    pub version: Option<String>,
    /// True when a management web UI responded (login / authorize).
    pub has_web_ui: bool,
    pub web_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ProbeSelfhostInput {
    pub base_url: String,
    pub web_url: Option<String>,
}

/// Probe a self-host API base URL (before the account is bound).
pub async fn probe_selfhost(base_url: &str, web_url: Option<&str>) -> anyhow::Result<SelfHostProbe> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        anyhow::bail!("Server URL is required");
    }
    ensure_https_or_loopback(base)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()?;
    let resp = client
        .get(format!("{base}/v1/health"))
        .send()
        .await
        .map_err(|err| anyhow::anyhow!("Cannot reach server: {err}"))?;
    if !resp.status().is_success() {
        anyhow::bail!("Server health check failed ({})", resp.status());
    }
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    let ok = body.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    if !ok {
        anyhow::bail!("Server did not report healthy");
    }
    let instance_name = body
        .get("instance_name")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Azalea")
        .to_string();
    let version = body
        .get("version")
        .and_then(|v| v.as_str())
        .map(str::to_string);

    let resolved_web = web_url
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.trim_end_matches('/').to_string());

    let has_web_ui = if let Some(ref web) = resolved_web {
        probe_web_ui(&client, web).await
    } else {
        false
    };

    Ok(SelfHostProbe {
        ok: true,
        instance_name,
        version,
        has_web_ui,
        web_url: if has_web_ui {
            resolved_web
        } else {
            None
        },
    })
}

async fn probe_web_ui(client: &reqwest::Client, web_url: &str) -> bool {
    // Dashboard serves /login and /authorize; API-only installs usually 404 here.
    for path in ["/authorize", "/login"] {
        let url = format!("{web_url}{path}");
        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => return true,
            Ok(resp) if resp.status().is_redirection() => return true,
            _ => continue,
        }
    }
    false
}

async fn refresh_session(state: &mut SyncState) -> anyhow::Result<()> {
    let refresh_token = state
        .refresh_token
        .clone()
        .or_else(|| get_keyring(&keyring_name(state, "sync-refresh-token")))
        .ok_or_else(|| anyhow::anyhow!("Not logged in"))?;

    match auth_refresh(state, &refresh_token).await {
        Ok(session) => {
            state.apply_session(session);
            Ok(())
        }
        Err(err) => {
            let msg = err.to_string().to_lowercase();
            let hard_reject = msg.contains("invalid refresh token")
                || msg.contains("invalid_grant")
                || msg.contains("refresh token not found")
                || msg.contains("refresh token expired")
                || msg.contains("session not found")
                || msg.contains("unauthorized");
            if hard_reject {
                state.access_token = None;
                state.refresh_token = None;
                state.expires_at = 0;
                delete_keyring(&keyring_name(state, "sync-refresh-token"));
                let _ = store_keyring(&keyring_name(state, "sync-auth-disconnected"), "1");
            }
            Err(err)
        }
    }
}

fn is_auth_disconnected(state: &SyncState) -> bool {
    get_keyring(&keyring_name(state, "sync-auth-disconnected")).as_deref() == Some("1")
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

/// True if we still have a persisted refresh token (even if access token refresh
/// just failed transiently).
fn has_persisted_login(state: &SyncState) -> bool {
    state.refresh_token.is_some()
        || get_keyring(&keyring_name(state, "sync-refresh-token")).is_some()
}

pub fn logout(state: &mut SyncState, db: &SharedDatabase) {
    let refresh_key = keyring_name(state, "sync-refresh-token");
    let email_key = keyring_name(state, "sync-email");
    let disconnected_key = keyring_name(state, "sync-auth-disconnected");
    state.access_token = None;
    state.refresh_token = None;
    state.user_id = None;
    state.email = None;
    state.vault_key = None;
    state.expires_at = 0;
    delete_keyring(&refresh_key);
    delete_keyring(&email_key);
    delete_keyring(&disconnected_key);
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

async fn api_request(
    state: &SyncState,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> anyhow::Result<(reqwest::StatusCode, Value)> {
    let base = api_base_url(state)?;
    let token = state
        .access_token
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("Not logged in"))?;

    let mut req = state
        .http
        .request(method, format!("{base}{path}"))
        .header("Authorization", format!("Bearer {token}"));
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
    let (status, body) = api_request(state, reqwest::Method::GET, "/v1/vault", None).await?;

    if !status.is_success() {
        anyhow::bail!("Could not fetch vault: {}", auth_error_message(&body));
    }

    let exists = body
        .get("exists")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !exists {
        return Ok(None);
    }

    let row: VaultRow = serde_json::from_value(body)
        .map_err(|_| anyhow::anyhow!("Unexpected vault response"))?;
    Ok(Some(row))
}

async fn put_vault(
    state: &SyncState,
    expected_version: i64,
    kdf_salt: &str,
    verifier: &str,
    recovery_envelope: Option<&str>,
    ciphertext: &str,
) -> anyhow::Result<i64> {
    let (status, body) = api_request(
        state,
        reqwest::Method::PUT,
        "/v1/vault",
        Some(json!({
            "expected_version": expected_version,
            "kdf_salt": kdf_salt,
            "verifier": verifier,
            "recovery_envelope": recovery_envelope,
            "ciphertext": ciphertext,
        })),
    )
    .await?;

    if status.as_u16() == 409 {
        anyhow::bail!("version_conflict");
    }
    if status.as_u16() == 413 {
        anyhow::bail!("{}", vault_error_message(&body));
    }
    if !status.is_success() {
        anyhow::bail!("Could not save vault: {}", vault_error_message(&body));
    }

    body.get("version")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| anyhow::anyhow!("Unexpected vault put response"))
}

async fn insert_vault(
    state: &SyncState,
    kdf_salt: &str,
    verifier: &str,
    recovery_envelope: &str,
    ciphertext: &str,
) -> anyhow::Result<()> {
    let _ = put_vault(
        state,
        0,
        kdf_salt,
        verifier,
        Some(recovery_envelope),
        ciphertext,
    )
    .await?;
    Ok(())
}

/// Optimistic-lock update. Returns false when someone else pushed in between.
async fn update_vault(
    state: &SyncState,
    expected_version: i64,
    _new_version: i64,
    ciphertext: &str,
    vault_meta: &VaultRow,
) -> anyhow::Result<bool> {
    match put_vault(
        state,
        expected_version,
        &vault_meta.kdf_salt,
        &vault_meta.verifier,
        vault_meta.recovery_envelope.as_deref(),
        ciphertext,
    )
    .await
    {
        Ok(_) => Ok(true),
        Err(err) if err.to_string().contains("version_conflict") => Ok(false),
        Err(err) => Err(err),
    }
}

// ---------- vault build / apply ----------

fn local_vault_json(db: &SharedDatabase, settings: Option<Value>) -> anyhow::Result<(String, String)> {
    let backup = build_backup(db, settings).map_err(|err| anyhow::anyhow!(err))?;
    let json = serde_json::to_string(&backup)?;
    let fingerprint = diff::semantic_fingerprint(&backup);
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
    let account_id = require_account_id(state)?;
    // AAD binds account_id + version (1 for the initial write) + kdf_salt so
    // a malicious server cannot swap this ciphertext for another account's or
    // an older version's blob without detection.
    let aad = crypto::vault_aad(&account_id, 1, &salt);
    let ciphertext = crypto::encrypt_with_aad(&vault_key, json.as_bytes(), &aad)?;

    let plan = fetch_account_plan(state).await;
    let total = vault_row_bytes(&ciphertext, &verifier, &salt, Some(&recovery_envelope));
    ensure_vault_within_limit(plan.limit_bytes, total)?;

    insert_vault(state, &salt, &verifier, &recovery_envelope, &ciphertext).await?;

    state.vault_key = Some(vault_key);
    set_synced_meta(db, 1, settings.as_ref())?;

    Ok(recovery_string)
}

pub async fn unlock(
    state: &mut SyncState,
    _db: &SharedDatabase,
    passphrase: Option<&str>,
    recovery_key: Option<&str>,
) -> anyhow::Result<i64> {
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

    // Verify the vault decrypts; do not overwrite local data here.
    let account_id = require_account_id(state)?;
    let aad = crypto::vault_aad(&account_id, vault.version, &vault.kdf_salt);
    let _plaintext = crypto::decrypt_with_aad(&vault_key, &vault.ciphertext, &aad)?;

    state.vault_key = Some(vault_key);
    Ok(vault.version)
}

/// Returns the current account id or errors out. Vault crypto that binds AAD
/// on account_id must not silently fall back to an empty string, or the AAD
/// would be trivially predictable and its rollback-protection purpose lost.
fn require_account_id(state: &SyncState) -> anyhow::Result<String> {
    state
        .account_id_clone()
        .ok_or_else(|| anyhow::anyhow!("No account bound; cannot encrypt vault"))
}

async fn push_local(
    state: &SyncState,
    vault_key: &VaultKey,
    local_json: &str,
    expected: i64,
    vault_meta: &VaultRow,
    limit_bytes: i64,
) -> anyhow::Result<Option<i64>> {
    let new_version = expected + 1;
    let account_id = require_account_id(state)?;
    let aad = crypto::vault_aad(&account_id, new_version, &vault_meta.kdf_salt);
    let ciphertext = crypto::encrypt_with_aad(vault_key, local_json.as_bytes(), &aad)?;
    let total = vault_row_bytes(
        &ciphertext,
        &vault_meta.verifier,
        &vault_meta.kdf_salt,
        vault_meta.recovery_envelope.as_deref(),
    );
    ensure_vault_within_limit(limit_bytes, total)?;
    if update_vault(state, expected, new_version, &ciphertext, vault_meta).await? {
        Ok(Some(new_version))
    } else {
        Ok(None)
    }
}

fn parse_backup_json(json: &str) -> anyhow::Result<AzaleaBackup> {
    serde_json::from_str(json).map_err(|_| anyhow::anyhow!("Unrecognized vault format"))
}

async fn remote_backup(
    state: &SyncState,
    vault_key: &VaultKey,
    vault: &VaultRow,
) -> anyhow::Result<AzaleaBackup> {
    let account_id = require_account_id(state)?;
    let aad = crypto::vault_aad(&account_id, vault.version, &vault.kdf_salt);
    // decrypt_with_aad falls back to legacy V1 blobs (no AAD) when the caller
    // passes an empty aad. We deliberately pass real AAD here so any V2 blob
    // whose version/account/salt was tampered with fails to decrypt.
    let plaintext = crypto::decrypt_with_aad(vault_key, &vault.ciphertext, &aad).or_else(|_| {
        // Backward compat: older vaults may still be V1. Fall back to legacy
        // path so users don't get stuck after upgrading. Any subsequent push
        // will rewrite the blob as V2 with AAD binding.
        crypto::decrypt(vault_key, &vault.ciphertext)
    })?;
    let json = String::from_utf8(plaintext).map_err(|_| anyhow::anyhow!("Corrupted vault payload"))?;
    parse_backup_json(&json)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum SyncPreview {
    NeedsSetup,
    Locked,
    InSync { version: i64 },
    Push {
        remote_version: i64,
        local: diff::VaultDiff,
    },
    Pull {
        remote_version: i64,
        remote: diff::VaultDiff,
    },
    Conflict {
        remote_version: i64,
        local: diff::VaultDiff,
        remote: diff::VaultDiff,
    },
}

pub async fn preview_sync(
    state: &mut SyncState,
    db: &SharedDatabase,
    settings: Option<Value>,
) -> anyhow::Result<SyncPreview> {
    ensure_session(state).await?;

    let Some(vault) = fetch_vault(state).await? else {
        return Ok(SyncPreview::NeedsSetup);
    };

    let Some(vault_key) = state.vault_key else {
        return Ok(SyncPreview::Locked);
    };

    let (local_json, fingerprint) = local_vault_json(db, settings.clone())?;
    let local_backup = parse_backup_json(&local_json)?;
    let remote_backup = remote_backup(state, &vault_key, &vault).await?;

    let (last_version, last_hash) = synced_meta(db);
    let dirty = last_hash.as_deref() != Some(fingerprint.as_str());
    let local_diff = diff::local_side_diff(&local_backup, &remote_backup);
    let remote_diff = diff::remote_side_diff(&local_backup, &remote_backup);

    if vault.version <= last_version {
        if !dirty {
            return Ok(SyncPreview::InSync { version: vault.version });
        }
        if local_diff.is_empty() {
            return Ok(SyncPreview::InSync { version: vault.version });
        }
        return Ok(SyncPreview::Push {
            remote_version: vault.version,
            local: local_diff,
        });
    }

    if !dirty || local_diff.is_empty() && remote_diff.is_empty() {
        if remote_diff.is_empty() {
            return Ok(SyncPreview::InSync { version: vault.version });
        }
        return Ok(SyncPreview::Pull {
            remote_version: vault.version,
            remote: remote_diff,
        });
    }

    Ok(SyncPreview::Conflict {
        remote_version: vault.version,
        local: local_diff,
        remote: remote_diff,
    })
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
    let plan = fetch_account_plan(state).await;

    if vault.version <= last_version {
        // We are up to date with (or ahead of) the remote.
        if !dirty {
            return Ok(SyncOutcome::InSync { version: vault.version });
        }
        let local_backup = parse_backup_json(&local_json)?;
        let remote_backup = remote_backup(state, &vault_key, &vault).await?;
        if diff::diff_backups(&local_backup, &remote_backup).is_empty() {
            set_synced_meta(db, vault.version, settings.as_ref())?;
            return Ok(SyncOutcome::InSync { version: vault.version });
        }
        match push_local(
            state,
            &vault_key,
            &local_json,
            vault.version,
            &vault,
            plan.limit_bytes,
        )
        .await? {
            Some(new_version) => {
                set_synced_meta(db, new_version, settings.as_ref())?;
                Ok(SyncOutcome::Pushed { version: new_version })
            }
            None => Ok(SyncOutcome::Conflict { remote_version: vault.version }),
        }
    } else {
        // Remote moved ahead of us - never pull without explicit user choice.
        if resolution == Some("keep_cloud") {
            // Refuse to accept a server-provided ciphertext whose version
            // does not strictly exceed our last-synced version. A hostile /
            // rolled-back server otherwise could feed us an older-but-still-
            // valid vault and silently downgrade the client.
            if vault.version <= last_version {
                anyhow::bail!(
                    "Server returned an older vault (v{} <= v{}). Refusing to roll back.",
                    vault.version,
                    last_version,
                );
            }
            let account_id = require_account_id(state)?;
            let aad = crypto::vault_aad(&account_id, vault.version, &vault.kdf_salt);
            let plaintext = crypto::decrypt_with_aad(&vault_key, &vault.ciphertext, &aad)
                .or_else(|_| crypto::decrypt(&vault_key, &vault.ciphertext))?;
            let settings = apply_remote_vault(db, &plaintext)?;
            set_synced_meta(db, vault.version, settings.as_ref())?;
            return Ok(SyncOutcome::Pulled { version: vault.version, settings });
        }
        if resolution == Some("keep_local") {
            return match push_local(
                state,
                &vault_key,
                &local_json,
                vault.version,
                &vault,
                plan.limit_bytes,
            )
            .await? {
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
    pub auth_disconnected: bool,
    pub email: Option<String>,
    pub unlocked: bool,
    pub vault_exists: Option<bool>,
    pub remote_version: Option<i64>,
    pub last_synced_version: i64,
    pub plan: String,
    pub role: String,
    pub storage_limit_bytes: i64,
    pub cloud_used_bytes: i64,
    pub local_estimated_bytes: Option<i64>,
    pub storage_blocked: bool,
}

pub async fn status(state: &mut SyncState, db: &SharedDatabase) -> SyncStatus {
    let configured = api_configured(state);
    let mut logged_in = false;
    let mut session_ok = false;
    let mut auth_disconnected = false;

    if configured {
        match ensure_session(state).await {
            Ok(()) => {
                logged_in = true;
                session_ok = true;
                auth_disconnected = false;
            }
            Err(_) => {
                auth_disconnected = is_auth_disconnected(state);
                // Network / temporary failures: keep showing signed-in if refresh
                // token is still on disk. Hard auth rejects clear the keyring above.
                logged_in = has_persisted_login(state) && !auth_disconnected;
                session_ok = false;
            }
        }
    }

    let mut vault_row: Option<VaultRow> = None;
    let (vault_exists, remote_version) = if session_ok {
        match fetch_vault(state).await {
            Ok(Some(vault)) => {
                vault_row = Some(vault.clone());
                (Some(true), Some(vault.version))
            }
            Ok(None) => (Some(false), None),
            Err(_) => (None, None),
        }
    } else {
        (None, None)
    };

    let plan = if session_ok {
        fetch_account_plan(state).await
    } else {
        AccountPlanRow::default()
    };

    let mut local_estimated_bytes = None;
    let mut storage_blocked = false;

    if session_ok && state.is_unlocked() {
        if let Some(vault_key) = state.vault_key.as_ref() {
            if let Ok((local_json, _)) = local_vault_json(db, None) {
                // Size estimate: AAD doesn't affect ciphertext length, and the
                // 1-byte V2 version prefix is negligible. Use empty AAD to
                // avoid pulling account_id here (this path may run before
                // a successful sync).
                if let Ok(ciphertext) = crypto::encrypt(vault_key, local_json.as_bytes()) {
                    if let Some(vault) = vault_row.as_ref() {
                        let total = vault_row_bytes(
                            &ciphertext,
                            &vault.verifier,
                            &vault.kdf_salt,
                            vault.recovery_envelope.as_deref(),
                        );
                        local_estimated_bytes = Some(total);
                        storage_blocked = total > plan.limit_bytes;
                    }
                }
            }
        }
    }

    let (last_version, _) = synced_meta(db);

    let email = if logged_in || auth_disconnected {
        state.email()
    } else {
        None
    };

    SyncStatus {
        configured,
        logged_in,
        auth_disconnected,
        email,
        unlocked: state.is_unlocked(),
        vault_exists,
        remote_version,
        last_synced_version: last_version,
        plan: plan.plan,
        role: plan.role,
        storage_limit_bytes: plan.limit_bytes,
        cloud_used_bytes: plan.used_bytes,
        local_estimated_bytes,
        storage_blocked,
    }
}
