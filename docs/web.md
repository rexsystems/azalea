# Web app

Standalone repo: **https://github.com/rexsystems/azalea-web** (private) -> Cloudflare Pages

## Work from this monorepo

The web app is linked locally via a **junction** (not committed):

```powershell
npm run link:web
# creates apps/azalea-web -> ../azalea-web
# (or apps/web when that folder is not locked)
```

Then edit at `apps/azalea-web/`. Changes go to the separate repo.

```powershell
npm run dev:web          # dev server
cd apps/azalea-web && npm run build   # static export -> out/
```

`apps/web/` and `apps/azalea-web/` are in `.gitignore`.

## Cloudflare Pages

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Output directory | `out` |
| Node.js | 22 |

Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, optional `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_GITHUB_REPO`, optional `NEXT_PUBLIC_WINDOWS_DOWNLOAD_URL`

## Download links

- `/download` - redirects to latest Windows installer (GitHub releases API) or releases page
- Set `NEXT_PUBLIC_WINDOWS_DOWNLOAD_URL` if `rexsystems/azalea` stays private
