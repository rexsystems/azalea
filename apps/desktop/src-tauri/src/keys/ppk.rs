//! PuTTY PPK (v2 / v3) private key import.
//!
//! Validates by reconstructing the key and checking it matches the public blob.
//! Encrypted keys use AES-256-CBC (PPK2 SHA-1 KDF or PPK3 Argon2id).

use aes::cipher::{block_padding::NoPadding, BlockModeDecrypt, KeyIvInit};
use base64::Engine;
use hmac::{Hmac, Mac};
use sha1::{Digest as _, Sha1};
use sha2::Sha256;
use ssh_key::private::{EcdsaKeypair, Ed25519Keypair, KeypairData, RsaKeypair};
use ssh_key::PrivateKey;

type HmacSha1 = Hmac<Sha1>;
type HmacSha256 = Hmac<Sha256>;

type Aes256CbcDec = cbc::Decryptor<aes::Aes256>;

fn mpint_to_biguint(bytes: &[u8]) -> rsa::BigUint {
    let trimmed = bytes.strip_prefix(&[0]).unwrap_or(bytes);
    rsa::BigUint::from_bytes_be(trimmed)
}

fn read_string<'a>(buf: &'a [u8], off: &mut usize) -> anyhow::Result<&'a [u8]> {
    if *off + 4 > buf.len() {
        anyhow::bail!("ppk: truncated string length");
    }
    let len = u32::from_be_bytes(buf[*off..*off + 4].try_into().unwrap()) as usize;
    *off += 4;
    if *off + len > buf.len() {
        anyhow::bail!("ppk: truncated string body");
    }
    let s = &buf[*off..*off + len];
    *off += len;
    Ok(s)
}

fn read_mpint(buf: &[u8], off: &mut usize) -> anyhow::Result<rsa::BigUint> {
    Ok(mpint_to_biguint(read_string(buf, off)?))
}

fn b64_body(lines: &[String]) -> anyhow::Result<Vec<u8>> {
    let joined: String = lines.iter().map(|l| l.trim()).collect();
    base64::engine::general_purpose::STANDARD
        .decode(joined.as_bytes())
        .map_err(|e| anyhow::anyhow!("ppk base64: {e}"))
}

struct PpkFile {
    version: u8,
    algorithm: String,
    encryption: String,
    comment: String,
    public: Vec<u8>,
    private: Vec<u8>,
    private_mac: String,
    argon2_flavour: Option<String>,
    argon2_memory: Option<u32>,
    argon2_passes: Option<u32>,
    argon2_parallelism: Option<u32>,
    argon2_salt: Option<Vec<u8>>,
}

fn ssh_string_bytes(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + data.len());
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(data);
    out
}

fn is_unencrypted(encryption: &str) -> bool {
    encryption.is_empty() || encryption == "none"
}

fn parse_ppk_text(text: &str) -> anyhow::Result<PpkFile> {
    let mut version = 0u8;
    let mut algorithm = String::new();
    let mut encryption = String::new();
    let mut comment = String::new();
    let mut private_mac = String::new();
    let mut public_lines = Vec::new();
    let mut private_lines = Vec::new();
    let mut expect_public = 0usize;
    let mut expect_private = 0usize;
    let mut argon2_flavour = None;
    let mut argon2_memory = None;
    let mut argon2_passes = None;
    let mut argon2_parallelism = None;
    let mut argon2_salt = None;

    for raw in text.lines() {
        let line = raw.trim_end_matches('\r');
        if expect_public > 0 {
            public_lines.push(line.to_string());
            expect_public -= 1;
            continue;
        }
        if expect_private > 0 {
            private_lines.push(line.to_string());
            expect_private -= 1;
            continue;
        }

        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();

        match key {
            "PuTTY-User-Key-File-2" => {
                version = 2;
                algorithm = value.to_string();
            }
            "PuTTY-User-Key-File-3" => {
                version = 3;
                algorithm = value.to_string();
            }
            "Encryption" => encryption = value.to_string(),
            "Comment" => comment = value.to_string(),
            "Public-Lines" => expect_public = value.parse().unwrap_or(0),
            "Private-Lines" => expect_private = value.parse().unwrap_or(0),
            "Key-Derivation" => argon2_flavour = Some(value.to_string()),
            "Argon2-Memory" => argon2_memory = value.parse().ok(),
            "Argon2-Passes" => argon2_passes = value.parse().ok(),
            "Argon2-Parallelism" => argon2_parallelism = value.parse().ok(),
            "Argon2-Salt" => argon2_salt = hex::decode(value).ok(),
            "Private-MAC" => private_mac = value.to_string(),
            _ => {}
        }
    }

    if version == 0 || algorithm.is_empty() {
        anyhow::bail!("not a PuTTY PPK key file");
    }
    if private_mac.is_empty() {
        anyhow::bail!("PPK missing Private-MAC");
    }

    Ok(PpkFile {
        version,
        algorithm,
        encryption,
        comment,
        public: b64_body(&public_lines)?,
        private: b64_body(&private_lines)?,
        private_mac,
        argon2_flavour,
        argon2_memory,
        argon2_passes,
        argon2_parallelism,
        argon2_salt,
    })
}

