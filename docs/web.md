# Web apps

## Self-host dashboard (this monorepo)

[`apps/azalea-web`](../apps/azalea-web) is the **self-host dashboard** shipped by
`install.sh`: login, account, admin, and desktop `/authorize` handoff.
There is **no marketing landing** here (`/` redirects to `/login`).

```bash
npm run dev:web
cd apps/azalea-web && npm run build   # static export -> out/
```

Docker: nginx serves `out/` and proxies `/api/` to azalea-server.

## Public marketing site

Standalone repo: **https://github.com/rexsystems/azalea-web** (private),
deployed at **https://azalea.rexsystems.me** (Cloudflare Pages).

That site keeps the landing page, download, pricing, and the short installer:

```bash
curl -fsSL https://azalea.rexsystems.me/script.sh | bash
```

`script.sh` pulls `services/azalea-server/install.sh` from the monorepo on GitHub.

Self-host API: [self-host.md](./self-host.md).
