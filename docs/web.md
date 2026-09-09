# Web app

Standalone repo: **https://github.com/rexsystems/azalea-web** (private) - deployed at
**https://azalea.rexsystems.me** (Cloudflare Pages).

Talks to **azalea-server** (`NEXT_PUBLIC_AZALEA_API_URL`).

## Work from this monorepo

The web app is linked locally via a **junction** (not committed). Clone `azalea-web`
next to this repo, then:

```powershell
# From repo root (Windows)
New-Item -ItemType Junction -Path apps\azalea-web -Target ..\azalea-web
```

```bash
npm run dev:web
cd apps/azalea-web && npm run build   # static export -> out/
```

`apps/azalea-web/` is in `.gitignore`.

## Cloudflare Pages

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Output directory | `out` |
| Node.js | 22 |

Env: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_AZALEA_API_URL`, optional
`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_GITHUB_REPO`,
optional `NEXT_PUBLIC_WINDOWS_DOWNLOAD_URL`.

## Download links

- `/download` - latest installers via GitHub releases API
- Set `NEXT_PUBLIC_WINDOWS_DOWNLOAD_URL` if the azalea repo stays private

Self-host API + setup: [self-host.md](./self-host.md).
