use serde_json::Value;

use super::super::store::{VaultBlob, VAULT_FILE_NAME};
use super::{PersonalProvider, TokenSet};

const AUTH_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH: &str = "https://graph.microsoft.com/v1.0";
const SCOPE: &str = "offline_access User.Read Files.ReadWrite.AppFolder";

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

pub fn authorize_url(
    redirect_uri: &str,
    state: &str,
    code_challenge: &str,
) -> anyhow::Result<String> {
    let client_id = PersonalProvider::OneDrive.client_id()?;
    Ok(format!(
        "{AUTH_URL}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&code_challenge={}&code_challenge_method=S256",
        urlencoding(&client_id),
        urlencoding(redirect_uri),
        urlencoding(SCOPE),
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
        .unwrap_or(3600);
    Ok((access, refresh, expires_in))
}

async fn fetch_profile(
    http: &reqwest::Client,
    access_token: &str,
) -> anyhow::Result<(String, Option<String>)> {
    let resp = http
        .get(format!("{GRAPH}/me?$select=id,mail,userPrincipalName"))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("Network error: {e}"))?;
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    let id = body
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("Missing Microsoft user id"))?
        .to_string();
    let email = body
        .get("mail")
        .and_then(|v| v.as_str())
        .or_else(|| body.get("userPrincipalName").and_then(|v| v.as_str()))
        .map(str::to_string);
    Ok((id, email))
}

pub async fn exchange_code(
    http: &reqwest::Client,
    code: &str,
    redirect_uri: &str,
    code_verifier: &str,
) -> anyhow::Result<TokenSet> {
    let client_id = PersonalProvider::OneDrive.client_id()?;
    let (access, refresh, expires_in) = token_request(
        http,
        &[
            ("client_id", client_id.as_str()),
            ("code", code),
            ("code_verifier", code_verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri),
            ("scope", SCOPE),
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
    let client_id = PersonalProvider::OneDrive.client_id()?;
    let (access, new_refresh, expires_in) = token_request(
        http,
        &[
            ("client_id", client_id.as_str()),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
            ("scope", SCOPE),
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

fn vault_item_url() -> String {
    format!("{GRAPH}/me/drive/special/approot:/{VAULT_FILE_NAME}")
}

pub async fn fetch_vault(
    http: &reqwest::Client,
    access_token: &str,
) -> anyhow::Result<Option<VaultBlob>> {
    let meta = http
        .get(format!(
            "{}?$select=id,eTag,@microsoft.graph.downloadUrl",
            vault_item_url()
        ))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("Network error: {e}"))?;
    if meta.status().as_u16() == 404 {
        return Ok(None);
    }
    if !meta.status().is_success() {
        // Approot may not exist yet → treat as empty
        if meta.status().as_u16() == 404 || meta.status().as_u16() == 400 {
            return Ok(None);
        }
        anyhow::bail!("Could not read OneDrive vault metadata");
    }
    let body: Value = meta.json().await.unwrap_or(Value::Null);
    let etag = body
        .get("eTag")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let download = body
        .get("@microsoft.graph.downloadUrl")
        .and_then(|v| v.as_str())
        .map(str::to_string);

    let content_resp = if let Some(url) = download {
        http.get(url).send().await
    } else {
        http.get(format!("{}/content", vault_item_url()))
            .bearer_auth(access_token)
            .send()
            .await
    }
    .map_err(|e| anyhow::anyhow!("Network error: {e}"))?;

    if content_resp.status().as_u16() == 404 {
        return Ok(None);
    }
    if !content_resp.status().is_success() {
        anyhow::bail!("Could not download vault from OneDrive");
    }
    let mut blob: VaultBlob = content_resp
        .json()
        .await
        .map_err(|_| anyhow::anyhow!("Corrupt vault file on OneDrive"))?;
    blob.revision = etag;
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

    let body_json = serde_json::to_vec(blob)?;
    let mut req = http
        .put(format!("{}/content", vault_item_url()))
        .bearer_auth(access_token)
        .header("Content-Type", "application/json")
        .body(body_json);
    if expected_version > 0 {
        if let Some(etag) = prior_revision {
            req = req.header("If-Match", etag);
        }
    } else {
        // Create only if missing
        req = req.header("If-None-Match", "*");
    }
    let resp = req
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("Network error: {e}"))?;
    let code = resp.status().as_u16();
    if code == 412 || code == 409 {
        anyhow::bail!("version_conflict");
    }
    if !resp.status().is_success() {
        let err_body = resp.text().await.unwrap_or_default();
        anyhow::bail!("Could not save vault to OneDrive: {err_body}");
    }
    let etag = resp
        .headers()
        .get("etag")
        .or_else(|| resp.headers().get("ETag"))
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    Ok((blob.version, etag))
}
