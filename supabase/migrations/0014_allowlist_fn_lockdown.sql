-- 0014: lock down EXECUTE on the invite-allowlist trigger function.
--
-- Postgres grants EXECUTE on every new function to PUBLIC by default. 0008 created
-- public.enforce_invite_allowlist() (the SECURITY DEFINER trigger that gates sign-ups against
-- public.allowlist) but never revoked that default grant, so the Supabase Security Advisor flags it as
-- "Public / Signed-In Users Can Execute SECURITY DEFINER Function". This mirrors the fix 0012 already
-- applied to rate_limit_hit(): revoke from PUBLIC and the client roles.
--
-- Safe by construction: a trigger fires the function as part of the triggering statement and does NOT
-- require the caller to hold EXECUTE, so the invite gate keeps working unchanged. Direct invocation was
-- never possible anyway (Postgres refuses to call a `returns trigger` function outside a trigger).
--
-- Run after 0001-0013. Idempotent: re-running revoke is a no-op.

revoke execute on function public.enforce_invite_allowlist() from public;
revoke execute on function public.enforce_invite_allowlist() from anon, authenticated;
