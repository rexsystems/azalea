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
            "Could not read key. Supported: OpenSSH, PKCS#1, PKCS#8, SEC1 EC, PuTTY PPK — Ed25519, RSA, ECDSA (P-256/P-384/P-521)."
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

fn read_ssh_string<'a>(buf: &'a [u8], off: &mut usize) -> anyhow::Result<&'a [u8]> {
    if *off + 4 > buf.len() {
        anyhow::bail!("truncated length past end");
    }
    let len = u32::from_be_bytes(buf[*off..*off + 4].try_into().unwrap()) as usize;
    *off += 4;
    if *off + len > buf.len() {
        anyhow::bail!("string body past end");
    }
    let slice = &buf[*off..*off + len];
    *off += len;
    Ok(slice)
}

fn read_ssh_u32(buf: &[u8], off: &mut usize) -> anyhow::Result<u32> {
    if *off + 4 > buf.len() {
        anyhow::bail!("u32 past end");
    }
    let v = u32::from_be_bytes(buf[*off..*off + 4].try_into().unwrap());
    *off += 4;
    Ok(v)
}

pub(crate) fn mpint_to_biguint(bytes: &[u8]) -> rsa::BigUint {
    // OpenSSH mpints may include a leading 0x00 sign byte.
    let trimmed = bytes.strip_prefix(&[0]).unwrap_or(bytes);
    rsa::BigUint::from_bytes_be(trimmed)
}

