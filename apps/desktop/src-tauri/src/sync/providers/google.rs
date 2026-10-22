use serde::Deserialize;
use serde_json::{json, Value};

use super::super::store::{VaultBlob, VAULT_FILE_NAME};
use super::{PersonalProvider, TokenSet};

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const USERINFO_URL: &str = "https://www.googleapis.com/oauth2/v3/userinfo";
const DRIVE_FILES: &str = "https://www.googleapis.com/drive/v3/files";
const SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata openid email profile";

fn desktop_client_secret() -> Option<String> {
    std::env::var("AZALEA_GOOGLE_CLIENT_SECRET")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            option_env!("AZALEA_GOOGLE_CLIENT_SECRET")
                .filter(|value| !value.trim().is_empty())
                .map(str::to_owned)
        })
}

pub fn authorize_url(
    redirect_uri: &str,
    state: &str,
    code_challenge: &str,
) -> anyhow::Result<String> {
    let client_id = PersonalProvider::GoogleDrive.client_id()?;
    Ok(format!(
        "{AUTH_URL}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=consent",
        urlencoding(&client_id),
        urlencoding(redirect_uri),
        urlencoding(SCOPE),
        urlencoding(state),
        urlencoding(code_challenge),
    ))
}

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

async fn token_request(
    http: &reqwest::Client,
    form: &[(&str, &str)],
) -> anyhow::Result<(String, Option<String>, i64)> {
    let secret = desktop_client_secret();
    let mut form = form.to_vec();
    if let Some(secret) = secret.as_deref() {
        form.push(("client_secret", secret));
    }
    let resp = http
        .post(TOKEN_URL)
        .form(&form)
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
        .get(USERINFO_URL)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("Network error: {e}"))?;
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    let id = body
        .get("sub")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("Missing Google user id"))?
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
    let client_id = PersonalProvider::GoogleDrive.client_id()?;
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
    let client_id = PersonalProvider::GoogleDrive.client_id()?;
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

#[derive(Deserialize)]
struct FileList {
    #[serde(default)]
    files: Vec<DriveFile>,
}

#[derive(Deserialize)]
struct DriveFile {
    id: String,
}

async fn find_vault_file_id(
    http: &reqwest::Client,
    access_token: &str,
) -> anyhow::Result<Option<(String, Option<String>)>> {
    let q =
        format!("name = '{VAULT_FILE_NAME}' and 'appDataFolder' in parents and trashed = false");
    let url = format!(
        "{DRIVE_FILES}?spaces=appDataFolder&fields=files(id,md5Checksum)&q={}",
        urlencoding(&q)
    );
    let resp = http
        .get(&url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("Network error: {e}"))?;
    if !resp.status().is_success() {
        anyhow::bail!("Could not list Google Drive app data");
    }
    let list: FileList = resp.json().await.unwrap_or(FileList { files: vec![] });
    let Some(file) = list.files.into_iter().next() else {
        return Ok(None);
    };
    // Fetch metadata for etag via get
    let meta = http
        .get(format!("{DRIVE_FILES}/{}?fields=id,md5Checksum", file.id))
        .bearer_auth(access_token)
        .header("Authorization", format!("Bearer {access_token}"))
        .send()
        .await?;
    let etag = meta
        .headers()
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim_matches('"').to_string());
    Ok(Some((file.id, etag)))
}

pub async fn fetch_vault(
    http: &reqwest::Client,
    access_token: &str,
) -> anyhow::Result<Option<VaultBlob>> {
    let Some((file_id, revision)) = find_vault_file_id(http, access_token).await? else {
        return Ok(None);
    };
    let resp = http
        .get(format!("{DRIVE_FILES}/{file_id}?alt=media"))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("Network error: {e}"))?;
    if !resp.status().is_success() {
        anyhow::bail!("Could not download vault from Google Drive");
    }
    let mut blob: VaultBlob = resp
        .json()
        .await
        .map_err(|_| anyhow::anyhow!("Corrupt vault file on Google Drive"))?;
    blob.revision = revision;
    Ok(Some(blob))
}

pub async fn put_vault(
    http: &reqwest::Client,
    access_token: &str,
    expected_version: i64,
    blob: &VaultBlob,
    prior_revision: Option<&str>,
) -> anyhow::Result<(i64, Option<String>)> {
    let existing = find_vault_file_id(http, access_token).await?;
    if expected_version == 0 {
        if existing.is_some() {
            anyhow::bail!("version_conflict");
        }
        let metadata = json!({
            "name": VAULT_FILE_NAME,
            "parents": ["appDataFolder"],
        });
        let boundary = "azalea_boundary";
        let body_json = serde_json::to_string(blob)?;
        let multipart = format!(
            "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n\
             --{boundary}\r\nContent-Type: application/json\r\n\r\n{body_json}\r\n\
             --{boundary}--"
        );
        let resp = http
            .post("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart")
            .bearer_auth(access_token)
            .header(
                "Content-Type",
                format!("multipart/related; boundary={boundary}"),
            )
            .body(multipart)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("Network error: {e}"))?;
        if !resp.status().is_success() {
            anyhow::bail!("Could not create vault on Google Drive");
        }
        let etag = resp
            .headers()
            .get("etag")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.trim_matches('"').to_string());
        return Ok((blob.version, etag));
    }

    let Some((file_id, _)) = existing else {
        anyhow::bail!("version_conflict");
    };
    // Soft check: download current version if we have no etag confidence
    if let Some(current) = fetch_vault(http, access_token).await? {
        if current.version != expected_version {
            anyhow::bail!("version_conflict");
        }
    }
    let body_json = serde_json::to_string(blob)?;
    let mut req = http
        .patch(format!(
            "https://www.googleapis.com/upload/drive/v3/files/{file_id}?uploadType=media"
        ))
        .bearer_auth(access_token)
        .header("Content-Type", "application/json")
        .body(body_json);
    if let Some(etag) = prior_revision {
        req = req.header("If-Match", format!("\"{etag}\""));
    }
    let resp = req
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("Network error: {e}"))?;
    if resp.status().as_u16() == 412 {
        anyhow::bail!("version_conflict");
    }
    if !resp.status().is_success() {
        anyhow::bail!("Could not update vault on Google Drive");
    }
    let etag = resp
        .headers()
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim_matches('"').to_string());
    Ok((blob.version, etag))
}
