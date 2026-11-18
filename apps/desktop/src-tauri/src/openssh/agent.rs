//! Minimal ssh-agent (list identities + sign) over a Unix socket. Keys are read
//! from the active Azalea profile on each request and never written to disk.

use std::path::{Path, PathBuf};

use russh::keys::signature::Signer;
use russh::keys::ssh_encoding::Encode;
use russh::keys::{HashAlg, PrivateKey, PublicKey};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{UnixListener, UnixStream};

use crate::store::SharedDatabase;

const MAX_FRAME: usize = 256 * 1024;
const FAILURE: u8 = 5;
const REQUEST_IDENTITIES: u8 = 11;
const IDENTITIES_ANSWER: u8 = 12;
const SIGN_REQUEST: u8 = 13;
const SIGN_RESPONSE: u8 = 14;
const RSA_SHA2_256: u32 = 2;
const RSA_SHA2_512: u32 = 4;

struct Identity {
    key_id: String,
    blob: Vec<u8>,
    comment: String,
}

pub trait KeySource: Clone + Send + Sync + 'static {
    /// `(key id, OpenSSH public key line, comment)` for every usable key.
    fn public_keys(&self) -> Vec<(String, String, String)>;
    fn private_key(&self, key_id: &str) -> anyhow::Result<PrivateKey>;
}

impl KeySource for AppHandle {
    fn public_keys(&self) -> Vec<(String, String, String)> {
        self.state::<SharedDatabase>()
            .lock()
            .list_keys()
            .map(|keys| {
                keys.into_iter()
                    .map(|k| (k.id, k.public_key, k.name))
                    .collect()
            })
            .unwrap_or_default()
    }

    fn private_key(&self, key_id: &str) -> anyhow::Result<PrivateKey> {
        crate::keys::load_key_pair(key_id)
    }
}

fn identities(source: &impl KeySource) -> Vec<Identity> {
    source
        .public_keys()
        .into_iter()
        .filter_map(|(key_id, public_key, comment)| {
            let public = PublicKey::from_openssh(public_key.trim()).ok()?;
            let mut blob = Vec::new();
            public.key_data().encode(&mut blob).ok()?;
            Some(Identity {
                key_id,
                blob,
                comment,
            })
        })
        .collect()
}

fn put_string(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    out.extend_from_slice(bytes);
}

fn take_string<'a>(buf: &mut &'a [u8]) -> Option<&'a [u8]> {
    let len = u32::from_be_bytes(buf.get(..4)?.try_into().ok()?) as usize;
    let value = buf.get(4..4 + len)?;
    *buf = &buf[4 + len..];
    Some(value)
}

fn sign(key: &PrivateKey, data: &[u8], flags: u32) -> anyhow::Result<Vec<u8>> {
    let signature = match key.key_data() {
        russh::keys::ssh_key::private::KeypairData::Rsa(rsa) => {
            let hash = if flags & RSA_SHA2_256 != 0 {
                Some(HashAlg::Sha256)
            } else if flags & RSA_SHA2_512 != 0 {
                Some(HashAlg::Sha512)
            } else {
                None
            };
            Signer::try_sign(&(rsa, hash), data)?
        }
        other => Signer::try_sign(other, data)?,
    };
    let mut encoded = Vec::new();
    signature.encode(&mut encoded)?;
    Ok(encoded)
}

async fn respond<K: KeySource>(source: &K, request: &[u8]) -> Vec<u8> {
    let mut reply = Vec::new();
    match request.split_first() {
        Some((&REQUEST_IDENTITIES, _)) => {
            let ids = identities(source);
            reply.push(IDENTITIES_ANSWER);
            reply.extend_from_slice(&(ids.len() as u32).to_be_bytes());
            for id in &ids {
                put_string(&mut reply, &id.blob);
                put_string(&mut reply, id.comment.as_bytes());
            }
        }
        Some((&SIGN_REQUEST, mut rest)) => {
            let parsed = (|| {
                let blob = take_string(&mut rest)?.to_vec();
                let data = take_string(&mut rest)?.to_vec();
                let flags = u32::from_be_bytes(rest.get(..4)?.try_into().ok()?);
                Some((blob, data, flags))
            })();
            let signed = match parsed {
                Some((blob, data, flags)) => {
                    match identities(source).into_iter().find(|id| id.blob == blob) {
                        Some(id) => {
                            let source = source.clone();
                            tauri::async_runtime::spawn_blocking(move || {
                                sign(&source.private_key(&id.key_id)?, &data, flags)
                            })
                            .await
                            .ok()
                            .and_then(Result::ok)
                        }
                        None => None,
                    }
                }
                None => None,
            };
            match signed {
                Some(signature) => {
                    reply.push(SIGN_RESPONSE);
                    put_string(&mut reply, &signature);
                }
                None => reply.push(FAILURE),
            }
        }
        // Add/remove/lock requests are refused: keys are managed in Azalea.
        _ => reply.push(FAILURE),
    }
    reply
}

