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
- whether to include the optional dashboard or use only the API/admin CLI
- access mode: local/LAN, Cloudflare Tunnel, or your HTTPS reverse proxy
- public hostname for HTTPS modes
- admin email / password
- Resend mail (optional)
- API and dashboard host ports (defaults **9482** and **9843**)
- optional host update manager on Linux/systemd

Default install dir: `~/azalea` (or `/root/azalea` when run as root).
Published server and dashboard images support **Linux AMD64 and ARM64** under
the same tags. Docker selects the host architecture automatically, including
ARM64 VPS hosts and Raspberry Pi with a 64-bit OS. The source-build fallback
also builds natively for the host. ARMv7/32-bit ARM images are not provided.
Administrator creation is mandatory: the installer verifies the configured email
is an active admin in the running server's `/data/azalea.db` and stops on failure.
Rerunning the installer on a running installation without an active administrator
offers to repair that account setup while preserving the existing configuration.
To recover a previous incomplete install without deleting its volume, run
`docker compose exec azalea-server azalea-server bootstrap --email=you@example.com --instance=Azalea`
with `AZALEA_BOOTSTRAP_PASSWORD` supplied to that exec process, or use the documented
bootstrap password option below. Existing active admin credentials are never reset
by bootstrap; repeating it succeeds only with the same verified account/password.
An existing installation is not overwritten. Use update commands to upgrade it,
or `AZALEA_INSTALL_DIR` to create a separate instance.

Local/LAN mode exposes the selected dashboard port, or the API port for a
CLI-only setup. The desktop app accepts HTTP on localhost/private network
addresses. Public connections use HTTPS. The installer enables HTTP browser
cookies only for local/LAN dashboard mode; HTTPS modes retain secure cookies.

Cloudflare/HTTPS modes bind host ports to localhost. With a dashboard, route
the hostname to `http://127.0.0.1:9843` (or your selected dashboard port).
With API/CLI only, route it to `http://127.0.0.1:9482` (or your API host port).
The generated `cloudflared.example.yml` uses the hostname and port you chose.
For a tunnel running in Docker, join the Compose network and use
`http://azalea-server-web:80` or `http://azalea-server:9482` instead.

In both HTTPS modes the desktop server address is `https://your-hostname`.
API-only installations use email/password sign-in; browser authorization and
password-reset pages require a dashboard. A CLI-only install can configure
mail only if you supply an existing compatible password-reset web host.

## Wipe and reinstall from zero

```bash
cd ~/azalea   # or /root/azalea
docker compose down -v
docker rm -f $(docker ps -aq --filter name=azalea) 2>/dev/null || true
docker image rm ghcr.io/rexsystems/azalea-server:latest ghcr.io/rexsystems/azalea-server-web:latest \
  azalea-server:local azalea-server-web:local 2>/dev/null || true
rm -rf ~/azalea   # or /root/azalea
curl -fsSL https://azalea.rexsystems.me/script.sh | bash
```

`down -v` deletes the SQLite volume (users / vaults). Skip `-v` if you want to keep data.

## Shared AI in the dashboard

Open **Admin → AI** to add provider connections and their API keys. Save the
connection before loading its model catalog, enable the models you want to
offer, then choose the default and enable server AI. Providers without a
compatible catalog, including Bedrock Runtime, accept exact model IDs.

In the desktop app, sign in to this self-hosted account and select
**Self-hosted server** in AI settings. The app loads the server's models and
default automatically. Requests use the current account session; provider
keys stay on the server. Conversation and terminal context sent to AI pass
through this server to the chosen provider.

Provider keys are encrypted at rest. By default the encryption key is derived
from `AZALEA_JWT_SECRET`; retain that secret with your database backup.
Alternatively set `AZALEA_AI_ENCRYPTION_KEY` to a stable 64-character hex key
before saving provider credentials, and retain it in backups. Changing either
encryption source requires saving provider keys again. Rate and output limits
are configured on the same AI page.

