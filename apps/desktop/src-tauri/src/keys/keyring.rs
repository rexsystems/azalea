use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::Manager;

const SERVICE_NAME: &str = "azalea";
static KEYS_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn init_storage(app: &tauri::AppHandle) -> anyhow::Result<()> {
    let dir = app.path().app_data_dir()?.join("keys");
    std::fs::create_dir_all(&dir)?;
    KEYS_DIR
        .set(dir)
        .map_err(|_| anyhow::anyhow!("keys storage already initialized"))?;
    Ok(())
}

fn keys_dir() -> anyhow::Result<&'static Path> {
    KEYS_DIR
        .get()
        .map(PathBuf::as_path)
        .ok_or_else(|| anyhow::anyhow!("keys storage not initialized"))
}

fn key_file_path(key_id: &str) -> anyhow::Result<PathBuf> {
    Ok(keys_dir()?.join(format!("{key_id}.pem")))
}

fn get_private_key_keyring(key_id: &str) -> anyhow::Result<Option<String>> {
    let entry = keyring::Entry::new(SERVICE_NAME, &format!("ssh-key-{key_id}"))?;
    match entry.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.into()),
    }
}

fn delete_private_key_keyring(key_id: &str) -> anyhow::Result<()> {
    let entry = keyring::Entry::new(SERVICE_NAME, &format!("ssh-key-{key_id}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.into()),
    }
}

pub fn store_host_password(host_id: &str, password: &str) -> anyhow::Result<()> {
    let entry = keyring::Entry::new(SERVICE_NAME, &format!("host-password-{host_id}"))?;
    entry.set_password(password)?;
    Ok(())
}

pub fn get_host_password(host_id: &str) -> anyhow::Result<Option<String>> {
    let entry = keyring::Entry::new(SERVICE_NAME, &format!("host-password-{host_id}"))?;
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.into()),
    }
}

pub fn delete_host_password(host_id: &str) -> anyhow::Result<()> {
    let entry = keyring::Entry::new(SERVICE_NAME, &format!("host-password-{host_id}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.into()),
    }
}

pub fn store_private_key(key_id: &str, private_key_pem: &str) -> anyhow::Result<()> {
    let path = key_file_path(key_id)?;
    std::fs::write(&path, private_key_pem)?;
    let _ = delete_private_key_keyring(key_id);
    Ok(())
}

pub fn get_private_key(key_id: &str) -> anyhow::Result<Option<String>> {
    let path = key_file_path(key_id)?;
    if path.exists() {
        return Ok(Some(std::fs::read_to_string(path)?));
    }

    if let Some(pem) = get_private_key_keyring(key_id)? {
        let _ = store_private_key(key_id, &pem);
        return Ok(Some(pem));
    }

    Ok(None)
}

pub fn delete_private_key(key_id: &str) -> anyhow::Result<()> {
    let path = key_file_path(key_id)?;
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    delete_private_key_keyring(key_id)
}
