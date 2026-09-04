# Supabase setup (Azalea)

> **Canonical copy:** the complete set of SQL files lives in **azalea-web**
> (`apps/azalea-web/supabase`, a junction to that repo). This folder only keeps
> `schema.sql` and `account.sql` for reference. `schema.sql` alone leaves the
> approval gate and storage limits **off**, so always deploy the full list below
> from the azalea-web folder.

## File map

| File | What it does |
|------|----------------|
| `schema.sql` | `vaults` table + RLS (cloud sync) |
| `profiles.sql` | `profiles` table, manual approval + vault gate for unapproved users |
| `admin.sql` | Admin panel RPCs + `admins` table |
| `admin-approval-system.sql` | Global approval toggle for the admin panel |
| `plans.sql` | Free / Pro plans + server-side vault storage limit trigger |
| `account.sql` | Drops old `delete_own_account` RPC |
| `security-fixes.sql` | Revokes RPC access to trigger-only functions |
| `security-advisor-plans.sql` | Same, for the functions added by `plans.sql` |
| `admin-users-storage.sql` | Adds `vault_bytes` to `admin_list_users` |
| `bootstrap-admin.sql` | **You run this to become admin** |
| `functions/delete-account/index.ts` | Edge Function for self-serve account delete |

## Step-by-step (new project)

### 1. SQL (Dashboard -> SQL Editor)

Run **all of these, in this order**, each as a new query. Skipping
`profiles.sql` or `plans.sql` means unapproved accounts can sync and vault
storage limits are never enforced.

1. `schema.sql`
2. `profiles.sql`
3. `admin.sql`
4. `admin-approval-system.sql`
5. `plans.sql`
6. `account.sql`
7. `security-fixes.sql`
8. `security-advisor-plans.sql`
9. `admin-users-storage.sql`

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
- [ ] `profiles.sql`
- [ ] `admin.sql` + `admin-approval-system.sql`
- [ ] `plans.sql`
- [ ] `account.sql` + `security-fixes.sql` + `security-advisor-plans.sql`
- [ ] `admin-users-storage.sql`
- [ ] `bootstrap-admin.sql` with your UUID
- [ ] Deploy `delete-account` Edge Function
- [ ] HIBP / captcha if you want them
- [ ] Env vars on Cloudflare Pages
- [ ] Test: login -> `/account` -> Admin link -> `/admin`
