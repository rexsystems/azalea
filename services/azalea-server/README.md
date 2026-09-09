# azalea-server

Self-hostable Azalea sync API (Rust + SQLite + Docker). AGPL-3.0-or-later.

- API: [`docs/sync-api-v1.md`](../../docs/sync-api-v1.md)
- **VPS install:** [`docs/self-host.md`](../../docs/self-host.md)

## Install on an empty VPS

```bash
curl -fsSL https://raw.githubusercontent.com/rexsystems/azalea/master/services/azalea-server/install.sh | bash
```

Interactive: secrets, domain, Resend, optional web UI tip, pull image (or build from
source if GHCR is private), bootstrap admin.

Image: `ghcr.io/rexsystems/azalea-server:latest`

## CLI (users without web admin)

```bash
azalea-server bootstrap --email admin@x.com --password 'secret123' --instance Home
azalea-server user list
azalea-server user create --email u@x.com --password 'secret123'
azalea-server user set-password --email u@x.com --password 'newpass'
azalea-server user disable --email u@x.com
azalea-server settings signup --enabled false
azalea-server serve   # or just: azalea-server
```

With Docker Compose:

```bash
docker compose exec azalea-server azalea-server user list
```

## Dev

```bash
export AZALEA_JWT_SECRET=dev-secret
cargo run -- serve
# or cargo run   (defaults to serve)
```

Build image locally:

```bash
docker compose -f docker-compose.build.yml up -d --build
```

### Env

| Variable | Required | Purpose |
|---|---|---|
| `AZALEA_JWT_SECRET` | yes | Access token signing |
| `AZALEA_DATA_DIR` | no (default `/data`) | SQLite directory |
| `AZALEA_BIND` | no (default `0.0.0.0:8787`) | Listen address |
| `RESEND_API_KEY` | no | Password-reset email via Resend |
| `AZALEA_MAIL_FROM` | no | From header for Resend |
| `AZALEA_PUBLIC_WEB_URL` | no | Base URL for reset links |

License: AGPL-3.0-or-later.
