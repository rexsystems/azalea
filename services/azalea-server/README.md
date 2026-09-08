# azalea-server

Self-hostable Azalea sync API (Rust + SQLite). See [`docs/sync-api-v1.md`](../../docs/sync-api-v1.md).

## Dev

```bash
cd services/azalea-server
export AZALEA_JWT_SECRET=dev-secret
export AZALEA_SETUP_SECRET=setup
# optional mail (password reset):
# export RESEND_API_KEY=re_xxx
# export AZALEA_MAIL_FROM="Azalea <onboarding@resend.dev>"
# export AZALEA_PUBLIC_WEB_URL=http://localhost:3000
cargo run
```

Health: `curl localhost:8787/v1/health`

Bootstrap admin:

```bash
curl -s localhost:8787/v1/setup/bootstrap -H 'content-type: application/json' -d '{
  "setup_secret":"setup",
  "admin_email":"admin@example.com",
  "admin_password":"password123",
  "instance_name":"Home"
}'
```

Or open your azalea-web `/setup` page after pointing `NEXT_PUBLIC_AZALEA_API_URL` at the API.

## Docker

```bash
cd services/azalea-server
cp .env.example .env   # optional; edit secrets + Resend
docker compose up -d --build
```

### Resend (password reset)

Set in `.env` next to `docker-compose.yml`:

```env
RESEND_API_KEY=re_xxxxxxxx
AZALEA_MAIL_FROM=Azalea <noreply@yourdomain.com>
AZALEA_PUBLIC_WEB_URL=https://your-azalea-web.example
```

Without `RESEND_API_KEY`, auth works but forgot-password returns an error that mail is not configured.

License: AGPL-3.0-or-later.
