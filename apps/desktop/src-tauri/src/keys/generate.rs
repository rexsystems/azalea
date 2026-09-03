use russh_keys::PrivateKey;
use ssh_key::{Algorithm, EcdsaCurve, HashAlg, LineEnding};
use uuid::Uuid;

use crate::keys::keyring;
use crate::models::SshKeyRecord;

/// Repair common PEM mangling that makes russh's strict reader return
/// `SshKey: length invalid` (dropped/indented base64 lines, CRLF, BOM, etc.).
pub fn normalize_private_key_pem(pem: &str) -> String {
    let mut text = pem
        .trim()
        .trim_start_matches('\u{feff}')
        .replace("\u{200b}", "") // zero-width space
        .replace("\u{200c}", "")
        .replace("\u{200d}", "")
        .replace("\u{feff}", "");

    // Keys copied out of JSON sometimes keep literal escape sequences.
    if text.contains("\\n") && text.lines().count() <= 2 {
        text = text.replace("\\r\\n", "\n").replace("\\n", "\n");
    }

    text = text.replace("\r\n", "\n").replace('\r', "\n");

    let mut begin: Option<String> = None;
    let mut end: Option<String> = None;
    let mut headers: Vec<String> = Vec::new();
    let mut body = String::new();
    let mut in_body = false;

    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        if line.starts_with("-----BEGIN ") && line.ends_with("-----") {
            begin = Some(line.to_string());
            in_body = true;
            headers.clear();
            body.clear();
            end = None;
            continue;
        }

        if line.starts_with("-----END ") && line.ends_with("-----") {
            end = Some(line.to_string());
            in_body = false;
            continue;
        }

        if !in_body {
            continue;
        }

        // Keep classic OpenSSL encryption headers intact.
        if line.starts_with("Proc-Type:") || line.starts_with("DEK-Info:") {
            headers.push(line.to_string());
            continue;
        }

        // Strip spaces/tabs inside base64 (word-wrap / paste artifacts).
        for ch in line.chars() {
            if ch.is_ascii_alphanumeric() || ch == '+' || ch == '/' || ch == '=' {
                body.push(ch);
            }
        }
    }

    let Some(begin) = begin else {
        return text.trim().to_string();
    };
    let end = end.unwrap_or_else(|| begin.replace("BEGIN", "END"));

    let mut out = String::new();
    out.push_str(&begin);
    out.push('\n');
    if !headers.is_empty() {
        for header in &headers {
            out.push_str(header);
            out.push('\n');
        }
        out.push('\n');
    }
    for chunk in body.as_bytes().chunks(64) {
        out.push_str(std::str::from_utf8(chunk).unwrap_or(""));
        out.push('\n');
    }
    out.push_str(&end);
    out.push('\n');
    out
}

fn format_import_error(err: russh_keys::Error, had_passphrase: bool) -> anyhow::Error {
    let msg = err.to_string();
    if msg.to_ascii_lowercase().contains("length invalid") {
        return anyhow::anyhow!(
            "Could not read private key (invalid PEM length). Re-export it with `ssh-keygen -p -m PEM -f id_rsa` or paste the full key including BEGIN/END lines."
        );
    }
    match err {
        russh_keys::Error::KeyIsEncrypted => anyhow::anyhow!("KEY_NEEDS_PASSPHRASE"),
        _ if had_passphrase => anyhow::anyhow!(
            "Could not decrypt key. Wrong passphrase, or the key format is unsupported."
        ),
        russh_keys::Error::Decode(_) => anyhow::anyhow!(
            "Invalid key file: base64 decoding failed. The file may be corrupted or use an unsupported encoding."
        ),
        russh_keys::Error::CouldNotReadKey => anyhow::anyhow!(
            "Could not read key. Supported: OpenSSH, PKCS#1, PKCS#8 — Ed25519, RSA, ECDSA (P-256/P-384/P-521), and DSA."
        ),
        other => anyhow::anyhow!("{other}"),
    }
}