fn argon2_algorithm(flavour: Option<&str>) -> anyhow::Result<argon2::Algorithm> {
    match flavour.unwrap_or("Argon2id") {
        "Argon2id" | "argon2id" => Ok(argon2::Algorithm::Argon2id),
        "Argon2i" | "argon2i" => Ok(argon2::Algorithm::Argon2i),
        "Argon2d" | "argon2d" => Ok(argon2::Algorithm::Argon2d),
        other => anyhow::bail!("unsupported PPK Key-Derivation '{other}'"),
    }
}

/// PPK3 Argon2 → 80 bytes: AES key (32) + IV (16) + MAC key (32).
fn derive_ppk3_material(file: &PpkFile, passphrase: &str) -> anyhow::Result<[u8; 80]> {
    let memory = file
        .argon2_memory
        .ok_or_else(|| anyhow::anyhow!("PPK3 missing Argon2-Memory"))?;
    let passes = file
        .argon2_passes
        .ok_or_else(|| anyhow::anyhow!("PPK3 missing Argon2-Passes"))?;
    let parallelism = file
        .argon2_parallelism
        .ok_or_else(|| anyhow::anyhow!("PPK3 missing Argon2-Parallelism"))?;
    let salt = file
        .argon2_salt
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("PPK3 missing Argon2-Salt"))?;
    let params = argon2::Params::new(memory, passes, parallelism, Some(80))
        .map_err(|e| anyhow::anyhow!("argon2 params: {e}"))?;
    let argon = argon2::Argon2::new(
        argon2_algorithm(file.argon2_flavour.as_deref())?,
        argon2::Version::V0x13,
        params,
    );
    let mut out = [0u8; 80];
    argon
        .hash_password_into(passphrase.as_bytes(), salt, &mut out)
        .map_err(|e| anyhow::anyhow!("argon2: {e}"))?;
    Ok(out)
}

fn verify_ppk_mac(file: &PpkFile, passphrase: Option<&str>, private_plain: &[u8]) -> anyhow::Result<()> {
    let enc = if is_unencrypted(&file.encryption) {
        "none"
    } else {
        file.encryption.as_str()
    };
    let mut mac_data = Vec::new();
    mac_data.extend_from_slice(&ssh_string_bytes(file.algorithm.as_bytes()));
    mac_data.extend_from_slice(&ssh_string_bytes(enc.as_bytes()));
    mac_data.extend_from_slice(&ssh_string_bytes(file.comment.as_bytes()));
    mac_data.extend_from_slice(&ssh_string_bytes(&file.public));
    mac_data.extend_from_slice(&ssh_string_bytes(private_plain));

    let expected = hex::decode(file.private_mac.trim())
        .map_err(|_| anyhow::anyhow!("PPK Private-MAC is not valid hex"))?;

    if file.version >= 3 {
        // Unencrypted PPK3 omits Argon2 headers; MAC uses a zero-length HMAC-SHA-256 key.
        // Encrypted PPK3: MAC key is bytes 48..80 of Argon2 output.
        let mut mac = if is_unencrypted(&file.encryption) {
            HmacSha256::new_from_slice(&[])
                .map_err(|e| anyhow::anyhow!("hmac: {e}"))?
        } else {
            let phrase = passphrase
                .filter(|p| !p.is_empty())
                .ok_or_else(|| anyhow::anyhow!("KEY_NEEDS_PASSPHRASE"))?;
            let out = derive_ppk3_material(file, phrase)?;
            HmacSha256::new_from_slice(&out[48..80])
                .map_err(|e| anyhow::anyhow!("hmac: {e}"))?
        };
        mac.update(&mac_data);
        mac.verify_slice(&expected)
            .map_err(|_| anyhow::anyhow!("PPK MAC check failed (wrong passphrase or corrupt file)"))?;
    } else {
        // PPK2: SHA1("putty-private-key-file-mac-key" [|| passphrase])
        let mut key_material = b"putty-private-key-file-mac-key".to_vec();
        if enc != "none" {
            let phrase = passphrase
                .filter(|p| !p.is_empty())
                .ok_or_else(|| anyhow::anyhow!("KEY_NEEDS_PASSPHRASE"))?;
            key_material.extend_from_slice(phrase.as_bytes());
        }
        let mut h = Sha1::new();
        h.update(&key_material);
        let mac_key = h.finalize();
        let mut mac = HmacSha1::new_from_slice(&mac_key)
            .map_err(|e| anyhow::anyhow!("hmac: {e}"))?;
        mac.update(&mac_data);
        mac.verify_slice(&expected)
            .map_err(|_| anyhow::anyhow!("PPK MAC check failed (wrong passphrase or corrupt file)"))?;
    }
    Ok(())
}

