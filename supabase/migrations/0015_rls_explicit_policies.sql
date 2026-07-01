-- 0015: give every RLS-enabled public table an explicit policy, clearing the Supabase Security
-- Advisor's "RLS Enabled No Policy" info items.
--
-- Every one of these tables is accessed ONLY server-side via the SUPABASE_SECRET_KEY (service_role),
-- which bypasses RLS entirely — there is no browser/anon read path in the app. "RLS on + no policy"
-- already denies all anon/authenticated access by default, so this migration does not change who can
-- reach what; it makes the intended posture EXPLICIT so a future accidental GRANT can't silently open
-- a table, and it satisfies the advisor.
--
-- Two shapes:
--   1. Server-only tables (allowlist, ingest_run_markers, rate_limit_counters, waitlist): an explicit
--      deny-all policy for anon/authenticated. Writes/reads keep flowing through the secret key.
--   2. Tables with a deliberate client policy (jobs, generations): re-assert the intended policy from
--      0004 / 0009. These being flagged as policy-less means those migrations are not applied in the
--      deployed project (drift); re-asserting here heals it. Idempotent (drop-if-exists + create).
--
-- Run after 0001-0014. Idempotent: safe to re-run.

-- ── 1. Explicit deny-all for the server-only tables ──────────────────────────────────────────────
-- A permissive policy that matches nothing: anon/authenticated get zero rows and cannot write.
-- service_role bypasses RLS, so server code is unaffected. (SECURITY DEFINER trigger paths, e.g. the
-- allowlist invite gate, run as the definer and are likewise unaffected.)
drop policy if exists "allowlist: no client access" on public.allowlist;
create policy "allowlist: no client access"
  on public.allowlist for all to anon, authenticated
  using (false) with check (false);

drop policy if exists "ingest_run_markers: no client access" on public.ingest_run_markers;
create policy "ingest_run_markers: no client access"
  on public.ingest_run_markers for all to anon, authenticated
  using (false) with check (false);

drop policy if exists "rate_limit_counters: no client access" on public.rate_limit_counters;
create policy "rate_limit_counters: no client access"
  on public.rate_limit_counters for all to anon, authenticated
  using (false) with check (false);

drop policy if exists "waitlist: no client access" on public.waitlist;
create policy "waitlist: no client access"
  on public.waitlist for all to anon, authenticated
  using (false) with check (false);

-- ── 2. Re-assert the deliberate client policies (heals drift) ─────────────────────────────────────
-- jobs: least-privilege read of the LIVE pool only (mirrors 0004). Expired/unverified rows stay
-- server-only; no write policy (ingestion runs with the secret key).
drop policy if exists "live jobs are public-read" on public.jobs;
create policy "live jobs are public-read"
  on public.jobs for select to anon, authenticated
  using (status = 'live');

-- generations: owner-only read/write (mirrors 0009). Defense-in-depth for when packet history is
-- persisted; there is no client writer yet, but the policy must exist so the table isn't policy-less.
drop policy if exists "own generations select" on public.generations;
create policy "own generations select"
  on public.generations for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "own generations insert" on public.generations;
create policy "own generations insert"
  on public.generations for insert to authenticated
  with check ((select auth.uid()) = user_id);
