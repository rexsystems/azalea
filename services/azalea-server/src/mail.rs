use std::env;

use serde_json::json;

use crate::error::{ApiError, ApiResult};

pub struct MailConfig {
    pub api_key: String,
    pub from: String,
    pub public_web_url: String,
}

impl MailConfig {
    pub fn from_env() -> Option<Self> {
        let api_key = env::var("RESEND_API_KEY").ok().filter(|v| !v.trim().is_empty())?;
        let from = env::var("AZALEA_MAIL_FROM")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| "Azalea <onboarding@resend.dev>".into());
        let public_web_url = env::var("AZALEA_PUBLIC_WEB_URL")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| "http://localhost:3000".into());
        Some(Self {
            api_key,
            from,
            public_web_url: public_web_url.trim_end_matches('/').to_string(),
        })
    }
}

pub async fn send_password_reset(
    mail: &MailConfig,
    to_email: &str,
    token: &str,
) -> ApiResult<()> {
    let reset_url = format!(
        "{}/reset-password?token={}",
        mail.public_web_url,
        urlencoding_minimal(token)
    );
    let html = format!(
        "<p>Reset your Azalea password:</p><p><a href=\"{reset_url}\">{reset_url}</a></p><p>This link expires in 1 hour.</p>"
    );

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.resend.com/emails")
        .bearer_auth(&mail.api_key)
        .json(&json!({
            "from": mail.from,
            "to": [to_email],
            "subject": "Reset your Azalea password",
            "html": html,
        }))
        .send()
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("mail send failed: {e}")))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        tracing::error!(%body, "resend failed");
        return Err(ApiError::Internal(anyhow::anyhow!("Could not send email")));
    }
    Ok(())
}

fn urlencoding_minimal(value: &str) -> String {
    // tokens are hex; keep simple
    value.to_string()
}
