//! OpenSSL SEC1 `BEGIN EC PRIVATE KEY` import (NIST P-256 / P-384 / P-521).

use ssh_key::private::{EcdsaKeypair, KeypairData};
use ssh_key::PrivateKey;

/// Parse a classic OpenSSL SEC1 EC private key PEM into an SSH private key.
pub fn parse_sec1_ec_pem(pem: &str, comment: &str) -> anyhow::Result<PrivateKey> {
    if !pem.contains("BEGIN EC PRIVATE KEY") {
        anyhow::bail!("not sec1");
    }

    if let Ok(sk) = p256::SecretKey::from_sec1_pem(pem) {
        let public = sk.public_key();
        let keypair = EcdsaKeypair::NistP256 {
            private: sk.into(),
            public: public.into(),
        };
        return PrivateKey::new(KeypairData::Ecdsa(keypair), comment.to_string())
            .map_err(|e| anyhow::anyhow!("{e}"));
    }
    if let Ok(sk) = p384::SecretKey::from_sec1_pem(pem) {
        let public = sk.public_key();
        let keypair = EcdsaKeypair::NistP384 {
            private: sk.into(),
            public: public.into(),
        };
        return PrivateKey::new(KeypairData::Ecdsa(keypair), comment.to_string())
            .map_err(|e| anyhow::anyhow!("{e}"));
    }
    if let Ok(sk) = p521::SecretKey::from_sec1_pem(pem) {
        let public = sk.public_key();
        let keypair = EcdsaKeypair::NistP521 {
            private: sk.into(),
            public: public.into(),
        };
        return PrivateKey::new(KeypairData::Ecdsa(keypair), comment.to_string())
            .map_err(|e| anyhow::anyhow!("{e}"));
    }

    anyhow::bail!("Could not parse EC PRIVATE KEY (expected NIST P-256/P-384/P-521).")
}
