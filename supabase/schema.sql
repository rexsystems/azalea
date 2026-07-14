-- Azalea cloud sync — run this once in the Supabase SQL editor.

create table if not exists public.vaults (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version bigint not null default 0,
  kdf_salt text not null,
  verifier text not null,          -- vault key encrypted with the passphrase-derived key
  recovery_envelope text,          -- vault key encrypted with the recovery key
  ciphertext text not null,        -- the encrypted vault (AES-256-GCM, base64)
  updated_at timestamptz not null default now()
);

alter table public.vaults enable row level security;

drop policy if exists "own vault" on public.vaults;
create policy "own vault" on public.vaults for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
