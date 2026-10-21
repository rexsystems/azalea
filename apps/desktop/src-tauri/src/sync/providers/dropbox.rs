use serde_json::{json, Value};

use super::super::store::{VaultBlob, VAULT_FILE_NAME};
use super::{PersonalProvider, TokenSet};

const AUTH_URL: &str = "https://www.dropbox.com/oauth2/authorize";
const TOKEN_URL: &str = "https://api.dropboxapi.com/oauth2/token";
const DOWNLOAD_URL: &str = "https://content.dropboxapi.com/2/files/download";
const UPLOAD_URL: &str = "https://content.dropboxapi.com/2/files/upload";
const ACCOUNT_URL: &str = "https://api.dropboxapi.com/2/users/get_current_account";

fn urlencoding(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn vault_path() -> String {
    format!("/{VAULT_FILE_NAME}")
}

pub fn authorize_url(
    redirect_uri: &str,
    state: &str,
    code_challenge: &str,
) -> anyhow::Result<String> {
    let client_id = PersonalProvider::Dropbox.client_id()?;
    Ok(format!(
        "{AUTH_URL}?client_id={}&redirect_uri={}&response_type=code&token_access_type=offline&state={}&code_challenge={}&code_challenge_method=S256",
        urlencoding(&client_id),
        urlencoding(redirect_uri),
        urlencoding(state),
        urlencoding(code_challenge),
    ))
}

async fn token_request(
    http: &reqwest::Client,
    form: &[(&str, &str)],
) -> anyhow::Result<(String, Option<String>, i64)> {
    let resp = http
        .post(TOKEN_URL)
        .form(form)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("Network error: {e}"))?;
    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let msg = body
            .get("error_description")
            .or_else(|| body.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("token exchange failed");
        anyhow::bail!("{msg}");
    }
    let access = body
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("Missing access_token"))?
        .to_string();
    let refresh = body
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let expires_in = body
        .get("expires_in")
        .and_then(|v| v.as_i64())
        .unwrap_or(14_400);
    Ok((access, refresh, expires_in))
}

async fn fetch_profile(
    http: &reqwest::Client,
    access_token: &str,
) -> anyhow::Result<(String, Option<String>)> {
    let resp = http
        .post(ACCOUNT_URL)
        .bearer_auth(access_token)
        .header("Content-Type", "application/json")
        .body("null")
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("Network error: {e}"))?;
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    let id = body
        .get("account_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("Missing Dropbox account id"))?
        .to_string();
    let email = body
        .get("email")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    Ok((id, email))
}

pub async fn exchange_code(
    http: &reqwest::Client,
    code: &str,
    redirect_uri: &str,
    code_verifier: &str,
) -> anyhow::Result<TokenSet> {
    let client_id = PersonalProvider::Dropbox.client_id()?;
    let (access, refresh, expires_in) = token_request(
        http,
        &[
            ("client_id", client_id.as_str()),
            ("code", code),
            ("code_verifier", code_verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri),
        ],
    )
    .await?;
    let (user_id, email) = fetch_profile(http, &access).await?;
    Ok(TokenSet {
        access_token: access,
        refresh_token: refresh,
        expires_in,
        user_id,
        email,
    })
}

pub async fn refresh_access(
    http: &reqwest::Client,
    refresh_token: &str,
) -> anyhow::Result<TokenSet> {
    let client_id = PersonalProvider::Dropbox.client_id()?;
    let (access, new_refresh, expires_in) = token_request(
        http,
        &[
            ("client_id", client_id.as_str()),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ],
    )
    .await?;
    let (user_id, email) = fetch_profile(http, &access).await?;
    Ok(TokenSet {
        access_token: access,
        refresh_token: new_refresh.or_else(|| Some(refresh_token.to_string())),
        expires_in,
        user_id,
        email,
    })
}

pub async fn fetch_vault(
    http: &reqwest::Client,
    access_token: &str,
) -> anyhow::Result<Option<VaultBlob>> {
    let arg = json!({ "path": vault_path() });
    let resp = http
        .post(DOWNLOAD_URL)
        .bearer_auth(access_token)
        .header("Dropbox-API-Arg", arg.to_string())
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("Network error: {e}"))?;
    if resp.status().as_u16() == 409 {
        // path/not_found
        return Ok(None);
    }
    if !resp.status().is_success() {
        anyhow::bail!("Could not download vault from Dropbox");
    }
    let rev = resp
        .headers()
        .get("dropbox-api-result")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| serde_json::from_str::<Value>(s).ok())
        .and_then(|v| v.get("rev").and_then(|r| r.as_str()).map(str::to_string));
    let mut blob: VaultBlob = resp
        .json()
        .await
        .map_err(|_| anyhow::anyhow!("Corrupt vault file on Dropbox"))?;
    blob.revision = rev;
    Ok(Some(blob))
}

pub async fn put_vault(
    http: &reqwest::Client,
    access_token: &str,
    expected_version: i64,
    blob: &VaultBlob,
    prior_revision: Option<&str>,
) -> anyhow::Result<(i64, Option<String>)> {
    if let Some(current) = fetch_vault(http, access_token).await? {
        if current.version != expected_version {
            anyhow::bail!("version_conflict");
        }
    } else if expected_version != 0 {
        anyhow::bail!("version_conflict");
    }

    let mode = if expected_version == 0 {
        json!("add")
    } else if let Some(rev) = prior_revision {
        json!({ ".tag": "update", "update": rev })
    } else {
        json!("overwrite")
    };

    let arg = json!({
        "path": vault_path(),
        "mode": mode,
        "mute": true,
        "strict_conflict": true,
    });
    let body_json = serde_json::to_vec(blob)?;
    let resp = http
        .post(UPLOAD_URL)
        .bearer_auth(access_token)
        .header("Dropbox-API-Arg", arg.to_string())
        .header("Content-Type", "application/octet-stream")
        .body(body_json)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("Network error: {e}"))?;
    if resp.status().as_u16() == 409 {
        anyhow::bail!("version_conflict");
    }
    if !resp.status().is_success() {
        let err = resp.text().await.unwrap_or_default();
        anyhow::bail!("Could not save vault to Dropbox: {err}");
    }
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    let rev = body.get("rev").and_then(|v| v.as_str()).map(str::to_string);
    Ok((blob.version, rev))
}