fn derive_aes_key_iv(file: &PpkFile, passphrase: &str) -> anyhow::Result<([u8; 32], [u8; 16])> {
    if file.version >= 3 {
        let out = derive_ppk3_material(file, passphrase)?;
        let mut key = [0u8; 32];
        let mut iv = [0u8; 16];
        key.copy_from_slice(&out[..32]);
        iv.copy_from_slice(&out[32..48]);
        Ok((key, iv))
    } else {
        // PPK2: SHA1(be32(0)||pass) || SHA1(be32(1)||pass) || SHA1(be32(2)||pass)
        let mut material = Vec::with_capacity(60);
        for counter in 0u32..3 {
            let mut h = Sha1::new();
            h.update(counter.to_be_bytes());
            h.update(passphrase.as_bytes());
            material.extend_from_slice(&h.finalize());
        }
        let mut key = [0u8; 32];
        let mut iv = [0u8; 16];
        key.copy_from_slice(&material[..32]);
        iv.copy_from_slice(&material[32..48]);
        Ok((key, iv))
    }
}

fn decrypt_private(file: &PpkFile, passphrase: Option<&str>) -> anyhow::Result<Vec<u8>> {
    if is_unencrypted(&file.encryption) {
        return Ok(file.private.clone());
    }
    if file.encryption != "aes256-cbc" {
        anyhow::bail!("unsupported PPK encryption '{}'", file.encryption);
    }
    let phrase = passphrase
        .filter(|p| !p.is_empty())
        .ok_or_else(|| anyhow::anyhow!("KEY_NEEDS_PASSPHRASE"))?;
    let (key, iv) = derive_aes_key_iv(file, phrase)?;
    let mut buf = file.private.clone();
    if buf.len() % 16 != 0 {
        anyhow::bail!("encrypted PPK private blob has invalid length");
    }
    let decryptor = Aes256CbcDec::new_from_slices(&key, &iv)
        .map_err(|e| anyhow::anyhow!("ppk aes init: {e}"))?;
    let pt = decryptor
        .decrypt_padded::<NoPadding>(&mut buf)
        .map_err(|_| anyhow::anyhow!("Could not decrypt PPK. Wrong passphrase?"))?;
    Ok(pt.to_vec())
}

fn build_rsa(public: &[u8], private: &[u8], comment: &str) -> anyhow::Result<PrivateKey> {
    let mut po = 0usize;
    if read_string(public, &mut po)? != b"ssh-rsa" {
        anyhow::bail!("ppk public blob is not ssh-rsa");
    }
    let e = read_mpint(public, &mut po)?;
    let n = read_mpint(public, &mut po)?;

    let mut vo = 0usize;
    let d = read_mpint(private, &mut vo)?;
    let p = read_mpint(private, &mut vo)?;
    let q = read_mpint(private, &mut vo)?;
    let _iqmp = read_mpint(private, &mut vo)?;

    let rsa_key = rsa::RsaPrivateKey::from_components(n, e, d, vec![p, q])
        .map_err(|err| anyhow::anyhow!("PPK RSA: {err}"))?;
    let keypair: RsaKeypair = rsa_key
        .try_into()
        .map_err(|err| anyhow::anyhow!("PPK RSA convert: {err}"))?;
    PrivateKey::new(KeypairData::Rsa(keypair), comment.to_string())
        .map_err(|e| anyhow::anyhow!("{e}"))
}

