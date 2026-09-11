use aes_gcm::aead::{Aead, KeyInit, OsRng, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rand::RngCore;

pub const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const SALT_LEN: usize = 16;

/// Blob format version. Older Azalea vaults ship `V1` (nonce || ciphertext,
/// no AAD). `V2` is `[0x02 || nonce || ciphertext]` with associated data
/// bound at encrypt / decrypt time. We keep V1-decrypt for backward compat so
/// existing vaults keep working; every new write uses V2.
const BLOB_VERSION_V2: u8 = 0x02;

pub type VaultKey = [u8; KEY_LEN];

fn argon2() -> Argon2<'static> {
    // 64 MiB, 3 iterations, 1 lane - interactive-grade Argon2id.
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

/// AEAD encrypt with no associated data. Kept for legacy call sites that seal
/// a random vault key with a KEK (there is no natural AAD to bind there).
/// Writes a `V2` blob (with an empty AAD tagged in).
pub fn encrypt(key: &VaultKey, plaintext: &[u8]) -> anyhow::Result<String> {
    encrypt_with_aad(key, plaintext, &[])
}

/// AEAD decrypt. Understands both `V1` (legacy, no AAD) and `V2` (AAD-bound).
/// The AAD must match what was passed to `encrypt_with_aad`. Callers that
/// don't care about AAD can pass an empty slice, but note that a V2 blob
/// created with a non-empty AAD will not decrypt with an empty AAD.
pub fn decrypt(key: &VaultKey, blob_b64: &str) -> anyhow::Result<Vec<u8>> {
    decrypt_with_aad(key, blob_b64, &[])
}

/// AEAD encrypt binding `associated_data` into the tag. The AAD must be
/// reproduced exactly on decrypt (it is NOT stored in the blob).
pub fn encrypt_with_aad(
    key: &VaultKey,
    plaintext: &[u8],
    associated_data: &[u8],
) -> anyhow::Result<String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: associated_data,
            },
        )
        .map_err(|_| anyhow::anyhow!("Encryption failed"))?;

    let mut blob = Vec::with_capacity(1 + NONCE_LEN + ciphertext.len());
    blob.push(BLOB_VERSION_V2);
    blob.extend_from_slice(&nonce);
    blob.extend_from_slice(&ciphertext);
    Ok(B64.encode(blob))
}

pub fn decrypt_with_aad(
    key: &VaultKey,
    blob_b64: &str,
    associated_data: &[u8],
) -> anyhow::Result<Vec<u8>> {
    let blob = B64
        .decode(blob_b64.trim())
        .map_err(|_| anyhow::anyhow!("Invalid encrypted blob"))?;
    if blob.is_empty() {
        anyhow::bail!("Encrypted blob is empty");
    }

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));

    // V2: [0x02 | nonce (12) | ciphertext]
    if blob[0] == BLOB_VERSION_V2 {
        if blob.len() <= 1 + NONCE_LEN {
            anyhow::bail!("Encrypted blob too short");
        }
        let (nonce, ciphertext) = blob[1..].split_at(NONCE_LEN);
        return cipher
            .decrypt(
                Nonce::from_slice(nonce),
                Payload {
                    msg: ciphertext,
                    aad: associated_data,
                },
            )
            .map_err(|_| {
                anyhow::anyhow!("Decryption failed - wrong passphrase or corrupted data")
            });
    }

    // V1 (legacy): [nonce (12) | ciphertext], no AAD. Only accepted when the
    // caller did not supply AAD (empty slice); otherwise the mismatch is a
    // downgrade attempt.
    if !associated_data.is_empty() {
        anyhow::bail!("Refusing to decrypt legacy blob when AAD is required");
    }
    if blob.len() <= NONCE_LEN {
        anyhow::bail!("Encrypted blob too short");
    }
    let (nonce, ciphertext) = blob.split_at(NONCE_LEN);
    cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| anyhow::anyhow!("Decryption failed - wrong passphrase or corrupted data"))
}

/// Encrypts the random vault key with a KEK (passphrase-derived or recovery key).
/// No AAD - the envelope is invariant across vault versions.
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
///
/// WARNING: The recovery string MUST be produced by `format_recovery_key`.
/// The KEK derivation (`recovery_kek_from_string`) uses SHA-256 rather than a
/// slow KDF; it is only safe because the input is ~200 bits of entropy. If a
/// future refactor lets users type a low-entropy phrase here, switch this to
/// Argon2 first.
pub fn format_recovery_key(key: &VaultKey) -> String {
    let encoded = B64.encode(key).replace(['+', '/'], "").replace('=', "");
    let chunks: Vec<String> = encoded
        .as_bytes()
        .chunks(6)
        .map(|c| String::from_utf8_lossy(c).to_uppercase())
        .collect();
    format!("AZLA-{}", chunks.join("-"))
}

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

/// Build the AAD tag bound to a specific vault snapshot. Binds the account
/// id, vault version, and kdf_salt so a malicious server cannot replay an
/// older ciphertext for the same account (rollback) or another account's
/// ciphertext (cross-account swap) without detection.
pub fn vault_aad(account_id: &str, version: i64, kdf_salt: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(account_id.len() + kdf_salt.len() + 24);
    out.extend_from_slice(b"azalea-vault-v1|");
    out.extend_from_slice(account_id.as_bytes());
    out.push(b'|');
    out.extend_from_slice(version.to_string().as_bytes());
    out.push(b'|');
    out.extend_from_slice(kdf_salt.as_bytes());
    out
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

    #[test]
    fn aad_roundtrip() {
        let key = generate_key();
        let aad = vault_aad("acc-1", 5, "salt1");
        let blob = encrypt_with_aad(&key, b"payload", &aad).unwrap();
        assert_eq!(decrypt_with_aad(&key, &blob, &aad).unwrap(), b"payload");
    }

    #[test]
    fn aad_mismatch_fails() {
        let key = generate_key();
        let blob = encrypt_with_aad(&key, b"payload", &vault_aad("acc-1", 5, "salt1")).unwrap();
        // Wrong account
        assert!(decrypt_with_aad(&key, &blob, &vault_aad("acc-2", 5, "salt1")).is_err());
        // Wrong version (rollback)
        assert!(decrypt_with_aad(&key, &blob, &vault_aad("acc-1", 4, "salt1")).is_err());
        // Wrong salt
        assert!(decrypt_with_aad(&key, &blob, &vault_aad("acc-1", 5, "salt2")).is_err());
    }

    #[test]
    fn legacy_v1_still_decrypts_without_aad() {
        // Simulate a V1 blob (no version prefix).
        let key = generate_key();
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
        let nonce = [0u8; NONCE_LEN];
        let ciphertext = cipher
            .encrypt(Nonce::from_slice(&nonce), b"legacy".as_ref())
            .unwrap();
        let mut blob = Vec::new();
        blob.extend_from_slice(&nonce);
        blob.extend_from_slice(&ciphertext);
        let b64 = B64.encode(&blob);
        assert_eq!(decrypt(&key, &b64).unwrap(), b"legacy");
    }
}
