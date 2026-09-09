# Azalea Sync API v1

Self-hostable zero-knowledge vault sync. Desktop and `azalea-web` talk to this HTTP API.
Desktop and `azalea-web` talk to this HTTP API only.

Base URL examples:

- Azalea Cloud: `https://api.azalea.rexsystems.me` (TBD at cutover)
- Self-host: `https://sync.example.com` or `http://host:8787`

All JSON. Errors: `{ "error": "code", "message": "..." }` with suitable HTTP status.

## Auth

### `POST /v1/auth/register`

Public when `signup_enabled`. Optional captcha fields.

```json
{ "email": "...", "password": "...", "captcha_token": "..." }
```

Returns session (same shape as login).

### `POST /v1/auth/login`

```json
{ "email": "...", "password": "..." }
```

Response:

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": 3600,
  "user": { "id": "uuid", "email": "...", "role": "user" | "admin" }
}
```

### `POST /v1/auth/refresh`

```json
{ "refresh_token": "..." }
```

Same session shape. Invalid refresh → `401`.

### `POST /v1/auth/logout`

Bearer access token. Revokes current refresh session.

### `POST /v1/auth/forgot-password`

Requires Resend (`RESEND_API_KEY`). Always returns ok if mail is configured (no email enumeration). Without mail config → `400`.

```json
{ "email": "..." }
```

### `POST /v1/auth/reset-password`

```json
{ "token": "...", "password": "..." }
```

Invalid/expired token → `400`. Success revokes all sessions for that user.

### Desktop authorize handoff

Web `/authorize` still POSTs `{ refresh_token, state }` to `http://127.0.0.1:<port>/callback`.
Desktop exchanges via `/v1/auth/refresh`.

## Vault (Bearer required)

Opaque client-encrypted fields only. Server never sees plaintext.

### `GET /v1/vault`

```json
{
  "exists": true,
  "version": 3,
  "kdf_salt": "...",
  "verifier": "...",
  "recovery_envelope": "...",
  "ciphertext": "...",
  "updated_at": "ISO-8601",
  "size_bytes": 12345
}
```

`exists: false` when no row yet (omit blob fields).

### `PUT /v1/vault`

Create or update with optimistic lock.

```json
{
  "expected_version": 3,
  "kdf_salt": "...",
  "verifier": "...",
  "recovery_envelope": "...",
  "ciphertext": "..."
}
```

- First create: `expected_version` = `0` or omit.
- Success: `{ "version": 4 }`
- Conflict (version mismatch): `409` `{ "error": "version_conflict", "current_version": 5 }`
- Over limit: `413` `{ "error": "storage_limit" }`

### `DELETE /v1/vault`

Deletes vault row for the user (account may remain).

### `GET /v1/account`

```json
{
  "email": "...",
  "role": "user",
  "plan": "free" | "pro",
  "vault_bytes": 12345,
  "vault_limit_bytes": 262144
}
```

## Setup (first boot)

No browser setup. First admin is created by `install.sh` or:

```bash
azalea-server bootstrap --email admin@example.com --password 'at-least-8' --instance Home
```

## Admin (role = admin)

### `GET /v1/admin/settings` / `PATCH /v1/admin/settings`

```json
{
  "signup_enabled": false,
  "captcha_provider": "none" | "turnstile" | "hcaptcha" | "recaptcha",
  "captcha_site_key": "...",
  "captcha_secret_key": "...",
  "free_limit_bytes": 262144,
  "pro_limit_bytes": 10485760
}
```

Secret key omitted or masked on GET.

### `GET /v1/admin/users`

List users + vault size + role + disabled flag.

### `POST /v1/admin/users`

```json
{ "email": "...", "password": "...", "role": "user" | "admin" }
```

### `PATCH /v1/admin/users/:id`

Disable/enable, role, plan.

## Health

### `GET /v1/health`

```json
{ "ok": true, "version": "0.1.0", "mail_configured": true }
```

Mail is configured via env: `RESEND_API_KEY`, `AZALEA_MAIL_FROM`, `AZALEA_PUBLIC_WEB_URL`.

## Desktop account model (client)

Not server-side. Local registry:

```json
{
  "id": "uuid",
  "kind": "cloud" | "selfhost" | "offline",
  "label": "Work",
  "base_url": "https://...",
  "email": "..."
}
```

Each account has its own local SQLite + keyring tokens + vault unlock state.

## Crypto (unchanged from current client)

Argon2id + AES-256-GCM vault, verifier, recovery envelope. Server stores text/base64 blobs only.
