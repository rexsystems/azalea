# Azalea sync

Zero-knowledge sync of hosts, groups, keys, and settings across devices.
Ciphertext only leaves the device - never the master passphrase or vault key.

## Backends

| Kind | Storage | Auth |
|---|---|---|
| **Local** | This device only | - |
| **Google Drive / OneDrive / Dropbox** | App folder in the user’s own cloud | OAuth (PKCE), no API keys from the user |
| **Self-hosted** | Your [`azalea-server`](../services/azalea-server/) | Email/password or browser PKCE |

Azalea Cloud (hosted RexSystems API) is removed from the desktop app. Self-host
and personal cloud cover the same jobs.

API for self-host: [`sync-api-v1.md`](./sync-api-v1.md). Deploy: [`self-host.md`](./self-host.md).

## Principles

- **Zero-knowledge:** encrypt and decrypt only on the client.
- **Master passphrase ≠ provider login.** OAuth opens the storage; the
  passphrase decrypts the vault.
- **Reuse:** the vault is the `AzaleaBackup` format from `backup.rs`.
- Forgotten passphrase means lost data. A **recovery key** is shown once at
  setup.

## Cryptography

| What | How |
|---|---|
| Key derivation | Argon2id (m=64MB, t=3, p=1) from master passphrase + per-user salt |
| Vault encryption | AES-256-GCM, random nonce per push, AAD bound to provider user id + version |
| Passphrase check | small `verifier` blob encrypted with the same key |
| Recovery key | 32-byte random key that encrypts a copy of the vault key (envelope) |

## Personal cloud

- Desktop opens the provider’s OAuth page (loopback redirect + PKCE).
- Client IDs are baked into the app (`AZALEA_GOOGLE_CLIENT_ID`,
  `AZALEA_MICROSOFT_CLIENT_ID`, `AZALEA_DROPBOX_CLIENT_ID`). Users never paste
  secrets.
- Vault file: `azalea-vault.json` in the provider app folder / appdata.
- Conflicts use the same keep-local / keep-remote UX as self-host (optimistic
  version in the JSON; ETag / rev when the provider supports it).

## Self-host

- Email/password or browser login against `azalea-server` (`/v1/auth/*`)
- Vault REST: `GET` / `PUT` / `DELETE /v1/vault` with optimistic locking on
  `version`

## Desktop

- Multi-account: personal cloud + N self-host + local (isolated DB per account)
- Self-host URL: public domain → API at `/api` (see `lib/selfhostUrl.ts`)

## Smoke checklist

1. Fresh install → choose Google Drive / OneDrive / Dropbox → OAuth → set
   passphrase → recovery key shown once.
2. Second device → same provider account → unlock with passphrase → pull.
3. Edit hosts on A, sync; on B choose download when preview shows remote ahead.
4. Edit on both since last sync → conflict dialog → keep local / keep remote.
5. Revoke token / expire session → reconnect via Sign in with browser.
6. Self-host: connect URL + login → same vault setup / sync / conflict paths.
7. Local profile: no network sync UI beyond “local only”.

## Ops

- [Self-host on a VPS](./self-host.md)
- [Sync API v1](./sync-api-v1.md) (self-host HTTP)
- Server README: `services/azalea-server/README.md`
