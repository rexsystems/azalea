# Self-host azalea-server (VPS)

Run your own sync API with Docker. Desktop talks to it; optional azalea-web for
login / admin / password reset.

## What you need

- A VPS with Docker + Docker Compose
- A domain (or Cloudflare Tunnel hostname)
- Strong secrets for JWT + setup

## 1. Build the image (local)

From the monorepo:

```bash
cd services/azalea-server
docker build -t azalea-server:local .
```

Or pull from GHCR when published:

```bash
docker pull ghcr.io/rexsystems/azalea-server:latest
```

## 2. Deploy with Compose

On the VPS:

```bash
mkdir -p ~/azalea-server && cd ~/azalea-server
# copy docker-compose.yml + .env.example from the repo, or clone the monorepo
cp .env.example .env
nano .env   # set secrets (see below)
docker compose up -d --build
curl -s http://127.0.0.1:8787/v1/health
```

### `.env`

```env
AZALEA_JWT_SECRET=$(openssl rand -hex 32)
AZALEA_SETUP_SECRET=$(openssl rand -hex 16)

# Optional password-reset mail (Resend)
RESEND_API_KEY=
AZALEA_MAIL_FROM=Azalea <noreply@yourdomain.com>
AZALEA_PUBLIC_WEB_URL=https://yourdomain.com
```

Data lives in the `azalea-data` Docker volume (SQLite under `/data`).

## 3. Reverse proxy (recommended)

Routes on the API are `/v1/...` (no `/api` prefix). Desktop self-host URLs use
`https://yourdomain.com` → API base `https://yourdomain.com/api`.

So the proxy must **strip** `/api` when forwarding.

### Caddy

```caddy
yourdomain.com {
  handle_path /api/* {
    reverse_proxy 127.0.0.1:8787
  }
  # optional: serve azalea-web static files, or proxy another app
}
```

### Nginx

```nginx
location /api/ {
  proxy_pass http://127.0.0.1:8787/;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

### Cloudflare Tunnel

Point the tunnel public hostname at `http://127.0.0.1:8787` **or** put Caddy/Nginx
in front and tunnel to that. If the public URL is `https://sync.example.com` with
no path, either:

- tell desktop the API URL is `https://sync.example.com` (direct, no `/api`), or
- put `/api` strip in front and use `https://sync.example.com` in the app so it hits `/api`.

## 4. First admin (bootstrap)

```bash
curl -s https://yourdomain.com/api/v1/setup/status
# {"needs_setup":true,"mail_configured":false}

curl -s https://yourdomain.com/api/v1/setup/bootstrap \
  -H 'content-type: application/json' \
  -d '{
    "setup_secret":"YOUR_SETUP_SECRET",
    "admin_email":"you@example.com",
    "admin_password":"at-least-8-chars",
    "instance_name":"Home"
  }'
```

Or open azalea-web `/setup` with `NEXT_PUBLIC_AZALEA_API_URL=https://yourdomain.com/api`.

## 5. Point the desktop app

First-run or **Add account → Self-hosted**:

- `https://yourdomain.com` → uses `https://yourdomain.com/api`
- `http://VPS_IP:8787` → direct (no `/api`)
- `https://yourdomain.com/api` → explicit API path

Then sign in from Settings.

## 6. Updates

```bash
cd ~/azalea-server
docker compose pull   # if using GHCR
# or rebuild from git:
docker compose up -d --build
```

Backup = copy the Docker volume / SQLite file under `/data`.

## Firewall

- Prefer exposing only 80/443 (proxy) or the tunnel; keep `8787` bound to localhost if possible.
- If you publish `8787` directly, use TLS somehow (Caddy, Traefik, or Cloudflare).

## Related

- [Sync API](./sync-api-v1.md)
- [Cloud sync overview](./cloud-sync.md)
- Server crate: `services/azalea-server/`
