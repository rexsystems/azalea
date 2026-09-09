# azalea-server

Self-hostable Azalea sync API (Rust + SQLite + Docker). AGPL-3.0-or-later.

- API: [`docs/sync-api-v1.md`](../../docs/sync-api-v1.md)
- **Install on a VPS (no source):** [`docs/self-host.md`](../../docs/self-host.md)

## Quick: empty VPS

```bash
mkdir -p ~/azalea && cd ~/azalea
curl -fsSL -o docker-compose.yml \
  https://raw.githubusercontent.com/rexsystems/azalea/master/services/azalea-server/docker-compose.yml
cat > .env <<EOF
AZALEA_JWT_SECRET=$(openssl rand -hex 32)
AZALEA_SETUP_SECRET=$(openssl rand -hex 16)
AZALEA_PUBLIC_WEB_URL=https://yourdomain.com
EOF
docker compose pull && docker compose up -d
curl -s http://127.0.0.1:8787/v1/health
```

Image: `ghcr.io/rexsystems/azalea-server:latest`

## Dev (from this folder)

```bash
export AZALEA_JWT_SECRET=dev-secret
export AZALEA_SETUP_SECRET=setup
cargo run
```

Build image locally:

```bash
docker compose -f docker-compose.build.yml up -d --build
```

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
