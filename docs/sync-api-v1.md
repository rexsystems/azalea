# Azalea Sync API v1

Self-hostable zero-knowledge vault sync. Desktop and `azalea-server-web` talk
to this HTTP API.

Base URL examples:

- Self-host: `https://sync.example.com` or `http://host:9482`

Personal cloud sync (Google Drive / OneDrive / Dropbox) does not use this HTTP
API; see [`cloud-sync.md`](./cloud-sync.md).

All JSON. Errors: `{ "error": "code", "message": "..." }` with a suitable HTTP
status.

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

Requires Resend (`RESEND_API_KEY`). Always returns ok if mail is configured (no
email enumeration). Without mail config → `400`.

```json
{ "email": "..." }
```

### `POST /v1/auth/reset-password`

```json
{ "token": "...", "password": "..." }
```

Invalid/expired token → `400`. Success revokes all sessions for that user.

### Desktop authorize handoff

Web `/authorize` still POSTs `{ refresh_token, state }` to
`http://127.0.0.1:<port>/callback`. Desktop exchanges via `/v1/auth/refresh`.

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
  "plan": "team",
  "plan_name": "Team",
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
  "captcha_provider": "none" | "turnstile",
  "captcha_site_key": "...",
  "captcha_secret_key": "...",
  "free_limit_bytes": 262144,
  "pro_limit_bytes": 10485760
}
```

GET includes `captcha_secret_configured` instead of the secret, `instance_name`,
and a `plans` array (see below). PATCH accepts the instance name, registration and
captcha fields and the legacy Free/Pro quota fields. The legacy fields stay in
sync with the corresponding plans.

### `GET /v1/admin/plans` / `POST /v1/admin/plans`

GET returns plan records: `id`, `name`, `limit_bytes` and `user_count`.

```json
{ "id": "team", "name": "Team", "limit_bytes": 20971520 }
```

POST creates a plan. IDs are stable, start with a lowercase letter and use up to
40 lowercase letters, digits, hyphens or underscores. `personal` and `all` are
reserved. Display names contain 1 to 80 characters; quotas range from 1024 to
1073741824 bytes. Duplicate IDs return `409`.

### `PATCH /v1/admin/plans/:id` / `DELETE /v1/admin/plans/:id`

PATCH accepts `name` and/or `limit_bytes`. It immediately changes the quota for
users who follow that plan, while preserving individual overrides. DELETE returns
`409` if users still use the plan. The default `free` and `pro` plans cannot be
deleted. Missing plans return `404`.

### `GET /v1/admin/users`

List users, including `plan`, `plan_name`, `vault_bytes`, `vault_limit_bytes`,
`quota_override_bytes` (null means follow plan), role, disabled flag and timestamps.

### `POST /v1/admin/users`

```json
{ "email": "...", "password": "...", "role": "user", "plan": "team", "quota_override_bytes": 4194304 }
```

### `PATCH /v1/admin/users/:id`

POST accepts any existing plan ID (defaults to `free`) and an optional individual
quota. Administrators can create users when public signup is disabled.

PATCH accepts `disabled`, `role`, `plan`, `password` and `quota_override_bytes`.
Use `{ "reset_quota": true }` to remove an override and follow the current plan.
Omitting quota fields preserves the override, including when changing plans.
Sending a quota and `reset_quota: true` together returns `400`. The last active
administrator cannot be disabled or demoted.

The effective quota is returned by `/v1/account` and enforced on every vault
upload. Lowering a limit does not delete a saved vault; smaller uploads remain
possible. Vault requests are read with a per-account body limit, including JSON
overhead, rather than the framework's default 2 MiB limit.

## Health

### `GET /v1/health`

```json
{ "ok": true, "version": "0.1.0", "mail_configured": true }
```

Mail is configured via env: `RESEND_API_KEY`, `AZALEA_MAIL_FROM`,
`AZALEA_PUBLIC_WEB_URL`.

## Desktop account model (client)

Not server-side. Local registry:

```json
{
  "id": "uuid",
  "kind": "selfhost" | "offline" | "gdrive" | "onedrive" | "dropbox",
  "label": "Work",
  "base_url": "https://...",
  "email": "..."
}
```

Each account has its own local SQLite + keyring tokens + vault unlock state.

## Crypto (unchanged from current client)

Argon2id + AES-256-GCM vault, verifier, recovery envelope. Server stores
text/base64 blobs only.
