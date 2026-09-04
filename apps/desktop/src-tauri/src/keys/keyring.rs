use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::Manager;

use crate::sync::crypto::{decrypt, encrypt, VaultKey, KEY_LEN};

const SERVICE_NAME: &str = "azalea";
static KEYS_DIR: OnceLock<PathBuf> = OnceLock::new();
static PASSWORDS_DIR: OnceLock<PathBuf> = OnceLock::new();
static FALLBACK_KEY: OnceLock<VaultKey> = OnceLock::new();

pub fn init_storage(app: &tauri::AppHandle) -> anyhow::Result<()> {
    let data_dir = app.path().app_data_dir()?;
    let keys_dir = data_dir.join("keys");
    let passwords_dir = data_dir.join("passwords");
    std::fs::create_dir_all(&keys_dir)?;
    std::fs::create_dir_all(&passwords_dir)?;
    KEYS_DIR
        .set(keys_dir)
        .map_err(|_| anyhow::anyhow!("keys storage already initialized"))?;
    PASSWORDS_DIR
        .set(passwords_dir)
        .map_err(|_| anyhow::anyhow!("password storage already initialized"))?;

    let fallback_key = load_or_create_fallback_key(&data_dir)?;
    FALLBACK_KEY
        .set(fallback_key)
        .map_err(|_| anyhow::anyhow!("fallback key already initialized"))?;
    Ok(())
}

fn keys_dir() -> anyhow::Result<&'static Path> {
    KEYS_DIR
        .get()
        .map(PathBuf::as_path)
        .ok_or_else(|| anyhow::anyhow!("keys storage not initialized"))
}

fn passwords_dir() -> anyhow::Result<&'static Path> {
    PASSWORDS_DIR
        .get()
        .map(PathBuf::as_path)
        .ok_or_else(|| anyhow::anyhow!("password storage not initialized"))
}

/// IDs end up as path segments, so anything that could escape the storage
/// directory (`..`, separators, NUL) has to be rejected before the join.
fn safe_id(id: &str) -> anyhow::Result<&str> {
    let valid = !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !valid {
        anyhow::bail!("Invalid identifier");
    }
    Ok(id)
}

fn key_file_path(key_id: &str) -> anyhow::Result<PathBuf> {
    Ok(keys_dir()?.join(format!("{}.enc", safe_id(key_id)?)))
}

fn legacy_key_file_path(key_id: &str) -> anyhow::Result<PathBuf> {
    Ok(keys_dir()?.join(format!("{}.pem", safe_id(key_id)?)))
}

fn host_password_path(host_id: &str) -> anyhow::Result<PathBuf> {
    Ok(passwords_dir()?.join(format!("{}.enc", safe_id(host_id)?)))
}

fn legacy_host_password_path(host_id: &str) -> anyhow::Result<PathBuf> {
    Ok(passwords_dir()?.join(safe_id(host_id)?))
}

fn restrict_private_file(path: &Path) -> anyhow::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

/// Local key used only when the OS keychain is unavailable (headless Linux, no
/// Secret Service daemon). Encrypting with it keeps secrets off disk in the
/// clear; it is not a substitute for the keychain.
fn load_or_create_fallback_key(data_dir: &Path) -> anyhow::Result<VaultKey> {
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;

    let path = data_dir.join("storage.key");
    if path.exists() {
        let encoded = std::fs::read_to_string(&path)?;
        if let Ok(bytes) = B64.decode(encoded.trim()) {
            if bytes.len() == KEY_LEN {
                let mut key = [0u8; KEY_LEN];
                key.copy_from_slice(&bytes);
                return Ok(key);
            }
        }
    }

    let key = crate::sync::crypto::generate_key();
    std::fs::write(&path, B64.encode(key))?;
    restrict_private_file(&path)?;
    Ok(key)
}

fn fallback_key() -> anyhow::Result<&'static VaultKey> {
    FALLBACK_KEY
        .get()
        .ok_or_else(|| anyhow::anyhow!("secret storage not initialized"))
}

fn write_encrypted(path: &Path, secret: &str) -> anyhow::Result<()> {
    let blob = encrypt(fallback_key()?, secret.as_bytes())?;
    std::fs::write(path, blob)?;
    restrict_private_file(path)?;
    Ok(())
}

fn read_encrypted(path: &Path) -> anyhow::Result<String> {
    let blob = std::fs::read_to_string(path)?;
    let bytes = decrypt(fallback_key()?, &blob)?;
    Ok(String::from_utf8(bytes)?)
}

