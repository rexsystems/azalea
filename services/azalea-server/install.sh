#!/usr/bin/env bash
# Interactive installer: azalea-server (+ optional web) on a fresh VPS.
# Prefers prebuilt GHCR images. Falls back to source build only if pull fails.
set -euo pipefail

SERVER_IMAGE="${AZALEA_SERVER_IMAGE:-ghcr.io/rexsystems/azalea-server:latest}"
WEB_IMAGE="${AZALEA_WEB_IMAGE:-ghcr.io/rexsystems/azalea-web:latest}"
REPO="${AZALEA_REPO:-https://github.com/rexsystems/azalea.git}"
INSTALL_DIR="${AZALEA_INSTALL_DIR:-$HOME/azalea}"

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_DIM=$'\033[2m'
  C_CYAN=$'\033[38;5;81m'
  C_GREEN=$'\033[38;5;114m'
  C_YELLOW=$'\033[38;5;221m'
  C_RED=$'\033[38;5;203m'
  C_MAGENTA=$'\033[38;5;183m'
  C_WHITE=$'\033[97m'
else
  C_RESET="" C_BOLD="" C_DIM="" C_CYAN="" C_GREEN="" C_YELLOW="" C_RED="" C_MAGENTA="" C_WHITE=""
fi

step=0
total=7

banner() {
  printf '\n'
  printf '%s' "${C_CYAN}${C_BOLD}"
  cat <<'EOF'
     _                _
    / \    _____ __ _| | ___  __ _
   / _ \  |_  / / _` | |/ _ \/ _` |
  / ___ \  / / | (_| | |  __/ (_| |
 /_/   \_\/___| \__,_|_|\___|\__,_|
EOF
  printf '%s\n' "${C_RESET}"
  printf '  %sSelf-host installer%s  %ssync API + optional dashboard%s\n' \
    "${C_WHITE}${C_BOLD}" "${C_RESET}" "${C_DIM}" "${C_RESET}"
  printf '  %sInstall dir:%s %s%s%s\n\n' \
    "${C_DIM}" "${C_RESET}" "${C_CYAN}" "$INSTALL_DIR" "${C_RESET}"
}

progress() {
  step=$((step + 1))
  printf '\n%s[%s/%s]%s %s%s%s\n' \
    "${C_MAGENTA}${C_BOLD}" "$step" "$total" "${C_RESET}" \
    "${C_WHITE}${C_BOLD}" "$1" "${C_RESET}"
}

ok() {
  printf '  %s✓%s %s\n' "${C_GREEN}${C_BOLD}" "${C_RESET}" "$1"
}

warn() {
  printf '  %s!%s %s\n' "${C_YELLOW}${C_BOLD}" "${C_RESET}" "$1" >&2
}

die() {
  printf '\n%s✗ error:%s %s\n\n' "${C_RED}${C_BOLD}" "${C_RESET}" "$1" >&2
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
    read -r -p "$(printf '%s?%s %s [%s%s%s]: ' "${C_CYAN}" "${C_RESET}" "$prompt" "${C_DIM}" "$default" "${C_RESET}")" reply < /dev/tty || true
    printf '%s\n' "${reply:-$default}"
  else
    read -r -p "$(printf '%s?%s %s: ' "${C_CYAN}" "${C_RESET}" "$prompt")" reply < /dev/tty || true
    printf '%s\n' "$reply"
  fi
}

ask_secret() {
  local prompt="$1"
  local reply
  if [[ ! -r /dev/tty ]]; then
    die "no terminal for prompts; run: bash install.sh"
  fi
  read -r -s -p "$(printf '%s?%s %s: ' "${C_CYAN}" "${C_RESET}" "$prompt")" reply < /dev/tty || true
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
  read -r -p "$(printf '%s?%s %s (%s%s%s): ' "${C_CYAN}" "${C_RESET}" "$prompt" "${C_DIM}" "$hint" "${C_RESET}")" reply < /dev/tty || true
  reply="${reply:-$default}"
  case "${reply,,}" in
    y|yes) return 0 ;;
    *) return 1 ;;
  esac
}

