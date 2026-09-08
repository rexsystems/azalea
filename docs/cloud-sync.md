# Azalea Cloud Sync

> **Migration in progress.** The self-hostable Rust API is documented in
> [`sync-api-v1.md`](./sync-api-v1.md). Server crate: `services/azalea-server`.
> The sections below describe the current Supabase-backed desktop client until
> cutover.

---

Zero-knowledge sync of data (hosts, groups, snippets, port forwards, settings,
known hosts, keys + passwords) across devices, per account. The server stores
only ciphertext - a breach exposes nothing readable.

## Principles

- **Zero-knowledge**: encrypt/decrypt only on the client. Supabase sees opaque blobs.
- **Master passphrase ≠ account password.** The account authenticates; the passphrase decrypts.
- **Reuse**: the vault is exactly the `AzaleaBackup` format from `backup.rs` (full export/import already exists, including secrets).
- Forgotten passphrase = lost data. We offer a **recovery key** generated at setup (a random key shown once).

## Cryptography

| What | How |
|---|---|
| Key derivation | Argon2id (m=64MB, t=3, p=1) from master passphrase + per-user salt |
| Vault encryption | AES-256-GCM, random nonce per push |
| Passphrase check | small `verifier` blob encrypted with the same key (successful decrypt = correct passphrase) |
| Recovery key | 32-byte random key that encrypts a copy of the vault key (envelope) |

Rust crates: `argon2`, `aes-gcm`, `rand`. All in the Tauri backend (not JS).

## Supabase

- **Auth**: email + password (built-in Supabase auth). OAuth GitHub/Google later.
- **Schema** (single table + RLS):

```sql
create table vaults (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version bigint not null default 0,
  kdf_salt text not null,
  verifier text not null,          -- small encrypted blob for passphrase check
  recovery_envelope text,          -- vault key encrypted with recovery key
  ciphertext text not null,        -- AES-GCM vault, base64
  updated_at timestamptz not null default now()
);

alter table vaults enable row level security;
create policy "own vault" on vaults for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- Client access via **Supabase PostgREST** (simple fetch with JWT), not the JS SDK -
  keep HTTP in Rust (`reqwest`) so everything goes through the backend.
- Push with **optimistic locking**: `update ... where version = :expected` - if 0 rows
  affected, someone else pushed in the meantime → pull + resolve.

## Flows

**Setup (first sync activation):**
1. Sign up / login (email+password) → JWT stored in keyring
2. Set master passphrase → generate salt, derive key, create verifier + recovery key (shown once)
3. Initial push: export vault → encrypt → insert

**New device:**
1. Login → pull metadata (salt, verifier)
2. Enter passphrase → derive key → verify against verifier
3. Pull ciphertext → decrypt → import (existing backup import flow, replace mode)

**Sync (phase 1 = manual, "Sync now" button):**
- Pull: if `remote.version > local.version` → decrypt + import
- Push: if we have local changes → export + encrypt + update with optimistic lock
- Conflict (both modified): "Keep local / Keep cloud" dialog

## Implementation - files

**Rust (new):**
- `src-tauri/src/sync/mod.rs` - Supabase client (auth, pull, push), types
- `src-tauri/src/sync/crypto.rs` - Argon2id + AES-GCM + verifier + recovery envelope
- Tauri commands: `sync_signup`, `sync_login`, `sync_logout`, `sync_status`,
  `sync_setup_passphrase`, `sync_unlock`, `sync_now`
- Keyring: `sync-jwt`, `sync-refresh-token`, optional derived key (session-only, in memory)
- `Cargo.toml`: + `reqwest` (rustls), `argon2`, `aes-gcm`

**Local DB:**
- `sync_meta (key, value)` table - last_synced_version, user_email, kdf_salt cache

**Frontend:**
- `SettingsPage` → "Account & Sync" section: login/signup form, status (last sync, version),
  Sync now button, setup passphrase dialog, recovery key dialog
- `lib/api.ts` - wrappers for sync commands
- Config: Supabase URL + anon key as constants (anon key is public by design; RLS protects data)

**Out of scope for phase 1:**
- Auto-sync on every change (phase 2, with debounce + per-record merge on `updated_at`)
- Granular merge / CRDT - phase 1 is whole-vault, last-writer-wins with conflict dialog
- Sharing / team vaults

## Concrete next steps (order)

1. [ ] Supabase project + `vaults` table + RLS (run `supabase/schema.sql` in the SQL editor)
2. [x] `sync/crypto.rs`: derive + encrypt/decrypt + verifier + unit tests
3. [x] `sync/mod.rs`: auth (signup/login/refresh) + pull/push REST
4. [x] Tauri commands + wire in `lib.rs`
5. [x] Settings UI: login → setup passphrase → sync now (happy path)
6. [x] New-device flow (unlock with passphrase on existing account)
7. [x] Conflict dialog + recovery key dialog
8. [ ] End-to-end test with 2 instances (dev + build)

Estimate: 1-2 days (items 1-5 in one day; 6-8 the next).
