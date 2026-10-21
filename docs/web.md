# Web apps

## Self-host dashboard (this monorepo)

[`apps/azalea-server-web`](../apps/azalea-server-web) is the self-host
dashboard shipped by `install.sh`: login, account, admin, and desktop
`/authorize` handoff. There is no marketing landing here (`/` redirects to
`/login`).

```bash
npm run dev:web
cd apps/azalea-server-web && npm run build   # static export -> out/
```

Docker: nginx serves `out/` and proxies `/api/` to azalea-server. Local
development uses the same `/api` path through Next's proxy. After building,
`npm start --prefix apps/azalea-server-web` serves the export with an API proxy;
set `AZALEA_SERVER_URL` to change the backend target.

Administration is split into:

- `/admin`: users, roles, account status, plan assignment and individual vault quotas. Add-user fields open on demand; usage charts sit under Storage & signup trends.
- `/admin/plans`: create plans, rename them and change their shared vault quotas. Free and Pro remain the default plans; new public accounts start on Free. Custom plans can be deleted after all their users are reassigned.
- `/admin/settings`: instance identity, public registration and captcha.
- `/admin/ai`: shared AI connections, default models and request limits.
- `/admin/updates`: the optional host update manager, also available through the admin CLI.

Vault quotas range from 1 KiB to 1 GiB. Users normally follow their plan's quota.
In Edit user, select Custom quota to override it for that account. The override
survives plan changes; select Follow plan to remove it. Lowering a quota preserves
the saved vault and blocks uploads that exceed the new limit.

Closing public registration hides the signup link and redirects `/signup` to
`/login`, including desktop handoff parameters. The API rejects public registration
while closed; administrators can still create users. Registration and captcha
settings are loaded at runtime without rebuilding the dashboard.

On server startup, the plan migration copies existing Free/Pro limits and preserves
users, sessions and encrypted vaults. The old free/pro settings and CLI quota
commands continue to update those plans. CLI user commands accept custom plan IDs.
See the [admin API](sync-api-v1.md#admin-role--admin).

The supplied nginx configurations stream API requests to the server and allow
the supported quota range. If you use another reverse proxy, set its request-body
limit above the largest quota plus JSON overhead; the API enforces each account's
actual quota.

## Public marketing site

Standalone repo: **https://github.com/rexsystems/azalea-web** (private),
deployed at **https://azalea.rexsystems.me** (Cloudflare Pages).

That site holds the landing page, download, pricing, and the short installer:

```bash
curl -fsSL https://azalea.rexsystems.me/script.sh | bash
```

`script.sh` pulls `services/azalea-server/install.sh` from the monorepo on
GitHub.

Self-host API: [self-host.md](./self-host.md).