The self-hosted dashboard source is `apps/azalea-server-web`; the API is
`services/azalea-server`. Docker installs use the `azalea-server-web` image.

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
   https://github.com/orgs/rexsystems/packages/container/package/azalea-server-web  
3. **Package settings** → **Danger Zone** → **Change visibility** → Public.

Notes:
- Org packages start **private** on first publish. CI usually cannot flip that.
- Rebuilding / pushing new tags does **not** flip a Public package back to private.
- If it looks private again, you probably got a **new** package name (e.g. first
  `azalea-server-web` publish) or the package was deleted and recreated.

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
  # Older builds set Path=/v1/auth; browsers hit /api/v1/auth/* — rewrite or
  # the refresh cookie never gets sent (401 on /api/v1/auth/refresh).
  proxy_cookie_path /v1/auth /api/v1/auth;
}
```

**Cloudflare Tunnel** straight to the container: use the tunnel hostname as the
API URL in the app (no `/api` strip). Or tunnel into Caddy with `/api`.

### 4. Desktop

Add account -> Self-hosted -> `https://yourdomain.com` (or `http://IP:9482`).

## Optional web front (monorepo `apps/azalea-server-web`)

Installer can pull `ghcr.io/rexsystems/azalea-server-web:latest` on host port **9843**
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

These commands preserve the data volume, but do not make a backup or provide
automatic rollback. Source-built installations must refresh their source
build contexts and run `docker compose up -d --build` instead. Pinned image
digests must be changed explicitly before a manual update.

### Managed updates

The optional host manager supports **API/CLI-only and dashboard installations**.
It runs on Linux with Docker Compose and systemd. The server exchanges bounded
update requests through a shared directory; it has no Docker socket mount.
The manager checks tagged public GHCR images every six hours and applies updates
only when requested. Custom registries, digest-pinned and source-built images
retain their manual update workflow.

Fresh installs offer to enable the manager. For an existing installation, first
upgrade to a server image that includes the update commands, then run on its host:

```bash
cd /path/to/your/azalea-installation
curl -fsSL https://raw.githubusercontent.com/rexsystems/azalea/master/services/azalea-server/update-manager.py -o update-manager.py
sudo python3 update-manager.py --directory "$PWD" install
```

Setup attaches the shared request directory, restarts the API, and enables a
per-installation systemd service.

For a custom Compose setup, add `--compose-file /path/to/base.yaml`, repeat
`--extra-compose-file /path/to/override.yaml` for additional configuration,
and supply `--project-name` if you used `docker compose -p`. Setup refuses to
drop Compose files that were used by the existing server container.

Follow progress in **Admin → Updates**, or use the CLI:

```bash
docker compose exec azalea-server azalea-server update check
docker compose exec azalea-server azalea-server update status
docker compose exec azalea-server azalea-server update apply
docker compose exec azalea-server azalea-server update status
docker compose exec azalea-server azalea-server update rollback
```

Commands queue an operation; use `status` again to see its result. Host CLI
equivalents are `sudo python3 update-manager.py --directory "$PWD" status`
and `check`, `apply`, `rollback`. Dashboard access through Cloudflare uses the
same authenticated `/api` calls; the manager has no public endpoint.

An update downloads exact checked image digests before stopping the API. It
then saves an integrity-checked SQLite snapshot, Compose configuration, `.env`
and local rollback image tags. Server and installed dashboard are recreated
and health-checked. A failed restart triggers recovery of the previous images,
database and configuration. The manager also resumes interrupted recovery
after a host/service restart.

Rollback restores the **pre-update database and configuration**, replacing later
changes. Replaced database/configuration files are retained alongside the backup
for recovery. Backups and secrets are stored in the root-only
`.azalea-update-manager/backups` directory and are not automatically pruned.
Keep off-host backups as well.

The manager stores image overrides separately. For host maintenance commands
that recreate containers, include those files so you keep the managed image
and request directory:

```bash
sudo docker compose -f docker-compose.yml \
  -f azalea-updater.compose.json \
  -f .azalea-update-manager/images.compose.json up -d
```

The image override is created after the first managed update/rollback; omit it
before then. Include any existing custom Compose override files too.

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