fn build_ed25519(public: &[u8], private: &[u8], comment: &str) -> anyhow::Result<PrivateKey> {
    let mut po = 0usize;
    if read_string(public, &mut po)? != b"ssh-ed25519" {
        anyhow::bail!("ppk public blob is not ssh-ed25519");
    }
    let pk = read_string(public, &mut po)?;
    let mut vo = 0usize;
    let seed = read_string(private, &mut vo)?;
    if seed.len() != 32 || pk.len() != 32 {
        anyhow::bail!("ppk: invalid ed25519 key lengths");
    }
    let keypair = Ed25519Keypair::from_seed(seed.try_into().unwrap());
    if keypair.public.as_ref() != pk {
        anyhow::bail!("ppk: ed25519 public key does not match seed");
    }
    PrivateKey::new(KeypairData::Ed25519(keypair), comment.to_string())
        .map_err(|e| anyhow::anyhow!("{e}"))
}

fn build_ecdsa(algorithm: &str, private: &[u8], comment: &str) -> anyhow::Result<PrivateKey> {
    let mut vo = 0usize;
    let scalar = read_string(private, &mut vo)?;
    let scalar = scalar.strip_prefix(&[0]).unwrap_or(scalar);

    let keypair = match algorithm {
        "ecdsa-sha2-nistp256" => {
            let sk = p256::SecretKey::from_slice(scalar)
                .map_err(|e| anyhow::anyhow!("PPK P-256: {e}"))?;
            let public = sk.public_key();
            EcdsaKeypair::NistP256 {
                private: sk.into(),
                public: public.into(),
            }
        }
        "ecdsa-sha2-nistp384" => {
            let sk = p384::SecretKey::from_slice(scalar)
                .map_err(|e| anyhow::anyhow!("PPK P-384: {e}"))?;
            let public = sk.public_key();
            EcdsaKeypair::NistP384 {
                private: sk.into(),
                public: public.into(),
            }
        }
        "ecdsa-sha2-nistp521" => {
            let sk = p521::SecretKey::from_slice(scalar)
                .map_err(|e| anyhow::anyhow!("PPK P-521: {e}"))?;
            let public = sk.public_key();
            EcdsaKeypair::NistP521 {
                private: sk.into(),
                public: public.into(),
            }
        }
        other => anyhow::bail!("unsupported PPK ECDSA '{other}'"),
    };
    PrivateKey::new(KeypairData::Ecdsa(keypair), comment.to_string())
        .map_err(|e| anyhow::anyhow!("{e}"))
}

fn build_key(
    algorithm: &str,
    public: &[u8],
    private: &[u8],
    comment: &str,
) -> anyhow::Result<PrivateKey> {
    match algorithm {
        "ssh-rsa" => build_rsa(public, private, comment),
        "ssh-ed25519" => build_ed25519(public, private, comment),
        "ecdsa-sha2-nistp256" | "ecdsa-sha2-nistp384" | "ecdsa-sha2-nistp521" => {
            build_ecdsa(algorithm, private, comment)
        }
        "ssh-dss" => anyhow::bail!(
            "PPK DSA is legacy. Convert with: puttygen key.ppk -O private-openssh -o id_dsa"
        ),
        "ssh-ed448" => anyhow::bail!("Ed448 PPK keys are not supported yet."),
        other => anyhow::bail!("unsupported PPK algorithm '{other}'"),
    }
}

pub fn looks_like_ppk(text: &str) -> bool {
    text.lines()
        .next()
        .is_some_and(|l| l.starts_with("PuTTY-User-Key-File-"))
}

pub fn parse_ppk(text: &str, passphrase: Option<&str>) -> anyhow::Result<PrivateKey> {
    let file = parse_ppk_text(text)?;
    let private = decrypt_private(&file, passphrase)?;
    // MAC is always over the decrypted private blob (incl. PKCS-style padding bytes).
    verify_ppk_mac(&file, passphrase, &private)?;
    let key = build_key(&file.algorithm, &file.public, &private, &file.comment)?;
    // Ensure the reconstructed public key matches the PPK public blob.
    let encoded = key
        .public_key()
        .to_bytes()
        .map_err(|e| anyhow::anyhow!("ppk public encode: {e}"))?;
    if encoded.as_slice() != file.public.as_slice() {
        anyhow::bail!("PPK private key does not match its public blob (wrong passphrase?)");
    }
    // Prove the key can sign (same path russh uses for SSH auth).
    russh_keys::helpers::sign_workaround(&key, b"azalea-ppk-check")
        .map_err(|e| anyhow::anyhow!("PPK key failed sign check: {e}"))?;
    Ok(key)
}
