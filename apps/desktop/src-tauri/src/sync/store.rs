//! Vault storage backends: self-host HTTP and personal cloud (Drive / OneDrive / Dropbox).

use serde::{Deserialize, Serialize};

/// Opaque vault blob stored remotely. Same shape as azalea-server `/v1/vault`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultBlob {
    pub version: i64,
    pub kdf_salt: String,
    pub verifier: String,
    #[serde(default)]
    pub recovery_envelope: Option<String>,
    pub ciphertext: String,
    /// Provider-specific revision (ETag / Dropbox rev). Used for conditional writes.
    #[serde(skip)]
    pub revision: Option<String>,
}

pub const VAULT_FILE_NAME: &str = "azalea-vault.json";

/// Soft limit only for self-host plans; personal cloud has no Azalea quota.
pub const PERSONAL_CLOUD_LIMIT_BYTES: i64 = i64::MAX / 4;
