# Self-host azalea-server

## Fresh VPS (no git, no source)

You only need Docker. The image is built by CI and published to GHCR.

### 1. Install Docker (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install -y ca-certificates curl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
# log out / back in so docker works without sudo
```

### 2. Drop two files on the box

```bash
mkdir -p ~/azalea && cd ~/azalea

curl -fsSL -o docker-compose.yml \
  https://raw.githubusercontent.com/rexsystems/azalea/master/services/azalea-server/docker-compose.yml

curl -fsSL -o .env.example \
  https://raw.githubusercontent.com/rexsystems/azalea/master/services/azalea-server/.env.example

cp .env.example .env
```

Edit secrets:

```bash
nano .env
```

```env
AZALEA_JWT_SECRET=   # openssl rand -hex 32
AZALEA_SETUP_SECRET= # openssl rand -hex 16

# optional mail
RESEND_API_KEY=
AZALEA_MAIL_FROM=Azalea <noreply@yourdomain.com>
AZALEA_PUBLIC_WEB_URL=https://yourdomain.com
```

Generate secrets:

```bash
echo "AZALEA_JWT_SECRET=$(openssl rand -hex 32)" >> .env
echo "AZALEA_SETUP_SECRET=$(openssl rand -hex 16)" >> .env
# then remove the placeholder lines from .env (or overwrite cleanly)
```

Cleaner one-shot:

```bash
cat > .env <<EOF
AZALEA_JWT_SECRET=$(openssl rand -hex 32)
AZALEA_SETUP_SECRET=$(openssl rand -hex 16)
RESEND_API_KEY=
AZALEA_MAIL_FROM=Azalea <noreply@yourdomain.com>
AZALEA_PUBLIC_WEB_URL=https://yourdomain.com
EOF
```

### 3. Pull and run

If the GHCR package is **public**:

```bash
docker compose pull
docker compose up -d
curl -s http://127.0.0.1:8787/v1/health
```

If pull says unauthorized (private package), either make the package public on GitHub
(Packages → azalea-server → Package settings → Change visibility), or:

```bash
echo YOUR_GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin
docker compose pull
docker compose up -d
```

### 4. Create the first admin

```bash
curl -s http://127.0.0.1:8787/v1/setup/bootstrap \
  -H 'content-type: application/json' \
  -d "{
    \"setup_secret\":\"$(grep AZALEA_SETUP_SECRET .env | cut -d= -f2)\",
    \"admin_email\":\"you@example.com\",
    \"admin_password\":\"pick-a-long-password\",
    \"instance_name\":\"Home\"
  }"
```

### 5. Put HTTPS in front

API paths are `/v1/...`. Desktop self-host with `https://yourdomain.com` expects
API at `https://yourdomain.com/api` (proxy must strip `/api`).

**Caddy**

```caddy
yourdomain.com {
  handle_path /api/* {
    reverse_proxy 127.0.0.1:8787
  }
}
```

**Nginx**

```nginx
location /api/ {
  proxy_pass http://127.0.0.1:8787/;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

Then in Azalea desktop: **Add account → Self-hosted →** `https://yourdomain.com`

### 6. Updates later

```bash
cd ~/azalea
docker compose pull
docker compose up -d
```

Backup = Docker volume `azalea-data` (SQLite).

---

## Cloudflare Tunnel only

Run the container (port 8787 on localhost), point the tunnel at
`http://127.0.0.1:8787`. In the app use the tunnel hostname **directly**
(e.g. `https://azalea-api.example.com`) - no `/api` strip needed if the
tunnel hits the container 1:1.

Or tunnel → Caddy with `/api` strip if web + API share one hostname.

---

## Build from source (optional)

Only if you have the repo / want a custom build:

```bash
git clone https://github.com/rexsystems/azalea.git
cd azalea/services/azalea-server
cp .env.example .env && nano .env
docker compose -f docker-compose.build.yml up -d --build
```

---

## Related

- [Sync API](./sync-api-v1.md)
- [Cloud sync overview](./cloud-sync.md)
- Server: `services/azalea-server/`
