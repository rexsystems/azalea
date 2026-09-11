# Azalea security model

This document explains the trust boundaries in Azalea, what we defend against,
what we do not, and how to report vulnerabilities.

## Reporting

Email **security@rexsystems.me** with:

- Component (`apps/desktop`, `services/azalea-server`, `apps/azalea-web`, telemetry, or CI).
- Version or commit.
- Reproduction steps.
- Expected impact.

Do not open a public GitHub issue for anything you believe is exploitable.
We aim to acknowledge within 72 hours. Coordinated disclosure is welcome; we
will credit you in the release notes unless you ask otherwise.

## Components and trust boundaries

| Component | Runs as | Trust level | Notes |
|---|---|---|---|
| `apps/desktop` (Tauri client) | End user | User-trusted | Holds decrypted secrets in memory. |
| `services/azalea-server` | User (self-host) or Rexsystems (cloud) | Sees only ciphertext | Never handles vault plaintext. |
| `apps/azalea-web` (in-repo) | Static export behind nginx | Public | Login and admin UI for the sync API. |
| `~/projects/azalea-web` (marketing) | Cloudflare Pages | Public | No secrets; no auth surface. |
| `azalea-telemetry` (private) | Rexsystems only | Opt-in, aggregate | Not part of the sync trust chain. |

Users choose the sync server (cloud or self-host). The desktop app never sends
vault plaintext to any server; the sync API only stores an opaque encrypted
blob. Telemetry is an entirely separate service and is not consulted for
sync, auth, or updates.

## Threat model

We assume the attacker can:

- **Observe the network.** All production traffic uses TLS. The desktop app
  refuses `http://` sync URLs unless the host is `localhost` or an RFC1918
  private IP.
- **Compromise the sync server.** They will see ciphertext and metadata but
  no vault contents. AEAD (AES-256-GCM) with AAD binds each ciphertext to
  `(account_id, version, kdf_salt)` so blobs cannot be swapped between
  accounts, rolled back to older versions, or replayed cross-account.
- **Own the remote SSH server the user connects to.** They can display
  arbitrary text in the terminal (which the user must not blindly paste).
  We pin modern SSH KEX / cipher / MAC lists and drop HMAC-SHA1 by default
  (opt out with `AZALEA_ALLOW_LEGACY_SSH=1`). SFTP downloads are constrained
  to `$HOME`; uploads reject reads from `~/.ssh`, `~/.gnupg`, `~/.aws`,
  `~/.azure`, `~/.kube`, `~/.docker`, and `~/.password-store`. Terminal
  hyperlinks (OSC 8) are validated to `https://`, `mailto:`, or `http://www.`
  only.
- **Trick the user through the web UI.** Web login uses HttpOnly Secure
  SameSite refresh cookies; access tokens live 10 minutes and are not
  exposed to JavaScript. Desktop handoff uses PKCE (S256) with single-use
  handles and 60-second codes; the desktop client verifies the returned
  callback state and refuses non-loopback callback ports. Reset-password
  tokens are stripped from the URL bar on load.
- **Guess passwords.** Auth endpoints are rate-limited per IP and per
  identifier-hash. Login and register run in constant time (missing users
  still see a dummy Argon2id verify) and never leak whether a specific
  account exists. Password KDF is Argon2id with server-side parameters
  chosen to burn > 100 ms per attempt.
- **Reach the marketing site or admin panel.** Both sites ship strict CSP,
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
  and a locked-down `Permissions-Policy`. The desktop Tauri window sets
  `frame-ancestors 'none'`.

We do **not** defend against:

- **A compromised end-user device.** If an attacker has root on the user's
  machine, they can read decrypted secrets from process memory or the
  keychain. Encrypted-at-rest is defense in depth against offline theft of
  the app's data directory, not against active local attackers.
- **A malicious SSH server exfiltrating what the user types in that server's
  terminal.** SSH does not (and cannot) sandbox what the remote shell shows.
- **Users who paste installer commands from untrusted sources.** We publish
  our own `install.sh` and recommend digest-pinning docker pulls, but
  ultimately a shell one-liner runs on trust.

## Cryptography summary

- **Password -> KEK.** Argon2id with per-account salt (>= 16 bytes,
  `OsRng`).
- **Vault encryption.** AES-256-GCM AEAD. Blob layout `[0x02 | nonce(12) |
  ciphertext]` for the current v2 format. AAD =
  `"azalea-vault-v1|" + account_id + "|" + version + "|" + kdf_salt` and
  binds every ciphertext to its account and monotonically increasing
  version. Legacy v1 blobs (no AAD) still decrypt for one-shot
  migration; new writes are always v2.
- **Sync rollback protection.** `keep_cloud` refuses any remote vault whose
  `version <= last_known_version`.
- **Sync auth.** JWT access tokens (10 min). Refresh tokens live in
  HttpOnly Secure SameSite=Lax cookies on the web client and in the OS
  keychain on desktop. Sessions are revoked on password change and admin
  disable.
- **CAPTCHA.** Cloudflare Turnstile on register / forgot / reset endpoints.
- **CSRF.** SameSite=Lax cookies plus a bespoke `x-azalea-client` header
  requirement on refresh; desktop clients send `x-azalea-client: desktop`.

## Build & release integrity

- All GitHub Actions are SHA-pinned in `.github/workflows/*.yml`.
- Tauri signing secrets (`TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]`) are only
  in the env of the specific build and signer steps, not job-wide.
- `services/azalea-server/install.sh` refuses `curl | sh` of external
  installers, requires Docker via the OS package manager, and prints the
  resolved image digest after `docker compose up -d`. Consumers are pointed
  at `ghcr.io/rexsystems/azalea-server@sha256:...` for pinned installs.
- Sensitive filename patterns (`*.pem`, `*.key`, `*.p12`, `id_rsa*`,
  `minisign.key`, etc.) are in `.gitignore` to prevent accidental commits.

## Dependency audits

See [`security-audit.md`](./security-audit.md) for the current list of
`cargo audit` / `npm audit` findings and the acceptance rationale for
each. Re-run before every release:

```bash
cd services/azalea-server && cargo audit
cd apps/desktop/src-tauri && cargo audit
cd apps/desktop && npm audit --omit=dev
cd apps/azalea-web && npm audit --omit=dev
```

## Deployment checklist

When operating a self-hosted `azalea-server`:

- Set `AZALEA_JWT_SECRET` to a random 32-byte value; the server refuses to
  boot in prod without one.
- Set `AZALEA_ALLOWED_ORIGINS` to the origins that will host the web
  client; the server sends `Access-Control-Allow-Credentials: true` and
  requires an explicit allowlist.
- Terminate TLS in front of the server (nginx, Caddy, Cloudflare, etc.).
  Refresh cookies are set `Secure` unless
  `AZALEA_ALLOW_INSECURE_COOKIE=1` **and** the listen address is loopback.
- Rotate `TELEMETRY_ADMIN_TOKEN` if you fork the telemetry service; it
  must be at least 24 characters, and the service refuses to boot in prod
  without one.
