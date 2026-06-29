-- 0009: Auth Phase B — per-user ownership of stored data.
--
-- profiles.user_id already exists (0001) and is now STAMPED on save and FILTERED on read in
-- lib/services/profileStore.ts (the server uses the secret key, which bypasses RLS, so that
-- code-level predicate is the primary enforcement). These RLS policies are defense-in-depth for any
-- future anon/authenticated-key access. generations gains user_id for when packet history is
-- persisted (no writer yet).
--
-- Run after 0001-0008. Idempotent: safe to re-run.

alter table generations add column if not exists user_id uuid;

-- ── profiles: round out owner-only policies (0001 added SELECT) ──────────────────────────────────
drop policy if exists "own profiles insert" on profiles;
create policy "own profiles insert"
  on profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "own profiles update" on profiles;
create policy "own profiles update"
  on profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "own profiles delete" on profiles;
create policy "own profiles delete"
  on profiles for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ── generations: owner-only read/write ──────────────────────────────────────────────────────────
drop policy if exists "own generations select" on generations;
create policy "own generations select"
  on generations for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "own generations insert" on generations;
create policy "own generations insert"
  on generations for insert to authenticated
  with check ((select auth.uid()) = user_id);
