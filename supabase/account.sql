-- Self-serve account deletion for the management website.
-- Run AFTER schema.sql.
--
-- Account deletion is handled by the `delete-account` Edge Function (not a public
-- SECURITY DEFINER RPC), so the Security Advisor does not flag anon/authenticated
-- execution of privileged functions.
--
-- Deploy once (from azalea-web repo):
--   supabase functions deploy delete-account
--
-- If you previously ran the old RPC version, also run security-fixes.sql.

drop function if exists public.delete_own_account();
