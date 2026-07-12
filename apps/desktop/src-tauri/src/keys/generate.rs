use russh_keys::PrivateKey;
use ssh_key::{Algorithm, HashAlg, LineEnding};
use uuid::Uuid;

use crate::keys::keyring;
use crate::models::SshKeyRecord;

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

pub fn import_private_key(name: &str, private_key_pem: &str) -> anyhow::Result<SshKeyRecord> {
    let private_key = PrivateKey::from_openssh(private_key_pem.as_bytes())?;
    let public_key = private_key.public_key();

    let id = Uuid::new_v4().to_string();
    let public_openssh = public_key.to_openssh()?.to_string();
    let fingerprint = public_key.fingerprint(HashAlg::Sha256).to_string();
    let key_type = match private_key.algorithm() {
        Algorithm::Ed25519 => "ed25519",
        Algorithm::Rsa { .. } => "rsa",
        other => anyhow::bail!("Unsupported key algorithm: {other:?}"),
    };

    keyring::store_private_key(&id, private_key_pem)?;

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
    let key_pair = russh_keys::decode_secret_key(&pem, None)?;
    Ok(key_pair)
}
