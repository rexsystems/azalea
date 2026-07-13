use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rand::RngCore;

pub const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const SALT_LEN: usize = 16;

pub type VaultKey = [u8; KEY_LEN];

fn argon2() -> Argon2<'static> {
    // 64 MiB, 3 iterations, 1 lane — interactive-grade Argon2id.
    let params = Params::new(64 * 1024, 3, 1, Some(KEY_LEN)).expect("valid argon2 params");
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
}

pub fn generate_salt() -> String {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    B64.encode(salt)
}

pub fn generate_key() -> VaultKey {
    let mut key = [0u8; KEY_LEN];
    OsRng.fill_bytes(&mut key);
    key
}

pub fn derive_key(passphrase: &str, salt_b64: &str) -> anyhow::Result<VaultKey> {
    let salt = B64
        .decode(salt_b64)
        .map_err(|_| anyhow::anyhow!("Invalid KDF salt"))?;
    let mut out = [0u8; KEY_LEN];
    argon2()
        .hash_password_into(passphrase.as_bytes(), &salt, &mut out)
        .map_err(|err| anyhow::anyhow!("Key derivation failed: {err}"))?;
    Ok(out)
}

pub fn encrypt(key: &VaultKey, plaintext: &[u8]) -> anyhow::Result<String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext)
        .map_err(|_| anyhow::anyhow!("Encryption failed"))?;

    let mut blob = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    blob.extend_from_slice(&nonce);
    blob.extend_from_slice(&ciphertext);
    Ok(B64.encode(blob))
}

pub fn decrypt(key: &VaultKey, blob_b64: &str) -> anyhow::Result<Vec<u8>> {
    let blob = B64
        .decode(blob_b64.trim())
        .map_err(|_| anyhow::anyhow!("Invalid encrypted blob"))?;
    if blob.len() <= NONCE_LEN {
        anyhow::bail!("Encrypted blob too short");
    }
    let (nonce, ciphertext) = blob.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| anyhow::anyhow!("Decryption failed — wrong passphrase or corrupted data"))
}

/// Encrypts the random vault key with a KEK (passphrase-derived or recovery key).
pub fn seal_vault_key(kek: &VaultKey, vault_key: &VaultKey) -> anyhow::Result<String> {
    encrypt(kek, vault_key)
}

pub fn open_vault_key(kek: &VaultKey, envelope_b64: &str) -> anyhow::Result<VaultKey> {
    let bytes = decrypt(kek, envelope_b64)?;
    let key: VaultKey = bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("Invalid vault key envelope"))?;
    Ok(key)
}

/// Recovery key shown to the user once, e.g. "AZLA-xxxx-...." (base32-ish from 32 random bytes).
pub fn format_recovery_key(key: &VaultKey) -> String {
    let encoded = B64.encode(key).replace(['+', '/'], "").replace('=', "");
    let chunks: Vec<String> = encoded
        .as_bytes()
        .chunks(6)
        .map(|c| String::from_utf8_lossy(c).to_uppercase())
        .collect();
    format!("AZLA-{}", chunks.join("-"))
}

/// A recovery key is random bytes; we must keep the exact bytes to decrypt.
/// So we store base64 of the raw key inside the formatted string is lossy —
/// instead we derive: recovery KEK = SHA-256(normalized recovery string).
pub fn recovery_kek_from_string(recovery: &str) -> VaultKey {
    use sha2::{Digest, Sha256};
    let normalized: String = recovery
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_uppercase();
    let digest = Sha256::digest(normalized.as_bytes());
    let mut key = [0u8; KEY_LEN];
    key.copy_from_slice(&digest);
    key
}

pub fn vault_hash(json: &str) -> String {
    use sha2::{Digest, Sha256};
    B64.encode(Sha256::digest(json.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_encrypt_decrypt() {
        let key = generate_key();
        let blob = encrypt(&key, b"hello vault").unwrap();
        assert_eq!(decrypt(&key, &blob).unwrap(), b"hello vault");
    }

    #[test]
    fn wrong_key_fails() {
        let key = generate_key();
        let other = generate_key();
        let blob = encrypt(&key, b"secret").unwrap();
        assert!(decrypt(&other, &blob).is_err());
    }

    #[test]
    fn derive_is_deterministic() {
        let salt = generate_salt();
        let a = derive_key("passphrase", &salt).unwrap();
        let b = derive_key("passphrase", &salt).unwrap();
        assert_eq!(a, b);
        let c = derive_key("other", &salt).unwrap();
        assert_ne!(a, c);
    }

    #[test]
    fn vault_key_envelope_roundtrip() {
        let kek = generate_key();
        let vault_key = generate_key();
        let envelope = seal_vault_key(&kek, &vault_key).unwrap();
        assert_eq!(open_vault_key(&kek, &envelope).unwrap(), vault_key);
    }

    #[test]
    fn recovery_string_normalization() {
        let key = generate_key();
        let formatted = format_recovery_key(&key);
        let a = recovery_kek_from_string(&formatted);
        let b = recovery_kek_from_string(&formatted.to_lowercase().replace('-', " "));
        assert_eq!(a, b);
    }
}
