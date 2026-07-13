use russh_keys::PrivateKey;
use ssh_key::{Algorithm, HashAlg, LineEnding};
use uuid::Uuid;

use crate::keys::keyring;
use crate::models::SshKeyRecord;

pub fn normalize_private_key_pem(pem: &str) -> String {
    pem.trim()
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .lines()
        .map(str::trim)
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_import_error(err: russh_keys::Error, had_passphrase: bool) -> anyhow::Error {
    match err {
        russh_keys::Error::KeyIsEncrypted => anyhow::anyhow!("KEY_NEEDS_PASSPHRASE"),
        _ if had_passphrase => anyhow::anyhow!(
            "Could not decrypt key. Wrong passphrase, or the key format is unsupported."
        ),
        russh_keys::Error::Decode(_) => anyhow::anyhow!(
            "Invalid key file: base64 decoding failed. The file may be corrupted or use an unsupported encoding."
        ),
        russh_keys::Error::CouldNotReadKey => anyhow::anyhow!(
            "Could not read key. Supported formats: OpenSSH, RSA (PKCS#1), and PKCS#8 private keys."
        ),
        other => anyhow::anyhow!("{other}"),
    }
}

fn parse_private_key(pem: &str, passphrase: Option<&str>) -> anyhow::Result<PrivateKey> {
    let normalized = normalize_private_key_pem(pem);
    let passphrase = passphrase.filter(|p| !p.is_empty());
    russh_keys::decode_secret_key(&normalized, passphrase)
        .map_err(|err| format_import_error(err, passphrase.is_some()))
}

pub fn generate_ed25519_key(name: &str) -> anyhow::Result<SshKeyRecord> {
    let private_key = PrivateKey::random(&mut rand::rngs::OsRng, Algorithm::Ed25519)?;
    let public_key = private_key.public_key();

    let id = Uuid::new_v4().to_string();
    let private_pem = private_key.to_openssh(LineEnding::LF)?.to_string();
    let public_openssh = public_key.to_openssh()?.to_string();
    let fingerprint = public_key.fingerprint(HashAlg::Sha256).to_string();

    keyring::store_private_key(&id, &private_pem)?;

    Ok(SshKeyRecord {
        id,
        name: name.to_string(),
        public_key: public_openssh,
        key_type: "ed25519".to_string(),
        fingerprint,
        created_at: chrono::Utc::now().timestamp(),
    })
}

pub fn import_private_key(
    name: &str,
    private_key_pem: &str,
    passphrase: Option<&str>,
) -> anyhow::Result<SshKeyRecord> {
    // Stored key is always the decrypted OpenSSH PEM, so connects never need
    // the passphrase again.
    let private_key = parse_private_key(private_key_pem, passphrase)?;
    let public_key = private_key.public_key();

    let id = Uuid::new_v4().to_string();
    let stored_pem = private_key.to_openssh(LineEnding::LF)?.to_string();
    let public_openssh = public_key.to_openssh()?.to_string();
    let fingerprint = public_key.fingerprint(HashAlg::Sha256).to_string();
    let key_type = match private_key.algorithm() {
        Algorithm::Ed25519 => "ed25519",
        Algorithm::Rsa { .. } => "rsa",
        other => anyhow::bail!("Unsupported key algorithm: {other:?}"),
    };

    keyring::store_private_key(&id, &stored_pem)?;

    Ok(SshKeyRecord {
        id,
        name: name.to_string(),
        public_key: public_openssh,
        key_type: key_type.to_string(),
        fingerprint,
        created_at: chrono::Utc::now().timestamp(),
    })
}

pub fn load_key_pair(key_id: &str) -> anyhow::Result<PrivateKey> {
    let pem = keyring::get_private_key(key_id)?
        .ok_or_else(|| anyhow::anyhow!("Private key not found in keychain"))?;
    parse_private_key(&pem, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_strips_crlf_and_bom() {
        let raw = "\u{feff}-----BEGIN OPENSSH PRIVATE KEY-----\r\nabc\r\n-----END OPENSSH PRIVATE KEY-----\r\n";
        let normalized = normalize_private_key_pem(raw);
        assert!(!normalized.contains('\r'));
        assert!(normalized.starts_with("-----BEGIN OPENSSH PRIVATE KEY-----"));
        assert!(normalized.contains("abc"));
    }
}
