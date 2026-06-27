-- M3 hardening: the job pool is non-sensitive, public ATS data, but RLS is enabled on `jobs`
-- (0001) with no policy — so anon/authenticated clients currently get nothing, and only the
-- server's secret key (which bypasses RLS) can read it. That's safe but brittle: any future
-- direct-from-browser read of the pool would silently return empty. Add an explicit, least-
-- privilege read policy so the *live* pool is readable, and only the live pool.
--
-- Live rows only: expired/unverified postings stay server-only. No write policies — ingestion
-- runs server-side with the secret key, so anon/authenticated remain read-only by omission.
--
-- Run after 0001–0003. Idempotent: safe to re-run.

drop policy if exists "live jobs are public-read" on jobs;
create policy "live jobs are public-read"
  on jobs for select
  to anon, authenticated
  using (status = 'live');

-- listJobs() orders the live pool by created_at desc; a partial index matching that predicate
-- keeps the picker query index-only as the pool grows, instead of scanning expired rows.
create index if not exists jobs_live_created_at_idx
  on jobs (created_at desc)
  where status = 'live';