async fn serve_connection<K: KeySource>(source: K, mut stream: UnixStream) -> std::io::Result<()> {
    loop {
        let mut len = [0u8; 4];
        stream.read_exact(&mut len).await?;
        let len = u32::from_be_bytes(len) as usize;
        if len == 0 || len > MAX_FRAME {
            return Ok(());
        }
        let mut request = vec![0u8; len];
        stream.read_exact(&mut request).await?;
        let reply = respond(&source, &request).await;
        stream
            .write_all(&(reply.len() as u32).to_be_bytes())
            .await?;
        stream.write_all(&reply).await?;
    }
}

pub fn socket_path(home: &Path) -> PathBuf {
    home.join(".azalea").join("agent.sock")
}

pub async fn run<K: KeySource>(source: K, socket: PathBuf) -> anyhow::Result<()> {
    if let Some(dir) = socket.parent() {
        super::config::create_private_dir(dir)?;
    }
    // The single-instance plugin means nothing else owns this socket.
    let _ = std::fs::remove_file(&socket);
    let listener = UnixListener::bind(&socket)?;
    super::config::restrict(&socket)?;
    loop {
        let (stream, _) = listener.accept().await?;
        let source = source.clone();
        tauri::async_runtime::spawn(async move {
            let _ = serve_connection(source, stream).await;
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn string_round_trip() {
        let mut buf = Vec::new();
        put_string(&mut buf, b"abc");
        put_string(&mut buf, b"");
        let mut view = buf.as_slice();
        assert_eq!(take_string(&mut view), Some(&b"abc"[..]));
        assert_eq!(take_string(&mut view), Some(&b""[..]));
        assert_eq!(take_string(&mut view), None);
    }

    #[derive(Clone)]
    struct Fixed(std::sync::Arc<Vec<(String, PrivateKey)>>);

    impl KeySource for Fixed {
        fn public_keys(&self) -> Vec<(String, String, String)> {
            self.0
                .iter()
                .map(|(id, k)| (id.clone(), k.public_key().to_openssh().unwrap(), id.clone()))
                .collect()
        }

        fn private_key(&self, key_id: &str) -> anyhow::Result<PrivateKey> {
            Ok(self
                .0
                .iter()
                .find(|(id, _)| id == key_id)
                .unwrap()
                .1
                .clone())
        }
    }

    fn openssh(args: &[&str], sock: &Path, dir: &Path) -> std::process::Output {
        std::process::Command::new(args[0])
            .args(&args[1..])
            .env("SSH_AUTH_SOCK", sock)
            .current_dir(dir)
            .output()
            .unwrap()
    }

    /// Drives the agent with the system OpenSSH client; skipped where it is absent.
    #[tokio::test]
    async fn openssh_client_can_list_and_sign() {
        if std::process::Command::new("ssh-keygen")
            .arg("-?")
            .output()
            .is_err()
        {
            return;
        }
        let mut rng = russh::keys::key::safe_rng();
        let keys = vec![
            (
                "ed".to_string(),
                PrivateKey::random(&mut rng, russh::keys::Algorithm::Ed25519).unwrap(),
            ),
            (
                "rsa".to_string(),
                PrivateKey::random(&mut rng, russh::keys::Algorithm::Rsa { hash: None }).unwrap(),
            ),
        ];
        let dir = std::env::temp_dir().join(format!("azalea-agent-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let sock = dir.join("agent.sock");
        let task = tokio::spawn(run(Fixed(std::sync::Arc::new(keys.clone())), sock.clone()));
        while !sock.exists() {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }

        let (sock2, dir2) = (sock.clone(), dir.clone());
        tokio::task::spawn_blocking(move || {
            let listed = openssh(&["ssh-add", "-L"], &sock2, &dir2);
            assert!(listed.status.success(), "{listed:?}");
            let listed = String::from_utf8(listed.stdout).unwrap();
            assert_eq!(listed.lines().count(), 2);

            for (id, key) in &keys {
                let public = dir2.join(format!("{id}.pub"));
                std::fs::write(&public, key.public_key().to_openssh().unwrap()).unwrap();
                std::fs::write(dir2.join("msg"), b"hello").unwrap();
                let signed = openssh(
                    &[
                        "ssh-keygen",
                        "-Y",
                        "sign",
                        "-n",
                        "file",
                        "-f",
                        public.to_str().unwrap(),
                        "msg",
                    ],
                    &sock2,
                    &dir2,
                );
                assert!(signed.status.success(), "{id}: {signed:?}");
                let check = std::process::Command::new("sh")
                    .arg("-c")
                    .arg(format!(
                        "ssh-keygen -Y check-novalidate -n file -f {id}.pub -s msg.sig < msg"
                    ))
                    .current_dir(&dir2)
                    .output()
                    .unwrap();
                assert!(check.status.success(), "{id}: {check:?}");
                std::fs::remove_file(dir2.join("msg.sig")).unwrap();
            }
        })
        .await
        .unwrap();

        task.abort();
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn truncated_string_is_rejected() {
        let mut view: &[u8] = &[0, 0, 0, 9, 1, 2];
        assert_eq!(take_string(&mut view), None);
    }
}
