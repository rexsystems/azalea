use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AccountKind {
    Cloud,
    Selfhost,
    Offline,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountRecord {
    pub id: String,
    pub kind: AccountKind,
    pub label: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub web_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AccountsFile {
    active_id: String,
    accounts: Vec<AccountRecord>,
    #[serde(default)]
    onboarded: bool,
}

pub struct AccountRegistry {
    path: PathBuf,
    data: AccountsFile,
}

fn app_data_dir(app: &AppHandle) -> anyhow::Result<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|e| anyhow::anyhow!(e.to_string()))
}

fn registry_path(app: &AppHandle) -> anyhow::Result<PathBuf> {
    Ok(app_data_dir(app)?.join("accounts.json"))
}

/// Reject anything that could climb out of `<app_data>/accounts/`. Account
/// ids we create ourselves are always UUIDs, so this allowlist is safe.
///
/// Without this guard, `id = "../.."` would let `remove_account` (which
/// unconditionally `fs::remove_dir_all`s the parent of the returned path)
/// delete arbitrary directories on the user's machine.
pub fn valid_account_id(id: &str) -> bool {
    let trimmed = id.trim();
    if trimmed.len() < 16 || trimmed.len() > 64 {
        return false;
    }
    trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-')
}

pub fn account_db_path(app: &AppHandle, account_id: &str) -> anyhow::Result<PathBuf> {
    if !valid_account_id(account_id) {
        anyhow::bail!("invalid account id");
    }
    Ok(app_data_dir(app)?
        .join("accounts")
        .join(account_id)
        .join("azalea.db"))
}

impl AccountRegistry {
    pub fn load_or_init(app: &AppHandle) -> anyhow::Result<Self> {
        let path = registry_path(app)?;
        let legacy_db = app_data_dir(app)?.join("azalea.db");

        if path.exists() {
            let raw = fs::read_to_string(&path)?;
            let data: AccountsFile = serde_json::from_str(&raw)?;
            return Ok(Self { path, data });
        }

        let id = Uuid::new_v4().to_string();
        let account = AccountRecord {
            id: id.clone(),
            kind: AccountKind::Offline,
            label: "Local".to_string(),
            base_url: None,
            email: None,
            web_url: None,
        };

        let account_dir = app_data_dir(app)?.join("accounts").join(&id);
        fs::create_dir_all(&account_dir)?;
        let new_db = account_dir.join("azalea.db");
        if legacy_db.exists() && !new_db.exists() {
            fs::rename(&legacy_db, &new_db)?;
        }

        let data = AccountsFile {
            active_id: id,
            accounts: vec![account],
            onboarded: false,
        };
        let reg = Self { path, data };
        reg.save()?;
        Ok(reg)
    }

    pub fn save(&self) -> anyhow::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let raw = serde_json::to_string_pretty(&self.data)?;
        fs::write(&self.path, raw)?;
        Ok(())
    }

    pub fn active(&self) -> Option<&AccountRecord> {
        self.data
            .accounts
            .iter()
            .find(|a| a.id == self.data.active_id)
    }

    pub fn active_id(&self) -> &str {
        &self.data.active_id
    }

    pub fn onboarded(&self) -> bool {
        self.data.onboarded
    }

    pub fn set_onboarded(&mut self, onboarded: bool) -> anyhow::Result<()> {
        self.data.onboarded = onboarded;
        self.save()
    }

    pub fn list(&self) -> &[AccountRecord] {
        &self.data.accounts
    }

    pub fn switch(&mut self, id: &str) -> anyhow::Result<&AccountRecord> {
        if !valid_account_id(id) {
            anyhow::bail!("invalid account id");
        }
        if !self.data.accounts.iter().any(|a| a.id == id) {
            anyhow::bail!("Account not found");
        }
        self.data.active_id = id.to_string();
        self.save()?;
        self.active()
            .ok_or_else(|| anyhow::anyhow!("Account not found"))
    }

    pub fn upsert(&mut self, account: AccountRecord) -> anyhow::Result<()> {
        if let Some(existing) = self.data.accounts.iter_mut().find(|a| a.id == account.id) {
            *existing = account;
        } else {
            self.data.accounts.push(account);
        }
        self.save()
    }

    pub fn add(
        &mut self,
        kind: AccountKind,
        label: String,
        base_url: Option<String>,
        web_url: Option<String>,
    ) -> anyhow::Result<AccountRecord> {
        let id = Uuid::new_v4().to_string();
        let account = AccountRecord {
            id: id.clone(),
            kind,
            label,
            base_url,
            email: None,
            web_url,
        };
        self.data.accounts.push(account.clone());
        self.data.active_id = id;
        self.save()?;
        Ok(account)
    }

    pub fn remove(&mut self, id: &str) -> anyhow::Result<()> {
        if !valid_account_id(id) {
            anyhow::bail!("invalid account id");
        }
        if self.data.accounts.len() <= 1 {
            anyhow::bail!("Cannot remove the last account");
        }
        if self
            .data
            .accounts
            .iter()
            .any(|a| a.id == id && a.kind == AccountKind::Offline)
        {
            anyhow::bail!("Local profile cannot be removed");
        }
        let before = self.data.accounts.len();
        self.data.accounts.retain(|a| a.id != id);
        if self.data.accounts.len() == before {
            // Previously this silently returned Ok, so a malicious id would
            // reach the caller which then unconditionally tried to delete the
            // computed account directory. Explicit error keeps `remove_account`
            // honest.
            anyhow::bail!("Account not found");
        }
        if self.data.active_id == id {
            self.data.active_id = self.data.accounts[0].id.clone();
        }
        self.save()
    }

    pub fn set_email(&mut self, id: &str, email: Option<String>) -> anyhow::Result<()> {
        if !valid_account_id(id) {
            anyhow::bail!("invalid account id");
        }
        if let Some(account) = self.data.accounts.iter_mut().find(|a| a.id == id) {
            account.email = email;
        }
        self.save()
    }

    pub fn set_label(&mut self, id: &str, label: String) -> anyhow::Result<()> {
        if !valid_account_id(id) {
            anyhow::bail!("invalid account id");
        }
        if let Some(account) = self.data.accounts.iter_mut().find(|a| a.id == id) {
            let trimmed = label.trim();
            if !trimmed.is_empty() {
                account.label = trimmed.to_string();
            }
        }
        self.save()
    }
}
