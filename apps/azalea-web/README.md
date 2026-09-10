# Azalea Web (self-host dashboard)

Dashboard shipped with azalea-server installs: login, account, admin, and desktop
`/authorize` handoff. **No marketing landing** (`/` → `/login`).

Public product site (landing / download / `script.sh`): separate repo
`rexsystems/azalea-web` at https://azalea.rexsystems.me

## Local

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Docker (via install.sh)

Built as `azalea-web:local`. Nginx serves the static export and proxies `/api/`
to azalea-server.

## Routes

`/login` · `/signup` · `/forgot-password` · `/reset-password` ·
`/account` · `/admin` · `/authorize`