/// Some OpenSSH private keys (esp. older/exported RSA) use padding longer than
/// the cipher block size. ssh-key 0.6 rejects those with "length invalid" even
/// though OpenSSH itself accepts them. Rebuild from the decoded key material.
fn parse_via_openssh_lenient(normalized: &str) -> anyhow::Result<PrivateKey> {
    use base64::Engine;
    use ssh_key::private::{Ed25519Keypair, KeypairData, RsaKeypair};

    if !normalized.contains("BEGIN OPENSSH PRIVATE KEY") {
        anyhow::bail!("not openssh");
    }

    let body: String = normalized
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with("-----"))
        .collect();
    let raw = base64::engine::general_purpose::STANDARD
        .decode(body.as_bytes())
        .map_err(|err| anyhow::anyhow!("OpenSSH base64 decode failed: {err}"))?;

    const MAGIC: &[u8] = b"openssh-key-v1\0";
    if !raw.starts_with(MAGIC) {
        anyhow::bail!("missing openssh-key-v1 magic");
    }

    let mut off = MAGIC.len();
    let cipher = read_ssh_string(&raw, &mut off)?;
    let kdf = read_ssh_string(&raw, &mut off)?;
    let _kdf_opts = read_ssh_string(&raw, &mut off)?;
    let nkeys = read_ssh_u32(&raw, &mut off)?;
    if nkeys != 1 {
        anyhow::bail!("unsupported multi-key OpenSSH blob");
    }
    let _public = read_ssh_string(&raw, &mut off)?;
    let private = read_ssh_string(&raw, &mut off)?;

    if cipher != b"none" || kdf != b"none" {
        anyhow::bail!("encrypted openssh needs passphrase path");
    }

    let mut po = 0usize;
    let check1 = read_ssh_u32(private, &mut po)?;
    let check2 = read_ssh_u32(private, &mut po)?;
    if check1 != check2 {
        anyhow::bail!("OpenSSH checkint mismatch");
    }

    let key_type = read_ssh_string(private, &mut po)?;
    match key_type {
        b"ssh-rsa" => {
            let n = mpint_to_biguint(read_ssh_string(private, &mut po)?);
            let e = mpint_to_biguint(read_ssh_string(private, &mut po)?);
            let d = mpint_to_biguint(read_ssh_string(private, &mut po)?);
            let _iqmp = mpint_to_biguint(read_ssh_string(private, &mut po)?);
            let p = mpint_to_biguint(read_ssh_string(private, &mut po)?);
            let q = mpint_to_biguint(read_ssh_string(private, &mut po)?);
            let comment = read_ssh_string(private, &mut po)?;

            let rsa_key = rsa::RsaPrivateKey::from_components(n, e, d, vec![p, q])
                .map_err(|err| anyhow::anyhow!("RSA from OpenSSH components failed: {err}"))?;
            let keypair: RsaKeypair = rsa_key
                .try_into()
                .map_err(|err| anyhow::anyhow!("RSA keypair convert failed: {err}"))?;
            PrivateKey::new(
                KeypairData::Rsa(keypair),
                String::from_utf8_lossy(comment).into_owned(),
            )
            .map_err(|err| anyhow::anyhow!("RSA private key build failed: {err}"))
        }
        b"ssh-ed25519" => {
            let _pk = read_ssh_string(private, &mut po)?;
            let sk = read_ssh_string(private, &mut po)?;
            let comment = read_ssh_string(private, &mut po)?;
            let sk: [u8; 64] = sk
                .try_into()
                .map_err(|_| anyhow::anyhow!("invalid ed25519 secret length"))?;
            let keypair = Ed25519Keypair::from_bytes(&sk)
                .map_err(|err| anyhow::anyhow!("Ed25519 keypair failed: {err}"))?;
            PrivateKey::new(
                KeypairData::Ed25519(keypair),
                String::from_utf8_lossy(comment).into_owned(),
            )
            .map_err(|err| anyhow::anyhow!("Ed25519 private key build failed: {err}"))
        }
        b"ecdsa-sha2-nistp256" | b"ecdsa-sha2-nistp384" | b"ecdsa-sha2-nistp521" => {
            use ssh_key::private::EcdsaKeypair;

            let _curve = read_ssh_string(private, &mut po)?;
            let _q = read_ssh_string(private, &mut po)?;
            let d = read_ssh_string(private, &mut po)?;
            let comment = read_ssh_string(private, &mut po)?;
            let d = d.strip_prefix(&[0]).unwrap_or(d);
            let algo = std::str::from_utf8(key_type).unwrap_or("");
            let keypair = match algo {
                "ecdsa-sha2-nistp256" => {
                    let sk = p256::SecretKey::from_slice(d)
                        .map_err(|e| anyhow::anyhow!("lenient P-256: {e}"))?;
                    let public = sk.public_key();
                    EcdsaKeypair::NistP256 {
                        private: sk.into(),
                        public: public.into(),
                    }
                }
                "ecdsa-sha2-nistp384" => {
                    let sk = p384::SecretKey::from_slice(d)
                        .map_err(|e| anyhow::anyhow!("lenient P-384: {e}"))?;
                    let public = sk.public_key();
                    EcdsaKeypair::NistP384 {
                        private: sk.into(),
                        public: public.into(),
                    }
                }
                "ecdsa-sha2-nistp521" => {
                    let sk = p521::SecretKey::from_slice(d)
                        .map_err(|e| anyhow::anyhow!("lenient P-521: {e}"))?;
                    let public = sk.public_key();
                    EcdsaKeypair::NistP521 {
                        private: sk.into(),
                        public: public.into(),
                    }
                }
                _ => unreachable!(),
            };
            PrivateKey::new(
                KeypairData::Ecdsa(keypair),
                String::from_utf8_lossy(comment).into_owned(),
            )
            .map_err(|err| anyhow::anyhow!("ECDSA private key build failed: {err}"))
        }
        other => anyhow::bail!(
            "lenient OpenSSH fallback unsupported for {}",
            String::from_utf8_lossy(other)
        ),
    }
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

fn ecdsa_from_p256_sk(sk: p256::SecretKey) -> ssh_key::private::KeypairData {
    use ssh_key::private::{EcdsaKeypair, KeypairData};
    let public = sk.public_key();
    KeypairData::Ecdsa(EcdsaKeypair::NistP256 {
        private: sk.into(),
        public: public.into(),
    })
}

fn ecdsa_from_p384_sk(sk: p384::SecretKey) -> ssh_key::private::KeypairData {
    use ssh_key::private::{EcdsaKeypair, KeypairData};
    let public = sk.public_key();
    KeypairData::Ecdsa(EcdsaKeypair::NistP384 {
        private: sk.into(),
        public: public.into(),
    })
}

