#!/usr/bin/env bash
# Interactive installer for azalea-server on a fresh Linux VPS.
# Pulls GHCR image, or builds from GitHub if the package is private / missing.
set -euo pipefail

REPO="${AZALEA_REPO:-https://github.com/rexsystems/azalea.git}"
IMAGE="${AZALEA_IMAGE:-ghcr.io/rexsystems/azalea-server:latest}"
INSTALL_DIR="${AZALEA_INSTALL_DIR:-$HOME/azalea}"

step=0
total=7

progress() {
  step=$((step + 1))
  printf '\n[%s/%s] %s\n' "$step" "$total" "$1"
}

die() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

ask() {
  local prompt="$1"
  local default="${2-}"
  local reply
  if [[ ! -r /dev/tty ]]; then
    die "no terminal for prompts; run: bash install.sh"
  fi
  if [[ -n "$default" ]]; then
    read -r -p "$prompt [$default]: " reply < /dev/tty || true
    printf '%s\n' "${reply:-$default}"
  else
    read -r -p "$prompt: " reply < /dev/tty || true
    printf '%s\n' "$reply"
  fi
}

ask_secret() {
  local prompt="$1"
  local reply
  if [[ ! -r /dev/tty ]]; then
    die "no terminal for prompts; run: bash install.sh"
  fi
  # -s hides input; newline MUST go to the terminal, not stdout (stdout is captured)
  read -r -s -p "$prompt: " reply < /dev/tty || true
  echo >&2
  printf '%s\n' "$reply"
}

ask_yes_no() {
  local prompt="$1"
  local default="${2:-n}"
  local hint="y/N"
  [[ "$default" == "y" ]] && hint="Y/n"
  local reply
  if [[ ! -r /dev/tty ]]; then
    die "no terminal for prompts; run: bash install.sh"
  fi
  read -r -p "$prompt ($hint): " reply < /dev/tty || true
  reply="${reply:-$default}"
  case "${reply,,}" in
    y|yes) return 0 ;;
    *) return 1 ;;
  esac
}

write_compose_pull() {
  local ports="$1"
  cat > docker-compose.yml <<EOF
services:
  azalea-server:
    image: ${IMAGE}
    env_file:
      - .env
    ports:
      - "${ports}"
    environment:
      AZALEA_DATA_DIR: /data
      AZALEA_BIND: 0.0.0.0:9482
      RUST_LOG: azalea_server=info,tower_http=info
    volumes:
      - azalea-data:/data
    restart: unless-stopped

volumes:
  azalea-data:
EOF
}

write_compose_build() {
  local ports="$1"
  cat > docker-compose.yml <<EOF
services:
  azalea-server:
    build: ./build
    image: azalea-server:local
    env_file:
      - .env
    ports:
      - "${ports}"
    environment:
      AZALEA_DATA_DIR: /data
      AZALEA_BIND: 0.0.0.0:9482
      RUST_LOG: azalea_server=info,tower_http=info
    volumes:
      - azalea-data:/data
    restart: unless-stopped

volumes:
  azalea-data:
EOF
}

fetch_build_context() {
  need_cmd git
  local tmp
  tmp="$(mktemp -d)"
  printf 'Cloning %s (sparse, server only)...\n' "$REPO"
  git clone --depth 1 --filter=blob:none --sparse "$REPO" "$tmp/azalea"
  git -C "$tmp/azalea" sparse-checkout set services/azalea-server
  rm -rf build
  mkdir -p build
  cp -a "$tmp/azalea/services/azalea-server/." build/
  rm -rf "$tmp"
}

printf '\n== Azalea sync server installer ==\n'
printf 'Install dir: %s\n' "$INSTALL_DIR"
printf 'Image:       %s\n\n' "$IMAGE"

progress "Checking Docker"
if ! command -v docker >/dev/null 2>&1; then
  if ask_yes_no "Docker not found. Install via get.docker.com?" "y"; then
    need_cmd curl
    curl -fsSL https://get.docker.com | sh
    if command -v usermod >/dev/null 2>&1 && [[ "$(id -u)" -ne 0 ]]; then
      sudo usermod -aG docker "$USER" || true
      echo "You may need to log out/in for docker without sudo."
    fi
  else
    die "Docker is required"
  fi
fi
need_cmd docker
docker compose version >/dev/null 2>&1 || die "docker compose plugin required"

progress "Gathering config"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

domain="$(ask "Public domain (empty = IP/localhost only)" "")"
web_url="http://127.0.0.1:9482"
if [[ -n "$domain" ]]; then
  domain="${domain#https://}"
  domain="${domain#http://}"
  domain="${domain%/}"
  web_url="https://${domain}"
fi

