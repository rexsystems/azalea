# Web apps

## Self-host dashboard (this monorepo)

[`apps/azalea-server-web`](../apps/azalea-server-web) is the **self-host dashboard** shipped by
`install.sh`: login, account, admin, and desktop `/authorize` handoff.
There is **no marketing landing** here (`/` redirects to `/login`).

```bash
npm run dev:web
cd apps/azalea-server-web && npm run build   # static export -> out/
```

Docker: nginx serves `out/` and proxies `/api/` to azalea-server. Local
development uses the same `/api` path through Next's proxy. After building,
`npm start --prefix apps/azalea-server-web` serves the export with an API proxy;
set `AZALEA_SERVER_URL` to change the backend target.

Administrators configure instance identity, registration, storage and captcha
at `/admin/settings`, and shared AI connections and default models at
`/admin/ai`. Captcha settings are read from the server at runtime. The optional
host update manager is controlled at `/admin/updates` or through the admin CLI.

## Public marketing site

Standalone repo: **https://github.com/rexsystems/azalea-web** (private),
deployed at **https://azalea.rexsystems.me** (Cloudflare Pages).

That site keeps the landing page, download, pricing, and the short installer:

```bash
curl -fsSL https://azalea.rexsystems.me/script.sh | bash
```

`script.sh` pulls `services/azalea-server/install.sh` from the monorepo on GitHub.

Self-host API: [self-host.md](./self-host.md).
