# azalea-server-web (self-host dashboard)

Dashboard shipped with azalea-server: login, account, admin, and desktop
`/authorize` handoff. **No marketing landing** (`/` → `/login`).

Container image: `ghcr.io/rexsystems/azalea-server-web:latest`

Public product site (landing / download / `script.sh`): separate repo
`rexsystems/azalea-web` at https://azalea.rexsystems.me

## Routes

`/login` · `/signup` · `/forgot-password` · `/reset-password` ·
`/account` · `/admin` · `/admin/settings` · `/admin/ai` · `/authorize`

## Local

```bash
cd apps/azalea-server-web
npm install
npm run dev
```

Development proxies `/api` to `AZALEA_SERVER_URL` (default
`http://127.0.0.1:9482`). For a production build, run `npm run build`, then
`npm start`. The preview server uses the same proxy and defaults to port 3000.

Instance settings, signup and Turnstile are loaded from the running server.
In **Admin → AI**, save provider connections, load their real model catalogs
or add exact custom IDs, and choose a default model. Saved API keys remain
encrypted on the server; blank key fields retain the saved key.

## Docker

```bash
docker build -t azalea-server-web:local \
  --build-arg NEXT_PUBLIC_AZALEA_API_URL=/api \
  .
```

Nginx proxies `/api/` to `azalea-server:9482`.
