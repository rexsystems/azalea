pub mod dropbox;
pub mod google;
pub mod oauth;
pub mod onedrive;

use crate::store::accounts::AccountKind;

use super::store::VaultBlob;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PersonalProvider {
    GoogleDrive,
    OneDrive,
    Dropbox,
}

impl PersonalProvider {
    pub fn from_kind(kind: &AccountKind) -> Option<Self> {
        match kind {
            AccountKind::Gdrive => Some(Self::GoogleDrive),
            AccountKind::Onedrive => Some(Self::OneDrive),
            AccountKind::Dropbox => Some(Self::Dropbox),
            _ => None,
        }
    }

    pub fn kind(self) -> AccountKind {
        match self {
            Self::GoogleDrive => AccountKind::Gdrive,
            Self::OneDrive => AccountKind::Onedrive,
            Self::Dropbox => AccountKind::Dropbox,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::GoogleDrive => "Google Drive",
            Self::OneDrive => "OneDrive",
            Self::Dropbox => "Dropbox",
        }
    }

    pub fn client_id(self) -> anyhow::Result<String> {
        let (env_key, bake_key) = match self {
            Self::GoogleDrive => (
                "AZALEA_GOOGLE_CLIENT_ID",
                option_env!("AZALEA_GOOGLE_CLIENT_ID"),
            ),
            Self::OneDrive => (
                "AZALEA_MICROSOFT_CLIENT_ID",
                option_env!("AZALEA_MICROSOFT_CLIENT_ID"),
            ),
            Self::Dropbox => (
                "AZALEA_DROPBOX_CLIENT_ID",
                option_env!("AZALEA_DROPBOX_CLIENT_ID"),
            ),
        };
        std::env::var(env_key)
            .ok()
            .filter(|v| !v.trim().is_empty())
            .or_else(|| bake_key.map(str::to_string).filter(|v| !v.trim().is_empty()))
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "{} sign-in is unavailable in this build because the app's OAuth client ID is missing. Your local profile has not changed. Use a build with {} sign-in configured.",
                    self.label(),
                    self.label()
                )
            })
    }
}

pub struct TokenSet {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: i64,
    pub user_id: String,
    pub email: Option<String>,
}

pub async fn fetch_vault(
    provider: PersonalProvider,
    http: &reqwest::Client,
    access_token: &str,
) -> anyhow::Result<Option<VaultBlob>> {
    match provider {
        PersonalProvider::GoogleDrive => google::fetch_vault(http, access_token).await,
        PersonalProvider::OneDrive => onedrive::fetch_vault(http, access_token).await,
        PersonalProvider::Dropbox => dropbox::fetch_vault(http, access_token).await,
    }
}

pub async fn put_vault(
    provider: PersonalProvider,
    http: &reqwest::Client,
    access_token: &str,
    expected_version: i64,
    blob: &VaultBlob,
    prior_revision: Option<&str>,
) -> anyhow::Result<(i64, Option<String>)> {
    match provider {
        PersonalProvider::GoogleDrive => {
            google::put_vault(http, access_token, expected_version, blob, prior_revision).await
        }
        PersonalProvider::OneDrive => {
            onedrive::put_vault(http, access_token, expected_version, blob, prior_revision).await
        }
        PersonalProvider::Dropbox => {
            dropbox::put_vault(http, access_token, expected_version, blob, prior_revision).await
        }
    }
}

pub async fn refresh_token(
    provider: PersonalProvider,
    http: &reqwest::Client,
    refresh_token: &str,
) -> anyhow::Result<TokenSet> {
    match provider {
        PersonalProvider::GoogleDrive => google::refresh_access(http, refresh_token).await,
        PersonalProvider::OneDrive => onedrive::refresh_access(http, refresh_token).await,
        PersonalProvider::Dropbox => dropbox::refresh_access(http, refresh_token).await,
    }
}

pub async fn exchange_code(
    provider: PersonalProvider,
    http: &reqwest::Client,
    code: &str,
    redirect_uri: &str,
    code_verifier: &str,
) -> anyhow::Result<TokenSet> {
    match provider {
        PersonalProvider::GoogleDrive => {
            google::exchange_code(http, code, redirect_uri, code_verifier).await
        }
        PersonalProvider::OneDrive => {
            onedrive::exchange_code(http, code, redirect_uri, code_verifier).await
        }
        PersonalProvider::Dropbox => {
            dropbox::exchange_code(http, code, redirect_uri, code_verifier).await
        }
    }
}

pub fn authorize_url(
    provider: PersonalProvider,
    redirect_uri: &str,
    state: &str,
    code_challenge: &str,
) -> anyhow::Result<String> {
    match provider {
        PersonalProvider::GoogleDrive => google::authorize_url(redirect_uri, state, code_challenge),
        PersonalProvider::OneDrive => onedrive::authorize_url(redirect_uri, state, code_challenge),
        PersonalProvider::Dropbox => dropbox::authorize_url(redirect_uri, state, code_challenge),
    }
}
