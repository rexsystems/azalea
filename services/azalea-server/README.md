# azalea-server

Self-hostable Azalea sync API (Rust + SQLite + Docker). AGPL-3.0-or-later.

API: [`docs/sync-api-v1.md`](../../docs/sync-api-v1.md)  
VPS guide: [`docs/self-host.md`](../../docs/self-host.md)

## Dev

```bash
cd services/azalea-server
export AZALEA_JWT_SECRET=dev-secret
export AZALEA_SETUP_SECRET=setup
cargo run
```

```bash
curl -s localhost:8787/v1/health
```

Bootstrap:

```bash
curl -s localhost:8787/v1/setup/bootstrap -H 'content-type: application/json' -d '{
  "setup_secret":"setup",
  "admin_email":"admin@example.com",
  "admin_password":"password123",
  "instance_name":"Home"
}'
```

## Docker image

Build locally:

```bash
cd services/azalea-server
docker build -t azalea-server:local .
docker run --rm -p 8787:8787 \
  -e AZALEA_JWT_SECRET=dev \
  -e AZALEA_SETUP_SECRET=setup \
  -v azalea-data:/data \
  azalea-server:local
```

Compose (recommended):

```bash
cp .env.example .env
# edit secrets
docker compose up -d --build
```

Published image (when CI has run): `ghcr.io/rexsystems/azalea-server:latest`

### Env

| Variable | Required | Purpose |
|---|---|---|
| `AZALEA_JWT_SECRET` | yes | Access token signing |
| `AZALEA_SETUP_SECRET` | recommended | Protects first-admin bootstrap |
| `AZALEA_DATA_DIR` | no (default `/data`) | SQLite directory |
| `AZALEA_BIND` | no (default `0.0.0.0:8787`) | Listen address |
| `RESEND_API_KEY` | no | Password-reset email via Resend |
| `AZALEA_MAIL_FROM` | no | From header for Resend |
| `AZALEA_PUBLIC_WEB_URL` | no | Base URL for reset links |

License: AGPL-3.0-or-later.
