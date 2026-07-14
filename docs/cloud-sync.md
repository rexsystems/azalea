# Azalea Cloud Sync — Plan (Supabase)

Zero-knowledge sync al datelor (hosts, groups, snippets, port forwards, settings,
known hosts, chei + parole) între device-uri, per cont. Serverul stochează doar
ciphertext — un breach la Supabase nu expune nimic.

## Principii

- **Zero-knowledge**: criptare/decriptare exclusiv pe client. Supabase vede doar blob-uri opace.
- **Master passphrase ≠ parola de cont.** Contul autentifică; passphrase-ul decriptează.
- **Reuse**: vault-ul este exact formatul `AzaleaBackup` din `backup.rs` (există deja export/import complet, inclusiv secrete).
- Passphrase uitat = date pierdute. Oferim **recovery key** generat la setup (o cheie random afișată o singură dată, stil Bitwarden).

## Criptografie

| Ce | Cum |
|---|---|
| Derivare cheie | Argon2id (m=64MB, t=3, p=1) din master passphrase + salt per user |
| Criptare vault | AES-256-GCM, nonce random per push, AAD = user_id + version |
| Verificare passphrase | un mic `verifier` blob criptat cu aceeași cheie (decriptezi ok = passphrase corect) |
| Recovery key | cheie random de 32 bytes care criptează o copie a cheii de vault (envelope) |

Crate-uri Rust: `argon2`, `aes-gcm`, `rand`. Totul în backend-ul Tauri (nu în JS).

## Supabase

- **Auth**: email + parolă (supabase auth built-in). Mai târziu OAuth GitHub/Google.
- **Schema** (un singur tabel + RLS):

```sql
create table vaults (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version bigint not null default 0,
  kdf_salt text not null,
  verifier text not null,          -- blob mic criptat, pt. check passphrase
  recovery_envelope text,          -- cheia vault criptată cu recovery key
  ciphertext text not null,        -- vault-ul AES-GCM, base64
  updated_at timestamptz not null default now()
);

alter table vaults enable row level security;
create policy "own vault" on vaults for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- Acces din client prin **REST-ul PostgREST al Supabase** (fetch simplu cu JWT), nu SDK JS —
  ținem HTTP-ul în Rust (`reqwest`) ca să treacă tot prin backend.
- Push cu **optimistic locking**: `update ... where version = :expected` — dacă 0 rânduri
  afectate, altcineva a pushuit între timp → pull + resolve.

## Flow-uri

**Setup (prima activare sync):**
1. Sign up / login (email+parolă) → JWT salvat în keyring
2. Setezi master passphrase → generăm salt, derivăm cheia, creăm verifier + recovery key (afișat o dată)
3. Push inițial: export vault → criptare → insert

**Device nou:**
1. Login → pull metadata (salt, verifier)
2. Introduci passphrase → derivăm cheia → verificăm pe verifier
3. Pull ciphertext → decriptare → import (flow-ul de import backup existent, mod replace)

**Sync (faza 1 = manual, buton "Sync now"):**
- Pull: dacă `remote.version > local.version` → decrypt + import
- Push: dacă avem modificări locale → export + encrypt + update cu optimistic lock
- Conflict (ambele modificate): dialog "Keep local / Keep cloud" (faza 1, brutal și clar)

## Implementare — fișiere

**Rust (nou):**
- `src-tauri/src/sync/mod.rs` — client Supabase (auth, pull, push), tipuri
- `src-tauri/src/sync/crypto.rs` — Argon2id + AES-GCM + verifier + recovery envelope
- Comenzi Tauri: `sync_signup`, `sync_login`, `sync_logout`, `sync_status`,
  `sync_setup_passphrase`, `sync_unlock`, `sync_now`
- Keyring: `sync-jwt`, `sync-refresh-token`, opțional cheia derivată (session-only, în memorie)
- `Cargo.toml`: + `reqwest` (rustls), `argon2`, `aes-gcm`

**DB local:**
- tabel `sync_meta (key, value)` — last_synced_version, user_email, kdf_salt cache

**Frontend:**
- `SettingsPage` → secțiune "Account & Sync": login/signup form, status (last sync, version),
  buton Sync now, setup passphrase dialog, recovery key dialog
- `lib/api.ts` — wrappere pt. comenzile de sync
- Config: Supabase URL + anon key în constantă (anon key e public prin design, RLS protejează)

**Ce NU facem în faza 1:**
- Auto-sync pe fiecare modificare (faza 2, cu debounce + merge per-record pe `updated_at`)
- Merge granular / CRDT — faza 1 e whole-vault, last-writer-wins cu dialog la conflict
- Sharing / team vaults

## Pași concreți pentru mâine (ordine)

1. [ ] Proiect Supabase + tabelul `vaults` + RLS (rulează `supabase/schema.sql` în SQL editor)
2. [x] `sync/crypto.rs`: derive + encrypt/decrypt + verifier + teste unitare
3. [x] `sync/mod.rs`: auth (signup/login/refresh) + pull/push REST
4. [x] Comenzi Tauri + wire în `lib.rs`
5. [x] UI Settings: login → setup passphrase → sync now (happy path)
6. [x] Device-nou flow (unlock cu passphrase pe cont existent)
7. [x] Conflict dialog + recovery key dialog
8. [ ] Test end-to-end cu 2 instanțe (dev + build)

Estimare: 1–2 (pct. 1–5 într-o zi; 6–8 a doua zi).
