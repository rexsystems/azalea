#!/usr/bin/env bash
# Interactive installer: azalea-server (+ optional web dashboard) on a fresh VPS.
# Builds from the monorepo on GitHub.
set -euo pipefail

REPO="${AZALEA_REPO:-https://github.com/rexsystems/azalea.git}"
INSTALL_DIR="${AZALEA_INSTALL_DIR:-$HOME/azalea}"

step=0
total=8

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

write_compose() {
  local api_ports="$1"
  local want_web="$2"
  local web_ports="${3:-80:80}"

  if [[ "$want_web" -eq 1 ]]; then
    cat > docker-compose.yml <<EOF
services:
  azalea-server:
    build: ./build/server
    image: azalea-server:local
    env_file:
      - .env
    expose:
      - "9482"
    ports:
      - "${api_ports}"
    environment:
      AZALEA_DATA_DIR: /data
      AZALEA_BIND: 0.0.0.0:9482
      RUST_LOG: azalea_server=info,tower_http=info
    volumes:
      - azalea-data:/data
    restart: unless-stopped

  azalea-web:
    build:
      context: ./build/web
      args:
        NEXT_PUBLIC_AZALEA_API_URL: /api
        NEXT_PUBLIC_SITE_URL: ${web_url}
    image: azalea-web:local
    ports:
      - "${web_ports}"
    depends_on:
      - azalea-server
    restart: unless-stopped

volumes:
  azalea-data:
EOF
  else
    cat > docker-compose.yml <<EOF
services:
  azalea-server:
    build: ./build/server
    image: azalea-server:local
    env_file:
      - .env
    ports:
      - "${api_ports}"
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
  fi
}

fetch_build_context() {
  local want_web="$1"
  need_cmd git
  local tmp
  tmp="$(mktemp -d)"
  printf 'Cloning %s...\n' "$REPO"
  git clone --depth 1 --filter=blob:none --sparse "$REPO" "$tmp/azalea"
  if [[ "$want_web" -eq 1 ]]; then
    git -C "$tmp/azalea" sparse-checkout set services/azalea-server apps/azalea-web
  else
    git -C "$tmp/azalea" sparse-checkout set services/azalea-server
  fi
  rm -rf build
  mkdir -p build/server
  cp -a "$tmp/azalea/services/azalea-server/." build/server/
  if [[ "$want_web" -eq 1 ]]; then
    mkdir -p build/web
    cp -a "$tmp/azalea/apps/azalea-web/." build/web/
  fi
  rm -rf "$tmp"
}

printf '\n== Azalea installer ==\n'
printf 'Install dir: %s\n\n' "$INSTALL_DIR"

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

domain="$(ask "Public domain (empty = IP only)" "")"
web_url=""
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
if ask_yes_no "Install web dashboard too (browser login / admin)?" "y"; then
  want_web=1
fi

bind_localhost=0
if [[ -n "$domain" ]] && ask_yes_no "Bind API port 9482 to 127.0.0.1 only (web still public on :80)?" "y"; then
  bind_localhost=1
fi

jwt_secret="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"

api_ports="9482:9482"
if [[ "$bind_localhost" -eq 1 ]]; then
  api_ports="127.0.0.1:9482:9482"
fi
web_ports="80:80"

if [[ -z "$web_url" ]]; then
  web_url="http://127.0.0.1"
fi

public_web_for_mail="$web_url"
if [[ "$want_web" -eq 0 ]]; then
  public_web_for_mail="http://127.0.0.1:9482"
  if [[ -n "$domain" ]]; then
    public_web_for_mail="https://${domain}"
  fi
fi

progress "Writing .env and compose"
cat > .env <<EOF
AZALEA_JWT_SECRET=${jwt_secret}
RESEND_API_KEY=${resend_key}
AZALEA_MAIL_FROM=${mail_from}
AZALEA_PUBLIC_WEB_URL=${public_web_for_mail}
EOF
chmod 600 .env

write_compose "$api_ports" "$want_web" "$web_ports"

progress "Fetching source from GitHub"
fetch_build_context "$want_web"

progress "Building images (this can take a few minutes)"
docker compose build

progress "Starting containers"
if docker compose ps -q 2>/dev/null | grep -q .; then
  docker compose down >/dev/null 2>&1 || true
fi
# free common ports from leftover runs
for p in 9482 80 8787; do
  if command -v ss >/dev/null 2>&1 && ss -ltn | grep -q ":${p} "; then
    docker ps --format '{{.ID}} {{.Names}} {{.Ports}}' | while read -r id name ports; do
      case "$ports" in
        *"${p}"*) docker stop "$id" >/dev/null 2>&1 || true ;;
      esac
    done
  fi
done
docker ps -a --format '{{.Names}}' | while read -r name; do
  case "$name" in
    *azalea*) docker rm -f "$name" >/dev/null 2>&1 || true ;;
  esac
done
docker compose up -d

progress "Waiting for API health"
ok=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:9482/v1/health" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 2
done
[[ "$ok" -eq 1 ]] || die "API did not become healthy on :9482"

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
printf 'API:         http://127.0.0.1:9482/v1/health\n'
printf 'Admin user:  %s\n' "$admin_email"
printf 'Install dir: %s\n' "$INSTALL_DIR"

if [[ "$want_web" -eq 1 ]]; then
  printf 'Web dashboard: http://YOUR_IP/  (or %s)\n' "${web_url}"
  printf '  login:  /login\n'
  printf '  admin:  /admin\n'
  printf 'Desktop self-host URL: http://YOUR_IP  (uses /api)\n'
else
  printf 'Web dashboard: not installed (CLI only)\n'
  printf 'Desktop self-host URL: http://YOUR_IP:9482\n'
fi

printf '\nCLI:\n'
printf '  cd %s\n' "$INSTALL_DIR"
printf '  docker compose exec azalea-server azalea-server user list\n'
printf '  docker compose exec azalea-server azalea-server user create --email u@x.com --password secret123\n'

if [[ -n "$domain" && "$want_web" -eq 1 ]]; then
  printf '\nPoint DNS A record for %s to this VPS. HTTP :80 is already serving the UI.\n' "$domain"
  printf 'For HTTPS, put Caddy/Nginx in front or use Cloudflare.\n'
fi

printf '\nUpdates:\n'
printf '  curl -fsSL https://azalea.rexsystems.me/script.sh | bash\n'
printf '  # or: cd %s && bash <(curl -fsSL https://raw.githubusercontent.com/rexsystems/azalea/master/services/azalea-server/install.sh)\n\n' "$INSTALL_DIR"
