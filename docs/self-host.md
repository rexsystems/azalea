# Self-host azalea-server

## Fresh VPS (recommended): one script

No git clone. Asks questions, writes compose/.env, **pulls published Docker
images**, starts the server, creates the admin. Web front is optional.
Falls back to a local source build only if GHCR pull fails.

```bash
curl -fsSL https://azalea.rexsystems.me/script.sh | bash
```

Or straight from GitHub:

```bash
curl -fsSL https://raw.githubusercontent.com/rexsystems/azalea/master/services/azalea-server/install.sh | bash
```

Prompts read from your terminal (works with `curl | bash`). If that fails on a weird host:

```bash
curl -fsSL -o install.sh \
  https://raw.githubusercontent.com/rexsystems/azalea/master/services/azalea-server/install.sh
chmod +x install.sh
./install.sh
```

The script asks for:
- public domain (optional)
- admin email / password
- Resend mail (optional)
- whether you want the **optional** web dashboard on **:9843**
- bind to localhost vs public :9482

Default install dir: `~/azalea` (or `/root/azalea` when run as root).

## Wipe and reinstall from zero

```bash
cd ~/azalea   # or /root/azalea
docker compose down -v
docker rm -f $(docker ps -aq --filter name=azalea) 2>/dev/null || true
docker image rm ghcr.io/rexsystems/azalea-server:latest ghcr.io/rexsystems/azalea-web:latest \
  azalea-server:local azalea-web:local 2>/dev/null || true
rm -rf ~/azalea   # or /root/azalea
curl -fsSL https://azalea.rexsystems.me/script.sh | bash
```

`down -v` deletes the SQLite volume (users / vaults). Skip `-v` if you want to keep data.

## Admin without web UI (CLI)

Prefer CLI on the server:

```bash
cd ~/azalea
docker compose exec azalea-server azalea-server user list
docker compose exec azalea-server azalea-server user create \
  --email someone@example.com --password 'at-least-8' --role user --plan free
docker compose exec azalea-server azalea-server user set-password \
  --email someone@example.com --password 'new-password'
docker compose exec azalea-server azalea-server user disable --email someone@example.com
docker compose exec azalea-server azalea-server user enable --email someone@example.com
docker compose exec azalea-server azalea-server user set-role --email someone@example.com --role admin
docker compose exec azalea-server azalea-server user set-plan --email someone@example.com --plan pro
docker compose exec azalea-server azalea-server settings show
docker compose exec azalea-server azalea-server settings signup --enabled false
```

First admin (if you skipped the installer bootstrap):

```bash
docker compose exec azalea-server azalea-server bootstrap \
  --email you@example.com --password 'at-least-8' --instance Home
```

## Manual install (no script)

### 1. Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
# re-login
```

### 2. Files only

```bash
mkdir -p ~/azalea && cd ~/azalea

curl -fsSL -o docker-compose.yml \
  https://raw.githubusercontent.com/rexsystems/azalea/master/services/azalea-server/docker-compose.yml

cat > .env <<EOF
AZALEA_JWT_SECRET=$(openssl rand -hex 32)
RESEND_API_KEY=
AZALEA_MAIL_FROM=Azalea <noreply@yourdomain.com>
AZALEA_PUBLIC_WEB_URL=https://yourdomain.com
EOF

docker compose pull
docker compose up -d
# optional web on :9843:
# docker compose --profile web up -d
curl -s http://127.0.0.1:9482/v1/health
```

Images must be **Public** on GHCR for anonymous pull:

1. Org packages: https://github.com/organizations/rexsystems/settings/packages  
   Under **Package creation**, enable **Public**.
2. Open each package:  
   https://github.com/orgs/rexsystems/packages/container/package/azalea-server  
   https://github.com/orgs/rexsystems/packages/container/package/azalea-web  
3. **Package settings** → **Danger Zone** → **Change visibility** → Public.

Notes:
- Org packages start **private** on first publish. CI usually cannot flip that.
- Rebuilding / pushing new tags does **not** flip a Public package back to private.
- If it looks private again, you probably got a **new** package name (e.g. first
  `azalea-web` publish) or the package was deleted and recreated.

Until Public, `docker pull` stays unauthorized and the installer falls back to building from source.

### 3. HTTPS / Cloudflare

API routes are `/v1/...`. Desktop self-host with `https://yourdomain.com` expects
API at `https://yourdomain.com/api` (proxy strips `/api`).

**Caddy**

```caddy
yourdomain.com {
  handle_path /api/* {
    reverse_proxy 127.0.0.1:9482
  }
}
```

**Nginx**

```nginx
location /api/ {
  proxy_pass http://127.0.0.1:9482/;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

**Cloudflare Tunnel** straight to the container: use the tunnel hostname as the
API URL in the app (no `/api` strip). Or tunnel into Caddy with `/api`.

### 4. Desktop

Add account -> Self-hosted -> `https://yourdomain.com` (or `http://IP:9482`).

## Optional web front (monorepo `apps/azalea-web`)

Installer can pull `ghcr.io/rexsystems/azalea-web:latest` on host port **9843**
(maps to container `:80`). Put Cloudflare Tunnel or host nginx on `:80` if you want
that. Nginx in the web image proxies `/api` to `azalea-server`. Sync itself does
not need the web container.

Public product site (landing, download): **https://azalea.rexsystems.me** (separate repo).

## Updates

```bash
cd ~/azalea
docker compose pull
docker compose up -d
```

Backup = Docker volume with SQLite under `/data`.

## Build from source

```bash
git clone https://github.com/rexsystems/azalea.git
cd azalea/services/azalea-server
cp .env.example .env
docker compose -f docker-compose.build.yml up -d --build
```

## Related

- [Sync API](./sync-api-v1.md)
- [Cloud sync overview](./cloud-sync.md)
- Server: `services/azalea-server/`
