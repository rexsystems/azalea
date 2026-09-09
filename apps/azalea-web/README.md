# Azalea Web

Landing page, accounts, admin, and setup for the [Azalea](https://github.com/rexsystems/azalea) SSH client.

Next.js static export. Auth and vault admin talk to **azalea-server**
(`NEXT_PUBLIC_AZALEA_API_URL`).

## Local dev

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Deploy (Cloudflare Pages)

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Output directory | `out` |
| Node.js | 20 or 22 |

Env vars: see `.env.example`.

```bash
npm run build
npx wrangler pages deploy out --project-name azalea
```

## Routes

`/` · `/download` · `/login` · `/signup` · `/forgot-password` · `/reset-password` ·
`/account` · `/admin` · `/authorize`
