# Supabase setup (Azalea)

All SQL and Edge Functions live here. The same folder exists in **azalea-web** (`apps/azalea-web/supabase` is a junction to that repo).

## File map

| File | What it does |
|------|----------------|
| `schema.sql` | `vaults` table + RLS (cloud sync) |
| `profiles.sql` | Manual approval + vault gate for unapproved users |
| `admin.sql` | Admin panel RPCs + `admins` table |
| `account.sql` | Drops old `delete_own_account` RPC |
| `security-fixes.sql` | One-shot cleanup for Security Advisor |
| `bootstrap-admin.sql` | **You run this to become admin** |
| `functions/delete-account/index.ts` | Edge Function for self-serve account delete |

## Step-by-step (new project)

### 1. SQL (Dashboard -> SQL Editor)

Run **in this order**, each as a new query:

1. `schema.sql`
2. `profiles.sql`
3. `admin.sql`
4. `account.sql`
4. `security-fixes.sql` (only if you had the old `delete_own_account` RPC before)

### 2. Make yourself admin

1. Create an account on the site (`/signup`) or in Dashboard -> Authentication -> Users.
2. Copy your **User UID** from Authentication -> Users.
3. Open `bootstrap-admin.sql`, replace `PASTE-YOUR-USER-UUID-HERE`, run in SQL Editor.

After that, log in on the site -> `/account` shows an **Admin** link -> `/admin` lists all users.

> The `admins` table has no RLS policies on purpose (not reachable via REST). Only SQL Editor or SECURITY DEFINER functions can touch it.

### 3. Edge Function: delete account

Path on disk:

```
azalea-web/supabase/functions/delete-account/index.ts
```

Same via monorepo junction:

```
lilacssh/apps/azalea-web/supabase/functions/delete-account/index.ts
```

**Option A — CLI** (from `azalea-web` folder):

```bash
npm i -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy delete-account
```

**Option B — Dashboard:**

1. Edge Functions -> **Deploy a new function**
2. Name: `delete-account`
3. Paste code from `functions/delete-account/index.ts`
4. Deploy

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

### 4. Auth hardening (Dashboard)

| Setting | Where |
|---------|--------|
| Leaked passwords (HIBP) | Authentication -> Providers -> Email -> **Prevent use of leaked passwords** (Pro plan) |
| Turnstile captcha | Cloudflare Turnstile site key in `.env.local`; secret in Supabase -> Auth -> Attack Protection -> Captcha |
| Email confirmations | Authentication -> Providers -> Email -> **Confirm email** (required for verification flow) |
| Site URL | Authentication -> URL Configuration -> `https://azalea.rexsystems.me` |
| Redirect URLs | Add `https://azalea.rexsystems.me/**` and `http://localhost:3000/**` for dev |

### 5. Site env (Cloudflare Pages / `.env.local`)

```
NEXT_PUBLIC_SITE_URL=https://azalea.rexsystems.me
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_TURNSTILE_SITE_KEY=   # optional
NEXT_PUBLIC_GITHUB_REPO=rexsystems/azalea
```

## Security Advisor notes

| Warning | Status |
|---------|--------|
| `delete_own_account` SECURITY DEFINER | Fixed: RPC removed, use Edge Function |
| Admin RPCs (`admin_check`, etc.) | May still warn **0029** — intentional. Each function checks `is_admin()` before doing anything. `anon` cannot call them. |
| Leaked password protection | Dashboard toggle (not SQL) |

## Quick checklist

- [ ] `schema.sql`
- [ ] `admin.sql`
- [ ] `account.sql` + `security-fixes.sql`
- [ ] `bootstrap-admin.sql` with your UUID
- [ ] Deploy `delete-account` Edge Function
- [ ] HIBP / captcha if you want them
- [ ] Env vars on Cloudflare Pages
- [ ] Test: login -> `/account` -> Admin link -> `/admin`