fn parse_via_ssh_key(normalized: &str, passphrase: Option<&str>) -> anyhow::Result<PrivateKey> {
    let key = PrivateKey::from_openssh(normalized).map_err(|err| anyhow::anyhow!("{err}"))?;
    if key.is_encrypted() {
        let Some(phrase) = passphrase else {
            return Err(anyhow::anyhow!("KEY_NEEDS_PASSPHRASE"));
        };
        return key.decrypt(phrase.as_bytes()).map_err(|_| {
            anyhow::anyhow!(
                "Could not decrypt key. Wrong passphrase, or the key format is unsupported."
            )
        });
    }
    Ok(key)
}

fn parse_via_pkcs1_pem(normalized: &str) -> anyhow::Result<PrivateKey> {
    use pkcs1::DecodeRsaPrivateKey;
    use ssh_key::private::KeypairData;

    if !normalized.contains("BEGIN RSA PRIVATE KEY") {
        anyhow::bail!("not pkcs1");
    }
    // Encrypted classic PEM still needs russh / DEK-Info handling.
    if normalized.contains("Proc-Type:") || normalized.contains("DEK-Info:") {
        anyhow::bail!("encrypted pkcs1");
    }

    let rsa = rsa::RsaPrivateKey::from_pkcs1_pem(normalized)
        .map_err(|err| anyhow::anyhow!("PKCS#1 RSA parse failed: {err}"))?;
    let keypair: ssh_key::private::RsaKeypair = rsa
        .try_into()
        .map_err(|err| anyhow::anyhow!("RSA key conversion failed: {err}"))?;
    PrivateKey::new(KeypairData::Rsa(keypair), "")
        .map_err(|err| anyhow::anyhow!("RSA private key build failed: {err}"))
}

fn parse_via_pkcs8_pem(normalized: &str, passphrase: Option<&str>) -> anyhow::Result<PrivateKey> {
    use pkcs8::DecodePrivateKey;
    use ssh_key::private::KeypairData;

    if normalized.contains("BEGIN ENCRYPTED PRIVATE KEY") {
        let Some(phrase) = passphrase else {
            return Err(anyhow::anyhow!("KEY_NEEDS_PASSPHRASE"));
        };
        // Prefer rsa PKCS8 encrypted when possible; fall through on failure.
        if let Ok(rsa) = rsa::RsaPrivateKey::from_pkcs8_encrypted_pem(normalized, phrase.as_bytes())
        {
            let keypair: ssh_key::private::RsaKeypair = rsa
                .try_into()
                .map_err(|err| anyhow::anyhow!("RSA key conversion failed: {err}"))?;
            return PrivateKey::new(KeypairData::Rsa(keypair), "")
                .map_err(|err| anyhow::anyhow!("RSA private key build failed: {err}"));
        }
        anyhow::bail!("encrypted pkcs8 unsupported here");
    }

    if !normalized.contains("BEGIN PRIVATE KEY") {
        anyhow::bail!("not pkcs8");
    }

    if let Ok(rsa) = rsa::RsaPrivateKey::from_pkcs8_pem(normalized) {
        let keypair: ssh_key::private::RsaKeypair = rsa
            .try_into()
            .map_err(|err| anyhow::anyhow!("RSA key conversion failed: {err}"))?;
        return PrivateKey::new(KeypairData::Rsa(keypair), "")
            .map_err(|err| anyhow::anyhow!("RSA private key build failed: {err}"));
    }

    anyhow::bail!("pkcs8 parse failed")
}

fn parse_private_key(pem: &str, passphrase: Option<&str>) -> anyhow::Result<PrivateKey> {
    let normalized = normalize_private_key_pem(pem);
    let passphrase = passphrase.filter(|p| !p.is_empty());

    // 1) OpenSSH format via ssh-key (more tolerant PEM than russh's line reader).
    if normalized.contains("BEGIN OPENSSH PRIVATE KEY") {
        if let Ok(key) = parse_via_ssh_key(&normalized, passphrase) {
            return Ok(key);
        }
    }

    // 2) russh multi-format decoder (OpenSSH / PKCS#1 / PKCS#8 / encrypted).
    match russh_keys::decode_secret_key(&normalized, passphrase) {
        Ok(key) => return Ok(key),
        Err(russh_keys::Error::KeyIsEncrypted) => {
            return Err(anyhow::anyhow!("KEY_NEEDS_PASSPHRASE"));
        }
        Err(primary) => {
            // 3) Direct PKCS#1 / PKCS#8 RSA fallbacks for mangled id_rsa files.
            if let Ok(key) = parse_via_pkcs1_pem(&normalized) {
                return Ok(key);
            }
            if let Ok(key) = parse_via_pkcs8_pem(&normalized, passphrase) {
                return Ok(key);
            }
            if let Ok(key) = parse_via_ssh_key(&normalized, passphrase) {
                return Ok(key);
            }
            return Err(format_import_error(primary, passphrase.is_some()));
        }
    }
}