write_compose() {
  local api_ports="$1"
  local want_web="$2"
  local web_ports="${3:-}"
  local mode="$4" # image | build

  if [[ "$mode" == "image" ]]; then
    if [[ "$want_web" -eq 1 ]]; then
      cat > docker-compose.yml <<EOF
services:
  azalea-server:
    image: ${SERVER_IMAGE}
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
    image: ${WEB_IMAGE}
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
    image: ${SERVER_IMAGE}
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
    return
  fi

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

try_pull_images() {
  local want_web="$1"
  printf '  %s→%s Pulling %s%s%s\n' "${C_CYAN}" "${C_RESET}" "${C_DIM}" "$SERVER_IMAGE" "${C_RESET}"
  if ! docker pull "$SERVER_IMAGE"; then
    warn "Could not pull ${SERVER_IMAGE}"
    printf '    Make the GHCR package Public:\n' >&2
    printf '    https://github.com/orgs/rexsystems/packages/container/package/azalea-server\n' >&2
    return 1
  fi
  if [[ "$want_web" -eq 1 ]]; then
    printf '  %s→%s Pulling %s%s%s\n' "${C_CYAN}" "${C_RESET}" "${C_DIM}" "$WEB_IMAGE" "${C_RESET}"
    if ! docker pull "$WEB_IMAGE"; then
      warn "Could not pull ${WEB_IMAGE}"
      printf '    Make the GHCR package Public:\n' >&2
      printf '    https://github.com/orgs/rexsystems/packages/container/package/azalea-web\n' >&2
      return 1
    fi
  fi
  return 0
}

banner

progress "Checking Docker"
if ! command -v docker >/dev/null 2>&1; then
  if ask_yes_no "Docker not found. Install via get.docker.com?" "y"; then
    need_cmd curl
    curl -fsSL https://get.docker.com | sh
    if command -v usermod >/dev/null 2>&1 && [[ "$(id -u)" -ne 0 ]]; then
      sudo usermod -aG docker "$USER" || true
      warn "You may need to log out/in for docker without sudo."
    fi
  else
    die "Docker is required"
  fi
fi
need_cmd docker
docker compose version >/dev/null 2>&1 || die "docker compose plugin required"
ok "Docker ready"

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
  warn "Password too short."
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
if [[ "$want_web" -eq 1 ]]; then
  if ask_yes_no "Bind API :9482 to localhost only (recommended for Cloudflare Tunnel)?" "y"; then
    bind_localhost=1
  fi
elif [[ -n "$domain" ]] && ask_yes_no "Bind API port 9482 to 127.0.0.1 only?" "y"; then
  bind_localhost=1
fi

jwt_secret="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"

api_ports="9482:9482"
if [[ "$bind_localhost" -eq 1 ]]; then
  api_ports="127.0.0.1:9482:9482"
fi

# Fixed dashboard host port (not 80 / 8787).
web_host_port=""
web_ports=""
if [[ "$want_web" -eq 1 ]]; then
  web_host_port="9843"
  web_ports="${web_host_port}:80"
fi

if [[ -z "$web_url" ]]; then
  if [[ "$want_web" -eq 1 && -n "$web_host_port" ]]; then
    web_url="http://127.0.0.1:${web_host_port}"
  else
    web_url="http://127.0.0.1"
  fi
fi

public_web_for_mail="$web_url"
if [[ "$want_web" -eq 0 ]]; then
  public_web_for_mail="http://127.0.0.1:9482"
  if [[ -n "$domain" ]]; then
    public_web_for_mail="https://${domain}"
  fi
fi
ok "Config saved"
if [[ "$want_web" -eq 1 ]]; then
  ok "Dashboard host port: ${web_host_port}"
fi

progress "Writing .env"
cat > .env <<EOF
AZALEA_JWT_SECRET=${jwt_secret}
RESEND_API_KEY=${resend_key}
AZALEA_MAIL_FROM=${mail_from}
AZALEA_PUBLIC_WEB_URL=${public_web_for_mail}
EOF
chmod 600 .env
ok ".env written"

if [[ "$want_web" -eq 1 ]]; then
  cat > nginx-host.example.conf <<EOF
# Optional: put the dashboard on :80 via host nginx (default install uses :${web_host_port}).
# Cloudflare Tunnel: point the tunnel at http://127.0.0.1:${web_host_port} instead.
server {
  listen 80;
  server_name _;
  location / {
    proxy_pass http://127.0.0.1:${web_host_port};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Authorization \$http_authorization;
  }
}
EOF
  cat > cloudflared.example.yml <<EOF
# Example Cloudflare Tunnel ingress (copy into your tunnel config).
# tunnel: <id>
# credentials-file: /root/.cloudflared/<id>.json
ingress:
  - hostname: your.domain.tld
    service: http://127.0.0.1:${web_host_port}
  - service: http_status:404
EOF
  ok "Wrote nginx-host.example.conf + cloudflared.example.yml"
fi

progress "Pulling Docker images"
install_mode="image"
if try_pull_images "$want_web"; then
  write_compose "$api_ports" "$want_web" "$web_ports" image
  ok "Using published images"
else
  warn "Falling back to local image build from GitHub source..."
  install_mode="build"
  write_compose "$api_ports" "$want_web" "$web_ports" build
  fetch_build_context "$want_web"
  docker compose build
  ok "Local images built"
fi

progress "Starting containers"
if docker compose ps -q 2>/dev/null | grep -q .; then
  docker compose down >/dev/null 2>&1 || true
fi
for p in 9482 ${web_host_port:-}; do
  [[ -z "$p" ]] && continue
  if command -v ss >/dev/null 2>&1 && ss -ltn | grep -qE ":${p}\\s"; then
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
ok "Containers up"

progress "Waiting for API health"
healthy=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:9482/v1/health" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done
[[ "$healthy" -eq 1 ]] || die "API did not become healthy on :9482"
ok "API healthy on :9482"

progress "Bootstrapping admin"
if docker compose exec -T azalea-server azalea-server bootstrap \
  --email "$admin_email" \
  --password "$admin_pass" \
  --instance "$instance"; then
  ok "Admin ready"
else
  warn "Bootstrap skipped or failed (maybe already done). Continuing."
fi

printf '\n%s══ Done ══%s\n' "${C_GREEN}${C_BOLD}" "${C_RESET}"
printf '  %sMode%s         %s\n' "${C_DIM}" "${C_RESET}" "$install_mode"
printf '  %sAPI%s          %shttp://127.0.0.1:9482/v1/health%s\n' "${C_DIM}" "${C_RESET}" "${C_CYAN}" "${C_RESET}"
printf '  %sAdmin%s        %s\n' "${C_DIM}" "${C_RESET}" "$admin_email"
printf '  %sInstall dir%s  %s\n' "${C_DIM}" "${C_RESET}" "$INSTALL_DIR"

if [[ "$want_web" -eq 1 ]]; then
  printf '  %sDashboard%s    %shttp://YOUR_IP:%s/%s  (local %s)\n' \
    "${C_DIM}" "${C_RESET}" "${C_CYAN}" "$web_host_port" "${C_RESET}" "$web_url"
  printf '  %sDesktop URL%s  %shttp://YOUR_IP:%s%s  (uses /api via the dashboard)\n' \
    "${C_DIM}" "${C_RESET}" "${C_CYAN}" "$web_host_port" "${C_RESET}"
  printf '  %sSign in%s      %s/login%s · %sAuthorize%s /authorize\n' \
    "${C_DIM}" "${C_RESET}" "${C_MAGENTA}" "${C_RESET}" "${C_MAGENTA}" "${C_RESET}"
  printf '  %sTunnel%s       point Cloudflare Tunnel at %shttp://127.0.0.1:%s%s\n' \
    "${C_DIM}" "${C_RESET}" "${C_CYAN}" "$web_host_port" "${C_RESET}"
  printf '  %sOptional :80%s see %snginx-host.example.conf%s\n' \
    "${C_DIM}" "${C_RESET}" "${C_DIM}" "${C_RESET}"
else
  printf '  %sDashboard%s    not installed (CLI only)\n' "${C_DIM}" "${C_RESET}"
  printf '  %sDesktop URL%s  %shttp://YOUR_IP:9482%s\n' "${C_DIM}" "${C_RESET}" "${C_CYAN}" "${C_RESET}"
fi

printf '\n%sCLI%s\n' "${C_WHITE}${C_BOLD}" "${C_RESET}"
printf '  cd %s\n' "$INSTALL_DIR"
printf '  docker compose exec azalea-server azalea-server user list\n'
printf '  docker compose exec azalea-server azalea-server user create --email u@x.com --password secret123\n'

if [[ -n "$domain" && "$want_web" -eq 1 ]]; then
  printf '\n%sDNS / Tunnel%s\n' "${C_WHITE}${C_BOLD}" "${C_RESET}"
  printf '  Point DNS for %s%s%s here, then either:\n' "${C_CYAN}" "$domain" "${C_RESET}"
  printf '  - Cloudflare Tunnel → http://127.0.0.1:%s (see cloudflared.example.yml)\n' "$web_host_port"
  printf '  - Host nginx on :80 → proxy to 127.0.0.1:%s (see nginx-host.example.conf)\n' "$web_host_port"
fi

printf '\n%sWipe + reinstall%s\n' "${C_WHITE}${C_BOLD}" "${C_RESET}"
printf '  cd %s && docker compose down -v\n' "$INSTALL_DIR"
printf '  docker rm -f $(docker ps -aq --filter name=azalea) 2>/dev/null || true\n'
printf '  rm -rf %s\n' "$INSTALL_DIR"
printf '  curl -fsSL https://azalea.rexsystems.me/script.sh | bash\n'

printf '\n%sUpdates%s\n' "${C_WHITE}${C_BOLD}" "${C_RESET}"
printf '  cd %s && docker compose pull && docker compose up -d\n\n' "$INSTALL_DIR"