fn keyring_entry(account: &str) -> anyhow::Result<keyring::Entry> {
    Ok(keyring::Entry::new(SERVICE_NAME, account)?)
}

/// Android/iOS (and other unsupported targets) use keyring's in-memory mock
/// store. `set_password` succeeds but the secret dies with the Entry, so we
/// must never treat that as success or we skip writing the encrypted file.
fn keyring_persists() -> bool {
    matches!(
        keyring::default::default_credential_builder().persistence(),
        keyring::credential::CredentialPersistence::UntilDelete
    )
}

fn keyring_set(account: &str, secret: &str) -> anyhow::Result<()> {
    keyring_entry(account)?.set_password(secret)?;
    Ok(())
}

fn keyring_get(account: &str) -> anyhow::Result<Option<String>> {
    match keyring_entry(account)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.into()),
    }
}

fn keyring_delete(account: &str) -> anyhow::Result<()> {
    match keyring_entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.into()),
    }
}

fn remove_if_present(path: &Path) {
    if path.exists() {
        let _ = std::fs::remove_file(path);
    }
}

/// Stores a secret in the OS keychain when it actually persists; otherwise
/// writes an encrypted file under the app data directory.
fn store_secret(account: &str, encrypted_path: &Path, legacy_path: &Path, secret: &str) -> anyhow::Result<()> {
    if keyring_persists() {
        match keyring_set(account, secret) {
            Ok(()) => {
                remove_if_present(encrypted_path);
                remove_if_present(legacy_path);
                return Ok(());
            }
            Err(_) => {}
        }
    }

    write_encrypted(encrypted_path, secret)?;
    remove_if_present(legacy_path);
    Ok(())
}

/// Reads a secret, preferring a persistent OS keychain. Secrets found in the
/// legacy plaintext files are migrated into secure storage and removed.
fn load_secret(account: &str, encrypted_path: &Path, legacy_path: &Path) -> anyhow::Result<Option<String>> {
    if keyring_persists() {
        if let Ok(Some(secret)) = keyring_get(account) {
            remove_if_present(encrypted_path);
            remove_if_present(legacy_path);
            return Ok(Some(secret));
        }
    }

    if encrypted_path.exists() {
        let secret = read_encrypted(encrypted_path)?;
        if keyring_persists() && keyring_set(account, &secret).is_ok() {
            remove_if_present(encrypted_path);
        }
        return Ok(Some(secret));
    }

    if legacy_path.exists() {
        let secret = std::fs::read_to_string(legacy_path)?;
        store_secret(account, encrypted_path, legacy_path, &secret)?;
        return Ok(Some(secret));
    }

    Ok(None)
}

fn delete_secret(account: &str, encrypted_path: &Path, legacy_path: &Path) -> anyhow::Result<()> {
    remove_if_present(encrypted_path);
    remove_if_present(legacy_path);
    if keyring_persists() {
        keyring_delete(account)?;
    }
    Ok(())
}

pub fn store_host_password(host_id: &str, password: &str) -> anyhow::Result<()> {
    store_secret(
        &format!("host-password-{}", safe_id(host_id)?),
        &host_password_path(host_id)?,
        &legacy_host_password_path(host_id)?,
        password,
    )
}

pub fn get_host_password(host_id: &str) -> anyhow::Result<Option<String>> {
    load_secret(
        &format!("host-password-{}", safe_id(host_id)?),
        &host_password_path(host_id)?,
        &legacy_host_password_path(host_id)?,
    )
}

pub fn delete_host_password(host_id: &str) -> anyhow::Result<()> {
    delete_secret(
        &format!("host-password-{}", safe_id(host_id)?),
        &host_password_path(host_id)?,
        &legacy_host_password_path(host_id)?,
    )
}

pub fn store_private_key(key_id: &str, private_key_pem: &str) -> anyhow::Result<()> {
    store_secret(
        &format!("ssh-key-{}", safe_id(key_id)?),
        &key_file_path(key_id)?,
        &legacy_key_file_path(key_id)?,
        private_key_pem,
    )
}

pub fn get_private_key(key_id: &str) -> anyhow::Result<Option<String>> {
    load_secret(
        &format!("ssh-key-{}", safe_id(key_id)?),
        &key_file_path(key_id)?,
        &legacy_key_file_path(key_id)?,
    )
}

pub fn delete_private_key(key_id: &str) -> anyhow::Result<()> {
    delete_secret(
        &format!("ssh-key-{}", safe_id(key_id)?),
        &key_file_path(key_id)?,
        &legacy_key_file_path(key_id)?,
    )
}
