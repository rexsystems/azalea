# Azalea Cloud Sync

Zero-knowledge sync of hosts, groups, keys, snippets, forwards, and settings across
devices. The server stores only ciphertext.

**Backend:** self-hostable [`azalea-server`](../services/azalea-server/) (Rust + SQLite).
API: [`sync-api-v1.md`](./sync-api-v1.md). Deploy: [`self-host.md`](./self-host.md).

Azalea Cloud is a hosted instance of the same stack. Desktop can also point at your
own server (first-run wizard / account switcher).

## Principles

- **Zero-knowledge**: encrypt/decrypt only on the client. The API sees opaque blobs.
- **Master passphrase ≠ account password.** The account authenticates; the passphrase decrypts.
- **Reuse**: the vault is the `AzaleaBackup` format from `backup.rs`.
- Forgotten passphrase = lost data. A **recovery key** is shown once at setup.

## Cryptography

| What | How |
|---|---|
| Key derivation | Argon2id (m=64MB, t=3, p=1) from master passphrase + per-user salt |
| Vault encryption | AES-256-GCM, random nonce per push |
| Passphrase check | small `verifier` blob encrypted with the same key |
| Recovery key | 32-byte random key that encrypts a copy of the vault key (envelope) |

## Auth + vault

- Email/password against `azalea-server` (`/v1/auth/*`)
- Vault REST: `GET` / `PUT` / `DELETE /v1/vault` with optimistic locking on `version`
- Browser login via azalea-web `/authorize`, then refresh token handoff to the desktop app

## Desktop

- Multi-account: Cloud + N self-host + offline (isolated local DB per account)
- Config: `AZALEA_API_URL` / `AZALEA_WEB_URL` in `azalea.public.env` (Cloud defaults);
  self-host accounts override per entry
- Self-host URL: public domain → API at `/api` (see `lib/selfhostUrl.ts`)

## Ops

- [Self-host on a VPS](./self-host.md)
- [Sync API v1](./sync-api-v1.md)
- Server README: `services/azalea-server/README.md`
