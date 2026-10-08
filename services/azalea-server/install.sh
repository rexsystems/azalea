#!/usr/bin/env bash
# Interactive installer: azalea-server (+ optional web) on a fresh VPS.
# Prefers prebuilt GHCR images. Falls back to source build only if pull fails.
#
# For production installs, pin the images to a specific digest so a compromised
# GHCR push cannot silently swap the runtime out from under you. Example:
#
#   AZALEA_SERVER_IMAGE=ghcr.io/rexsystems/azalea-server@sha256:<64hex> \
#   AZALEA_WEB_IMAGE=ghcr.io/rexsystems/azalea-server-web@sha256:<64hex> \
#     bash install.sh
#
# The current digests are printed at the end of a successful `docker compose pull`.
set -euo pipefail

SERVER_IMAGE="${AZALEA_SERVER_IMAGE:-ghcr.io/rexsystems/azalea-server:latest}"
WEB_IMAGE="${AZALEA_WEB_IMAGE:-ghcr.io/rexsystems/azalea-server-web:latest}"

REPO="${AZALEA_REPO:-https://github.com/rexsystems/azalea.git}"
INSTALL_DIR="${AZALEA_INSTALL_DIR:-$HOME/azalea}"
INSTALLER_SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"

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

ask_port() {
  local port
  while true; do
    port="$(ask "$1" "$2")"
    if [[ "$port" =~ ^[0-9]{1,5}$ ]] && ((10#$port >= 1 && 10#$port <= 65535)); then
      printf '%s\n' "$((10#$port))"
      return
    fi
    warn "Enter a port between 1 and 65535."
  done
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

  azalea-server-web:
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

  azalea-server-web:
    build:
      context: ./build/web
      args:
        NEXT_PUBLIC_AZALEA_API_URL: /api
        NEXT_PUBLIC_SITE_URL: ${web_url}
    image: azalea-server-web:local
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
    git -C "$tmp/azalea" sparse-checkout set services/azalea-server apps/azalea-server-web
  else
    git -C "$tmp/azalea" sparse-checkout set services/azalea-server
  fi
  rm -rf build
  mkdir -p build/server
  cp -a "$tmp/azalea/services/azalea-server/." build/server/
  if [[ "$want_web" -eq 1 ]]; then
    mkdir -p build/web
    cp -a "$tmp/azalea/apps/azalea-server-web/." build/web/
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
      printf '    https://github.com/orgs/rexsystems/packages/container/package/azalea-server-web\n' >&2
      return 1
    fi
  fi
  return 0
}

banner

progress "Checking Docker"
if ! command -v docker >/dev/null 2>&1; then
  # Suggest the OS package manager first (auditable, distro-signed) instead of
  # curl | sh. The Docker convenience script docker.com itself recommends
  # against on production hosts.
  cat <<'EOM' >&2
Docker is not installed.

Please install it with your OS package manager (recommended):
  Debian/Ubuntu:  https://docs.docker.com/engine/install/ubuntu/
  Fedora:         https://docs.docker.com/engine/install/fedora/
  RHEL / Alma:    https://docs.docker.com/engine/install/rhel/
  Arch Linux:     sudo pacman -S docker docker-compose

Piping get.docker.com to sh is disabled here because we cannot verify its
integrity. If you accept the risk, run the convenience script manually:

  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sha256sum /tmp/get-docker.sh   # compare against docker.com/blog before running
  sudo sh /tmp/get-docker.sh
EOM
  die "Install Docker with the OS package manager, then re-run this script."
fi
need_cmd docker
docker compose version >/dev/null 2>&1 || die "docker compose plugin required"
docker info >/dev/null 2>&1 || die "Cannot reach Docker. Start the Docker service and give this user access, or run the installer with sudo."
ok "Docker ready"

progress "Gathering config"
[[ "$INSTALL_DIR" != "/" && "$INSTALL_DIR" != "$HOME" ]] || die "Choose a dedicated installation directory."
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"
INSTALL_DIR="$(pwd -P)"
[[ "$INSTALL_DIR" != "/" && "$INSTALL_DIR" != "$(cd "$HOME" && pwd -P)" ]] || die "Choose a dedicated installation directory."
if [[ -e .env || -e docker-compose.yml || -e compose.yaml || -e compose.yml || -e docker-compose.yaml ]]; then
  die "This directory already contains an installation. Use its update commands; the installer will not overwrite credentials or configuration. Set AZALEA_INSTALL_DIR to a new directory for another instance."
fi

printf '\nChoose what to install. The API and admin CLI always work without a dashboard.\n'
want_web=0
if ask_yes_no "Add the optional web dashboard (browser admin and account pages)?" "y"; then
  want_web=1
fi
printf '\nAccess mode:\n  1) Local / LAN, direct ports\n  2) Cloudflare Tunnel, HTTPS on your domain\n  3) Your own HTTPS reverse proxy\n'
access_mode="$(ask "Access mode (1, 2 or 3)" "1")"
[[ "$access_mode" =~ ^[123]$ ]] || die "Choose access mode 1, 2 or 3."
domain=""
web_url=""
if [[ "$access_mode" != "1" ]]; then
  domain="$(ask "Public hostname (for example sync.example.com)" "")"
  domain="${domain#https://}"
  domain="${domain%/}"
  [[ "$domain" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?$ ]] || die "Enter a hostname without paths, credentials or query parameters."
  web_url="https://${domain}"
fi

api_host_port="$(ask_port "API host port" "9482")"
bind_localhost=0
[[ "$access_mode" != "1" || "$want_web" -eq 1 ]] && bind_localhost=1
if [[ "$access_mode" == "1" && "$want_web" -eq 0 ]] && ask_yes_no "Restrict the API to localhost (only clients on this host)?" "n"; then bind_localhost=1; fi
api_ports="${api_host_port}:9482"
[[ "$bind_localhost" -eq 1 ]] && api_ports="127.0.0.1:${api_host_port}:9482"
web_host_port=""
web_ports=""
allow_insecure_cookie="0"
if [[ "$want_web" -eq 1 ]]; then
  web_host_port="$(ask_port "Dashboard host port" "9843")"
  [[ "$web_host_port" != "$api_host_port" ]] || die "The API and dashboard need different host ports."
  web_ports="${web_host_port}:80"
  if [[ "$access_mode" != "1" ]]; then web_ports="127.0.0.1:${web_host_port}:80"; else allow_insecure_cookie="1"; fi
fi
for port in "$api_host_port" "${web_host_port:-}"; do
  [[ -z "$port" ]] && continue
  if command -v ss >/dev/null 2>&1 && ss -ltnH | awk '{print $4}' | grep -qE ":${port}$"; then
    die "Port ${port} is already in use. Re-run and choose another port."
  fi
done
if [[ -z "$web_url" && "$want_web" -eq 1 ]]; then web_url="http://127.0.0.1:${web_host_port}"; fi
public_web_for_mail="$web_url"

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
  if [[ "$want_web" -eq 0 ]]; then
    public_web_for_mail="$(ask "URL of an existing password-reset web page host (optional; empty disables mail)" "")"
  elif [[ "$access_mode" == "1" ]]; then
    public_web_for_mail="$(ask "Dashboard URL reachable by email recipients" "$web_url")"
  fi
  if [[ -n "$public_web_for_mail" ]]; then
  [[ "$public_web_for_mail" =~ ^https?://[^[:space:]]+$ ]] || die "Enter an HTTP(S) web URL."
  resend_key="$(ask "RESEND_API_KEY" "")"
  mail_from="$(ask "From address" "Azalea <noreply@${domain:-example.com}>")"
  else ok "Password-reset mail disabled; API and CLI login remain available."; fi
fi

jwt_secret="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
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
AZALEA_ALLOW_INSECURE_COOKIE=${allow_insecure_cookie}
EOF
chmod 600 .env
ok ".env written"

if [[ "$access_mode" != "1" ]]; then
  proxy_host_port="${web_host_port:-$api_host_port}"
  cat > nginx-host.example.conf <<EOF
# Add TLS with your reverse proxy before exposing this hostname.
server {
  listen 80;
  server_name ${domain%%:*};
  location / {
    proxy_pass http://127.0.0.1:${proxy_host_port};
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 190s;
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
  - hostname: ${domain%%:*}
    service: http://127.0.0.1:${proxy_host_port}
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
docker compose up -d
ok "Containers up"

# Print the resolved image digests. Operators who want a reproducible install
# can pin AZALEA_SERVER_IMAGE / AZALEA_WEB_IMAGE to these values (see top of
# script) so a compromised GHCR push cannot silently ship a new binary here.
printf '\n%b Currently-running image digests:\n' "${C_DIM}image ${C_RESET}"
for image in "$SERVER_IMAGE" "$WEB_IMAGE"; do
  [[ -z "$image" ]] && continue
  digest=$(docker image inspect --format '{{index .RepoDigests 0}}' "$image" 2>/dev/null || true)
  if [[ -n "$digest" ]]; then
    printf '  %s\n' "$digest"
  else
    printf '  %s (no digest available)\n' "$image"
  fi
done
printf '\n'

progress "Waiting for API health"
healthy=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${api_host_port}/v1/health" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done
[[ "$healthy" -eq 1 ]] || die "API did not become healthy on :${api_host_port}"
ok "API healthy on :${api_host_port}"

progress "Bootstrapping admin"
if docker compose exec -T azalea-server azalea-server bootstrap \
  --email "$admin_email" \
  --password "$admin_pass" \
  --instance "$instance"; then
  ok "Admin ready"
else
  warn "Bootstrap skipped or failed (maybe already done). Continuing."
fi

if [[ "$install_mode" == "image" && -d /run/systemd/system ]] && command -v python3 >/dev/null 2>&1; then
  if ask_yes_no "Enable the optional host update manager (CLI and dashboard; backup and rollback)?" "y"; then
    updater_source="${INSTALLER_SOURCE_DIR}/update-manager.py"
    updater_script="${INSTALL_DIR}/update-manager.py"
    updater_ready=0
    if [[ -f "$updater_source" ]]; then
      if cp "$updater_source" "$updater_script"; then updater_ready=1; fi
    elif curl -fsSL https://raw.githubusercontent.com/rexsystems/azalea/master/services/azalea-server/update-manager.py -o "$updater_script"; then updater_ready=1; fi
    if [[ "$updater_ready" -eq 1 ]]; then
      if [[ "$EUID" -eq 0 ]]; then
        if ! python3 "$updater_script" --directory "$INSTALL_DIR" install; then warn "API installation is complete; update manager setup needs attention. See docs/self-host.md#managed-updates."; fi
      elif command -v sudo >/dev/null 2>&1; then
        if ! sudo python3 "$updater_script" --directory "$INSTALL_DIR" install; then warn "API installation is complete; retry update manager setup with sudo later."; fi
      else warn "Run as root later: python3 ${updater_script} --directory ${INSTALL_DIR} install"; fi
    else warn "Could not download the optional update manager. The API remains usable with manual updates."; fi
  fi
fi

printf '\n%s══ Done ══%s\n' "${C_GREEN}${C_BOLD}" "${C_RESET}"
printf '  %sMode%s         %s\n' "${C_DIM}" "${C_RESET}" "$install_mode"
printf '  %sAPI%s          %shttp://127.0.0.1:%s/v1/health%s\n' "${C_DIM}" "${C_RESET}" "${C_CYAN}" "$api_host_port" "${C_RESET}"
printf '  %sAdmin%s        %s\n' "${C_DIM}" "${C_RESET}" "$admin_email"
printf '  %sInstall dir%s  %s\n' "${C_DIM}" "${C_RESET}" "$INSTALL_DIR"

if [[ "$want_web" -eq 1 ]]; then
  if [[ -n "$domain" ]]; then dashboard_address="https://${domain}"; else dashboard_address="http://YOUR_LAN_IP:${web_host_port}"; fi
  printf '  %sDashboard%s    %s%s/login%s\n' "${C_DIM}" "${C_RESET}" "${C_CYAN}" "$dashboard_address" "${C_RESET}"
  printf '  %sDesktop URL%s  %s%s%s  (API via /api)\n' "${C_DIM}" "${C_RESET}" "${C_CYAN}" "$dashboard_address" "${C_RESET}"
  printf '  %sSign in%s      %s/login%s · %sAuthorize%s /authorize\n' \
    "${C_DIM}" "${C_RESET}" "${C_MAGENTA}" "${C_RESET}" "${C_MAGENTA}" "${C_RESET}"
else
  printf '  %sDashboard%s    not installed (CLI only)\n' "${C_DIM}" "${C_RESET}"
  if [[ -n "$domain" ]]; then api_address="https://${domain}"; elif [[ "$bind_localhost" -eq 1 ]]; then api_address="http://127.0.0.1:${api_host_port}"; else api_address="http://YOUR_LAN_IP:${api_host_port}"; fi
  printf '  %sDesktop URL%s  %s%s%s  (email/password sign-in)\n' "${C_DIM}" "${C_RESET}" "${C_CYAN}" "$api_address" "${C_RESET}"
fi

printf '\n%sCLI%s\n' "${C_WHITE}${C_BOLD}" "${C_RESET}"
printf '  cd %s\n' "$INSTALL_DIR"
printf '  docker compose exec azalea-server azalea-server user list\n'
printf '  docker compose exec azalea-server azalea-server user create --email u@x.com --password secret123\n'

if [[ -n "$domain" ]]; then
  printf '\n%sDNS / Tunnel%s\n' "${C_WHITE}${C_BOLD}" "${C_RESET}"
  printf '  Point DNS for %s%s%s here, then either:\n' "${C_CYAN}" "$domain" "${C_RESET}"
  printf '  - Cloudflare Tunnel → http://127.0.0.1:%s (see cloudflared.example.yml)\n' "${web_host_port:-$api_host_port}"
  printf '  - HTTPS reverse proxy → http://127.0.0.1:%s (see nginx-host.example.conf)\n' "${web_host_port:-$api_host_port}"
  printf '  - Desktop server address: https://%s\n' "$domain"
  printf '  - Tunnel/proxy runs on this host. For a containerized tunnel, join the Compose network and use azalea-server-web:80 or azalea-server:9482.\n'
fi

printf '\n%sUpdates%s\n' "${C_WHITE}${C_BOLD}" "${C_RESET}"
if [[ -f azalea-updater.compose.json ]]; then
  printf '  cd %s\n' "$INSTALL_DIR"
  printf '  docker compose exec azalea-server azalea-server update status\n  docker compose exec azalea-server azalea-server update check\n  docker compose exec azalea-server azalea-server update apply\n  docker compose exec azalea-server azalea-server update rollback\n'
elif [[ "$install_mode" == "build" ]]; then
  printf '  Refresh build/server and optional build/web from source, then docker compose up -d --build.\n'
else printf '  cd %s && docker compose pull && docker compose up -d\n' "$INSTALL_DIR"; fi
printf '\n'