admin_email="$(ask "Admin email" "admin@example.com")"
while true; do
  admin_pass="$(ask_secret "Admin password (min 8 chars)")"
  if [[ ${#admin_pass} -ge 8 ]]; then
    break
  fi
  echo "Password too short." >&2
done
instance="$(ask "Instance name" "Azalea")"

resend_key=""
mail_from="Azalea <onboarding@resend.dev>"
if ask_yes_no "Configure Resend for password-reset emails?" "n"; then
  resend_key="$(ask "RESEND_API_KEY" "")"
  mail_from="$(ask "From address" "Azalea <noreply@${domain:-example.com}>")"
fi

want_web=0
if ask_yes_no "Optional azalea-web UI later (browser login / admin pages)?" "n"; then
  want_web=1
fi

bind_localhost=0
if [[ -n "$domain" ]] && ask_yes_no "Bind API to 127.0.0.1 only (recommended behind Caddy/Nginx/Tunnel)?" "y"; then
  bind_localhost=1
fi

jwt_secret="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"

ports="9482:9482"
if [[ "$bind_localhost" -eq 1 ]]; then
  ports="127.0.0.1:9482:9482"
fi

progress "Writing .env and compose"
cat > .env <<EOF
AZALEA_JWT_SECRET=${jwt_secret}
RESEND_API_KEY=${resend_key}
AZALEA_MAIL_FROM=${mail_from}
AZALEA_PUBLIC_WEB_URL=${web_url}
EOF
chmod 600 .env

write_compose_pull "$ports"

progress "Pulling image (or building from source)"
use_build=0
if docker compose pull; then
  :
else
  echo "Could not pull ${IMAGE} (private package or missing)."
  echo "Falling back to build from GitHub source..."
  use_build=1
  fetch_build_context
  write_compose_build "$ports"
  docker compose build
fi

progress "Starting container"
# Previous failed runs often leave something on :9482
if docker compose ps -q 2>/dev/null | grep -q .; then
  docker compose down >/dev/null 2>&1 || true
fi
if command -v ss >/dev/null 2>&1 && ss -ltn | grep -q ':9482 '; then
  echo "Port 9482 is in use. Stopping leftover azalea containers if any..."
  docker ps --format '{{.ID}} {{.Names}} {{.Ports}}' | while read -r id name ports; do
    case "$ports" in
      *9482*) docker stop "$id" >/dev/null 2>&1 || true ;;
    esac
  done
  # Also stop any compose project named azalea*
  docker ps -a --format '{{.Names}}' | while read -r name; do
    case "$name" in
      *azalea*server*|azalea-*) docker rm -f "$name" >/dev/null 2>&1 || true ;;
    esac
  done
fi
if command -v ss >/dev/null 2>&1 && ss -ltn | grep -q ':9482 '; then
  die "port 9482 still in use. Free it (ss -ltnp | grep 9482) then re-run."
fi
docker compose up -d

progress "Waiting for health"
ok=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:9482/v1/health" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 2
done
[[ "$ok" -eq 1 ]] || die "server did not become healthy on :9482"

progress "Bootstrapping admin"
if docker compose exec -T azalea-server azalea-server bootstrap \
  --email "$admin_email" \
  --password "$admin_pass" \
  --instance "$instance"; then
  :
else
  echo "Bootstrap skipped or failed (maybe already done). Continuing." >&2
fi

printf '\n== Done ==\n'
printf 'API health:  http://127.0.0.1:9482/v1/health\n'
printf 'Admin:       %s\n' "$admin_email"
printf 'Data dir:    docker volume azalea_azalea-data (or azalea-data)\n'
printf 'Install dir: %s\n' "$INSTALL_DIR"
if [[ "$use_build" -eq 1 ]]; then
  printf 'Image mode:  built locally (azalea-server:local)\n'
else
  printf 'Image mode:  %s\n' "$IMAGE"
fi

printf '\nCLI (on this host):\n'
printf '  cd %s\n' "$INSTALL_DIR"
printf '  docker compose exec azalea-server azalea-server user list\n'
printf '  docker compose exec azalea-server azalea-server user create --email u@x.com --password secret123\n'
printf '  docker compose exec azalea-server azalea-server user set-password --email u@x.com --password newpass\n'
printf '  docker compose exec azalea-server azalea-server settings signup --enabled false\n'

if [[ -n "$domain" ]]; then
  printf '\nReverse proxy: desktop uses https://%s -> API at /api (strip /api).\n' "$domain"
  printf 'Caddy example:\n'
  printf '  %s {\n' "$domain"
  printf '    handle_path /api/* {\n'
  printf '      reverse_proxy 127.0.0.1:9482\n'
  printf '    }\n'
  printf '  }\n'
  printf '\nIn Azalea desktop: Add account -> Self-hosted -> https://%s\n' "$domain"
else
  printf '\nIn Azalea desktop: Add account -> Self-hosted -> http://YOUR_IP:9482\n'
fi

if [[ "$want_web" -eq 1 ]]; then
  api_public="http://127.0.0.1:9482"
  if [[ -n "$domain" ]]; then
    api_public="https://${domain}/api"
  fi
  printf '\nOptional web UI (azalea-web):\n'
  printf '  Deploy azalea-web with:\n'
  printf '    NEXT_PUBLIC_AZALEA_API_URL=%s\n' "$api_public"
  printf '    NEXT_PUBLIC_SITE_URL=%s\n' "$web_url"
  printf '  Routes: /login /admin /forgot-password (no browser setup wizard)\n'
else
  printf '\nWeb UI skipped. Manage users with the CLI above.\n'
fi

printf '\nUpdates later:\n'
if [[ "$use_build" -eq 1 ]]; then
  printf '  cd %s && rm -rf build && bash -c "$(curl -fsSL https://raw.githubusercontent.com/rexsystems/azalea/master/services/azalea-server/install.sh)"\n' "$INSTALL_DIR"
  printf '  (or: git pull in build/ then docker compose build && docker compose up -d)\n\n'
else
  printf '  cd %s && docker compose pull && docker compose up -d\n\n' "$INSTALL_DIR"
fi
