# azalea-web (self-host dashboard)

Dashboard shipped with azalea-server: login, account, admin, and desktop
`/authorize` handoff. **No marketing landing** (`/` → `/login`).

Published image: `ghcr.io/rexsystems/azalea-web:latest`

Public product site (landing / download / `script.sh`): separate repo
`rexsystems/azalea-web` at https://azalea.rexsystems.me

## Routes

`/login` · `/signup` · `/forgot-password` · `/reset-password` ·
`/account` · `/admin` · `/authorize`

## Local

```bash
cd apps/azalea-web && npm install && npm run build
```

## Docker

```bash
docker build -t azalea-web:local \
  --build-arg NEXT_PUBLIC_AZALEA_API_URL=/api \
  .
```

Nginx proxies `/api/` to `azalea-server:9482`.