pub fn algorithm_label(algorithm: &Algorithm) -> String {
    match algorithm {
        Algorithm::Ed25519 => "ed25519".to_string(),
        Algorithm::Rsa { .. } => "rsa".to_string(),
        Algorithm::Ecdsa { curve } => match curve {
            EcdsaCurve::NistP256 => "ecdsa-nistp256".to_string(),
            EcdsaCurve::NistP384 => "ecdsa-nistp384".to_string(),
            EcdsaCurve::NistP521 => "ecdsa-nistp521".to_string(),
        },
        Algorithm::Dsa => "dsa".to_string(),
        Algorithm::SkEd25519 => "sk-ed25519".to_string(),
        Algorithm::SkEcdsaSha2NistP256 => "sk-ecdsa-nistp256".to_string(),
        other => other.to_string(),
    }
}

fn parse_generate_algorithm(raw: Option<&str>) -> anyhow::Result<Algorithm> {
    match raw.map(str::trim).filter(|s| !s.is_empty()).unwrap_or("ed25519") {
        "ed25519" => Ok(Algorithm::Ed25519),
        "rsa" | "rsa-4096" => Ok(Algorithm::Rsa { hash: None }),
        "ecdsa" | "ecdsa-p256" | "ecdsa-nistp256" => Ok(Algorithm::Ecdsa {
            curve: EcdsaCurve::NistP256,
        }),
        "ecdsa-p384" | "ecdsa-nistp384" => Ok(Algorithm::Ecdsa {
            curve: EcdsaCurve::NistP384,
        }),
        "ecdsa-p521" | "ecdsa-nistp521" => Ok(Algorithm::Ecdsa {
            curve: EcdsaCurve::NistP521,
        }),
        other => anyhow::bail!(
            "Unsupported generate algorithm '{other}'. Use ed25519, rsa, ecdsa-p256, ecdsa-p384, or ecdsa-p521."
        ),
    }
}

fn record_from_private_key(
    name: &str,
    private_key: &PrivateKey,
    id: String,
) -> anyhow::Result<SshKeyRecord> {
    let public_key = private_key.public_key();
    let public_openssh = public_key.to_openssh()?.to_string();
    let fingerprint = public_key.fingerprint(HashAlg::Sha256).to_string();
    let key_type = algorithm_label(&private_key.algorithm());

    Ok(SshKeyRecord {
        id,
        name: name.to_string(),
        public_key: public_openssh,
        key_type,
        fingerprint,
        created_at: chrono::Utc::now().timestamp(),
    })
}

fn store_private_key_material(id: &str, private_key: &PrivateKey, original_pem: &str) -> anyhow::Result<()> {
    match private_key.to_openssh(LineEnding::LF) {
        Ok(openssh) => keyring::store_private_key(id, &openssh),
        Err(_) => {
            // Some RSA keys fail OpenSSH re-encode on ssh-key 0.6; keep repaired original PEM.
            keyring::store_private_key(id, &normalize_private_key_pem(original_pem))
        }
    }
}

pub fn generate_key(name: &str, algorithm: Option<&str>) -> anyhow::Result<SshKeyRecord> {
    let algo = parse_generate_algorithm(algorithm)?;
    let private_key = PrivateKey::random(&mut rand::rngs::OsRng, algo)?;
    let id = Uuid::new_v4().to_string();
    let private_pem = private_key.to_openssh(LineEnding::LF)?.to_string();
    keyring::store_private_key(&id, &private_pem)?;
    record_from_private_key(name, &private_key, id)
}