fn ecdsa_from_p521_sk(sk: p521::SecretKey) -> ssh_key::private::KeypairData {
    use ssh_key::private::{EcdsaKeypair, KeypairData};
    let public = sk.public_key();
    KeypairData::Ecdsa(EcdsaKeypair::NistP521 {
        private: sk.into(),
        public: public.into(),
    })
}

fn parse_via_pkcs8_pem(normalized: &str, passphrase: Option<&str>) -> anyhow::Result<PrivateKey> {
    use pkcs8::DecodePrivateKey;
    use ssh_key::private::KeypairData;

    if normalized.contains("BEGIN ENCRYPTED PRIVATE KEY") {
        let Some(phrase) = passphrase else {
            return Err(anyhow::anyhow!("KEY_NEEDS_PASSPHRASE"));
        };
        let pw = phrase.as_bytes();
        if let Ok(rsa) = rsa::RsaPrivateKey::from_pkcs8_encrypted_pem(normalized, pw) {
            let keypair: ssh_key::private::RsaKeypair = rsa
                .try_into()
                .map_err(|err| anyhow::anyhow!("RSA key conversion failed: {err}"))?;
            return PrivateKey::new(KeypairData::Rsa(keypair), "")
                .map_err(|err| anyhow::anyhow!("RSA private key build failed: {err}"));
        }
        if let Ok(sk) = p256::SecretKey::from_pkcs8_encrypted_pem(normalized, pw) {
            return PrivateKey::new(ecdsa_from_p256_sk(sk), "")
                .map_err(|err| anyhow::anyhow!("{err}"));
        }
        if let Ok(sk) = p384::SecretKey::from_pkcs8_encrypted_pem(normalized, pw) {
            return PrivateKey::new(ecdsa_from_p384_sk(sk), "")
                .map_err(|err| anyhow::anyhow!("{err}"));
        }
        if let Ok(sk) = p521::SecretKey::from_pkcs8_encrypted_pem(normalized, pw) {
            return PrivateKey::new(ecdsa_from_p521_sk(sk), "")
                .map_err(|err| anyhow::anyhow!("{err}"));
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
    if let Ok(sk) = p256::SecretKey::from_pkcs8_pem(normalized) {
        return PrivateKey::new(ecdsa_from_p256_sk(sk), "").map_err(|err| anyhow::anyhow!("{err}"));
    }
    if let Ok(sk) = p384::SecretKey::from_pkcs8_pem(normalized) {
        return PrivateKey::new(ecdsa_from_p384_sk(sk), "").map_err(|err| anyhow::anyhow!("{err}"));
    }
    if let Ok(sk) = p521::SecretKey::from_pkcs8_pem(normalized) {
        return PrivateKey::new(ecdsa_from_p521_sk(sk), "").map_err(|err| anyhow::anyhow!("{err}"));
    }

    anyhow::bail!("pkcs8 parse failed")
}

pub(crate) fn parse_private_key(pem: &str, passphrase: Option<&str>) -> anyhow::Result<PrivateKey> {
    let passphrase = passphrase.filter(|p| !p.is_empty());

    // 0) PuTTY PPK (must run before PEM normalization — not PEM).
    if crate::keys::ppk::looks_like_ppk(pem) {
        return crate::keys::ppk::parse_ppk(pem, passphrase);
    }

    let normalized = normalize_private_key_pem(pem);

    // 1) OpenSSH format via ssh-key (more tolerant PEM than russh's line reader).
    if normalized.contains("BEGIN OPENSSH PRIVATE KEY") {
        match parse_via_ssh_key(&normalized, passphrase) {
            Ok(key) => return Ok(key),
            Err(err) if err.to_string().contains("KEY_NEEDS_PASSPHRASE") => return Err(err),
            Err(_) => {
                // 1b) Lenient path for keys with oversized OpenSSH padding.
                if passphrase.is_none() {
                    if let Ok(key) = parse_via_openssh_lenient(&normalized) {
                        return Ok(key);
                    }
                }
            }
        }
    }

    // 2) OpenSSL SEC1 EC keys (BEGIN EC PRIVATE KEY).
    if normalized.contains("BEGIN EC PRIVATE KEY") {
        match crate::keys::sec1::parse_sec1_ec_pem(&normalized, "") {
            Ok(key) => return Ok(key),
            Err(err) if err.to_string().contains("KEY_NEEDS_PASSPHRASE") => return Err(err),
            Err(_) => {}
        }
    }

    // 3) russh multi-format decoder (OpenSSH / PKCS#1 / PKCS#8 / encrypted).
    match russh_keys::decode_secret_key(&normalized, passphrase) {
        Ok(key) => return Ok(key),
        Err(russh_keys::Error::KeyIsEncrypted) => {
            return Err(anyhow::anyhow!("KEY_NEEDS_PASSPHRASE"));
        }
        Err(primary) => {
            // 4) Direct PKCS#1 / PKCS#8 RSA fallbacks for mangled id_rsa files.
            if let Ok(key) = parse_via_pkcs1_pem(&normalized) {
                return Ok(key);
            }
            if let Ok(key) = parse_via_pkcs8_pem(&normalized, passphrase) {
                return Ok(key);
            }
            if let Ok(key) = parse_via_ssh_key(&normalized, passphrase) {
                return Ok(key);
            }
            if passphrase.is_none() {
                if let Ok(key) = parse_via_openssh_lenient(&normalized) {
                    return Ok(key);
                }
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
        // Bit size is applied in generate_key (ssh-key defaults RSA to 4096).
        "rsa" | "rsa-4096" | "rsa-3072" | "rsa-2048" => Ok(Algorithm::Rsa { hash: None }),
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
            "Unsupported generate algorithm '{other}'. Use ed25519, rsa, rsa-2048, rsa-3072, rsa-4096, ecdsa-p256, ecdsa-p384, or ecdsa-p521."
        ),
    }
}

fn rsa_bits_for_label(raw: Option<&str>) -> usize {
    match raw.map(str::trim).unwrap_or("") {
        "rsa-2048" => 2048,
        "rsa-3072" => 3072,
        _ => 4096, // "rsa", "rsa-4096", default
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

/// Key type + fingerprint without storing anything (for ~/.ssh scans).
pub fn peek_private_key_meta(
    pem: &str,
    passphrase: Option<&str>,
) -> anyhow::Result<(String, String)> {
    let private_key = parse_private_key(pem, passphrase)?;
    let public_key = private_key.public_key();
    let fingerprint = public_key.fingerprint(HashAlg::Sha256).to_string();
    let key_type = algorithm_label(&private_key.algorithm());
    Ok((key_type, fingerprint))
}

pub fn private_key_needs_passphrase(pem: &str) -> bool {
    match parse_private_key(pem, None) {
        Ok(_) => false,
        Err(err) => {
            let msg = err.to_string();
            msg.contains("KEY_NEEDS_PASSPHRASE")
                || msg.to_lowercase().contains("passphrase")
                || msg.to_lowercase().contains("encrypted")
        }
    }
}

fn store_private_key_material(
    id: &str,
    private_key: &PrivateKey,
    original_pem: &str,
) -> anyhow::Result<()> {
    // Always persist an *unencrypted* OpenSSH private key. Falling back to the
    // original PEM is only safe when that PEM is already plaintext — never when
    // it was passphrase-protected (load_key_pair has no passphrase).
    if let Ok(openssh) = private_key.to_openssh(LineEnding::LF) {
        let openssh = openssh.to_string();
        // Round-trip check: ssh-key has historically mangled some RSA encodings.
        if let Ok(reloaded) = parse_private_key(&openssh, None) {
            let fp_ok = reloaded.public_key().fingerprint(HashAlg::Sha256).to_string()
                == private_key.public_key().fingerprint(HashAlg::Sha256).to_string();
            let sign_ok = russh_keys::helpers::sign_workaround(&reloaded, b"azalea-store-check").is_ok();
            if fp_ok && sign_ok {
                return keyring::store_private_key(id, &openssh);
            }
        }
        // Fall through to original PEM when re-encode is unsafe.
    }

    let normalized = normalize_private_key_pem(original_pem);
    let looks_encrypted = normalized.contains("ENCRYPTED")
        || normalized.contains("Proc-Type:")
        || normalized.contains("DEK-Info:")
        || (crate::keys::ppk::looks_like_ppk(original_pem)
            && original_pem.to_ascii_lowercase().contains("encryption: aes"));
    if looks_encrypted {
        anyhow::bail!(
            "Imported key decrypted, but could not re-encode it to OpenSSH format for storage. Try converting with: ssh-keygen -p -m RFC4716 -f key"
        );
    }
    // Prefer storing a verified OpenSSH rewrite of PKCS#1/PKCS#8/PPK when the
    // direct to_openssh path above failed the round-trip — re-parse normalized
    // plaintext and try one more encode before keeping the original bytes.
    if let Ok(parsed) = parse_private_key(&normalized, None) {
        if let Ok(openssh) = parsed.to_openssh(LineEnding::LF) {
            let openssh = openssh.to_string();
            if let Ok(reloaded) = parse_private_key(&openssh, None) {
                if russh_keys::helpers::sign_workaround(&reloaded, b"azalea-store-check").is_ok() {
                    return keyring::store_private_key(id, &openssh);
                }
            }
        }
    }
    keyring::store_private_key(id, &normalized)
}

pub fn generate_key(name: &str, algorithm: Option<&str>) -> anyhow::Result<SshKeyRecord> {
    let algo = parse_generate_algorithm(algorithm)?;
    let private_key = match &algo {
        Algorithm::Rsa { .. } => {
            use ssh_key::private::{KeypairData, RsaKeypair};
            let bits = rsa_bits_for_label(algorithm);
            let rsa = RsaKeypair::random(&mut rand::rngs::OsRng, bits)
                .map_err(|e| anyhow::anyhow!("RSA {bits}-bit generate failed: {e}"))?;
            PrivateKey::new(KeypairData::Rsa(rsa), name.to_string())?
        }
        _ => PrivateKey::random(&mut rand::rngs::OsRng, algo)?,
    };
    let id = Uuid::new_v4().to_string();
    let private_pem = private_key
        .to_openssh(LineEnding::LF)
        .map_err(|e| anyhow::anyhow!("Failed to encode generated key: {e}"))?
        .to_string();
    keyring::store_private_key(&id, &private_pem)?;
    // Verify the key can sign (guards against ssh-key RSA encode bugs).
    russh_keys::helpers::sign_workaround(&private_key, b"azalea-key-check")
        .map_err(|e| anyhow::anyhow!("Generated key failed self-check: {e}"))?;
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

    // Same signing path russh uses for SSH auth — reject keys that cannot sign.
    russh_keys::helpers::sign_workaround(&private_key, b"azalea-import-check")
        .map_err(|e| anyhow::anyhow!("Imported key failed sign check: {e}"))?;

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

#[cfg(test)]
mod openssh_lenient_tests {
    use super::*;

    #[test]
    fn imports_oversized_padding_rsa_if_present() {
        let home = match std::env::var("HOME") {
            Ok(h) => h,
            Err(_) => return,
        };
        let path = std::path::PathBuf::from(home).join(".ssh/lethal");
        let Ok(pem) = std::fs::read_to_string(&path) else {
            return;
        };
        let key = parse_private_key(&pem, None).expect("lethal should import via lenient OpenSSH");
        assert!(matches!(key.algorithm(), Algorithm::Rsa { .. }));
    }
}



#[cfg(test)]
mod broad_import_tests {
    use super::*;
    use ssh_key::{Algorithm, EcdsaCurve};

    const FIX: &str = "/tmp/azalea-key-fixtures";

    fn must_parse(name: &str, pass: Option<&str>) -> PrivateKey {
        let pem = std::fs::read_to_string(format!("{FIX}/{name}")).unwrap();
        let key = parse_private_key(&pem, pass).unwrap_or_else(|e| panic!("{name}: {e}"));
        russh_keys::helpers::sign_workaround(&key, b"chal").unwrap_or_else(|e| panic!("{name} sign: {e}"));
        key
    }

    #[test]
    fn all_formats_and_algos() {
        if !std::path::Path::new(FIX).is_dir() {
            eprintln!("skip: fixtures missing at {FIX}");
            return;
        }
        assert!(matches!(must_parse("ed25519_openssh", None).algorithm(), Algorithm::Ed25519));
        assert!(matches!(must_parse("rsa2048_openssh", None).algorithm(), Algorithm::Rsa { .. }));
        assert!(matches!(must_parse("rsa2048_pkcs1", None).algorithm(), Algorithm::Rsa { .. }));
        assert!(matches!(must_parse("rsa2048_pkcs8", None).algorithm(), Algorithm::Rsa { .. }));
        assert!(matches!(must_parse("rsa3072_openssh", None).algorithm(), Algorithm::Rsa { .. }));
        assert!(matches!(must_parse("rsa4096_openssh", None).algorithm(), Algorithm::Rsa { .. }));
        assert!(matches!(must_parse("rsa2048_enc", Some("secret")).algorithm(), Algorithm::Rsa { .. }));
        assert!(matches!(
            must_parse("ecdsa256_openssh", None).algorithm(),
            Algorithm::Ecdsa { curve: EcdsaCurve::NistP256 }
        ));
        assert!(matches!(
            must_parse("ecdsa384_openssh", None).algorithm(),
            Algorithm::Ecdsa { curve: EcdsaCurve::NistP384 }
        ));
        assert!(matches!(
            must_parse("ecdsa521_openssh", None).algorithm(),
            Algorithm::Ecdsa { curve: EcdsaCurve::NistP521 }
        ));
        assert!(matches!(
            must_parse("ecdsa256_sec1", None).algorithm(),
            Algorithm::Ecdsa { curve: EcdsaCurve::NistP256 }
        ));
        assert!(matches!(
            must_parse("ecdsa384_sec1", None).algorithm(),
            Algorithm::Ecdsa { curve: EcdsaCurve::NistP384 }
        ));
        assert!(matches!(
            must_parse("ecdsa521_sec1", None).algorithm(),
            Algorithm::Ecdsa { curve: EcdsaCurve::NistP521 }
        ));
        assert!(matches!(
            must_parse("ecdsa256_pkcs8", None).algorithm(),
            Algorithm::Ecdsa { curve: EcdsaCurve::NistP256 }
        ));
        assert!(matches!(must_parse("ed25519.ppk", None).algorithm(), Algorithm::Ed25519));
        assert!(matches!(must_parse("rsa2048.ppk", None).algorithm(), Algorithm::Rsa { .. }));
        assert!(matches!(
            must_parse("ecdsa256.ppk", None).algorithm(),
            Algorithm::Ecdsa { curve: EcdsaCurve::NistP256 }
        ));
    }

    #[test]
    fn generate_all_algos_can_sign() {
        for label in [
            "ed25519",
            "rsa-2048",
            "rsa-3072",
            "rsa-4096",
            "ecdsa-p256",
            "ecdsa-p384",
            "ecdsa-p521",
        ] {
            let algo = parse_generate_algorithm(Some(label)).unwrap();
            let key = match &algo {
                Algorithm::Rsa { .. } => {
                    use ssh_key::private::{KeypairData, RsaKeypair};
                    let bits = rsa_bits_for_label(Some(label));
                    let rsa = RsaKeypair::random(&mut rand::rngs::OsRng, bits).unwrap();
                    PrivateKey::new(KeypairData::Rsa(rsa), "t").unwrap()
                }
                _ => PrivateKey::random(&mut rand::rngs::OsRng, algo).unwrap(),
            };
            // Round-trip OpenSSH encode/decode (storage path).
            let openssh = key.to_openssh(ssh_key::LineEnding::LF).unwrap().to_string();
            let again = parse_private_key(&openssh, None).unwrap();
            russh_keys::helpers::sign_workaround(&again, b"chal")
                .unwrap_or_else(|e| panic!("generate {label}: {e}"));
        }
    }
}