pub fn import_private_key(
    name: &str,
    private_key_pem: &str,
    passphrase: Option<&str>,
) -> anyhow::Result<SshKeyRecord> {
    import_private_key_with_id(name, private_key_pem, passphrase, None)
}

pub fn import_private_key_with_id(
    name: &str,
    private_key_pem: &str,
    passphrase: Option<&str>,
    id: Option<&str>,
) -> anyhow::Result<SshKeyRecord> {
    let private_key = parse_private_key(private_key_pem, passphrase)?;

    match private_key.algorithm() {
        Algorithm::SkEd25519 | Algorithm::SkEcdsaSha2NistP256 => {
            anyhow::bail!("Security keys (FIDO/U2F) can't be imported as private key files.")
        }
        Algorithm::Ed25519
        | Algorithm::Rsa { .. }
        | Algorithm::Ecdsa { .. }
        | Algorithm::Dsa => {}
        other => anyhow::bail!("Unsupported key algorithm: {other}"),
    }

    let id = id
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    store_private_key_material(&id, &private_key, private_key_pem)?;
    record_from_private_key(name, &private_key, id)
}

pub fn load_key_pair(key_id: &str) -> anyhow::Result<PrivateKey> {
    let pem = keyring::get_private_key(key_id)?
        .ok_or_else(|| anyhow::anyhow!("Private key not found in keychain"))?;
    parse_private_key(&pem, None)
}

/// Returns the key type + base64 blob used to compare authorized_keys lines.
pub fn public_key_identity(public_key_openssh: &str) -> Option<String> {
    let line = public_key_openssh
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with('#'))?;
    let mut parts = line.split_whitespace();
    let key_type = parts.next()?;
    let blob = parts.next()?;
    Some(format!("{key_type} {blob}"))
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

    #[test]
    fn normalize_repairs_indented_base64() {
        let pem = "  -----BEGIN RSA PRIVATE KEY-----\n  MIIEowIBAAKCAQEA\n  -----END RSA PRIVATE KEY-----\n";
        let normalized = normalize_private_key_pem(pem);
        assert!(normalized.starts_with("-----BEGIN RSA PRIVATE KEY-----"));
        assert!(normalized.contains("\nMIIEowIBAAKCAQEA\n"));
        assert!(!normalized.contains("  MII"));
    }

    #[test]
    fn public_key_identity_ignores_comment() {
        let id = public_key_identity("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest comment here").unwrap();
        assert_eq!(id, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest");
    }
}

#[cfg(test)]
mod rsa_import_tests {
    use super::*;

    fn must_import(path: &str, pass: Option<&str>) {
        let pem = std::fs::read_to_string(path).unwrap();
        let key = parse_private_key(&pem, pass).unwrap_or_else(|e| panic!("{path}: {e}"));
        assert!(matches!(key.algorithm(), Algorithm::Rsa { .. }));
        russh_keys::helpers::sign_workaround(&key, b"chal").expect("sign");
    }

    #[test]
    fn rsa_variants() {
        must_import("/tmp/test_id_rsa", None);
        must_import("/tmp/test_id_rsa_openssh", None);
        must_import("/tmp/test_rsa3072", None);
        must_import("/tmp/test_rsa_pkcs8", None);
        must_import("/tmp/test_rsa_enc", Some("secret"));
    }

    #[test]
    fn rsa_indented_pkcs1() {
        let pem = std::fs::read_to_string("/tmp/test_id_rsa").unwrap();
        let indented = pem
            .lines()
            .map(|l| format!("  {l}"))
            .collect::<Vec<_>>()
            .join("\n");
        let key = parse_private_key(&indented, None).expect("indented pkcs1");
        assert!(matches!(key.algorithm(), Algorithm::Rsa { .. }));
    }

    #[test]
    fn rsa_single_line_escaped() {
        let pem = std::fs::read_to_string("/tmp/test_id_rsa").unwrap();
        let escaped = pem.replace('\n', "\\n");
        let key = parse_private_key(&escaped, None).expect("escaped pkcs1");
        assert!(matches!(key.algorithm(), Algorithm::Rsa { .. }));
    }
}
