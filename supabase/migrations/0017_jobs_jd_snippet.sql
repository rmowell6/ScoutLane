-- 0017: jd_snippet generated column.
--
-- listJobsForMatch (the role-discovery lexical pre-filter) only needs enough of each JD to carry its
-- skill vocabulary, but it was SELECTing the full jd_raw body (up to 60,000 chars) for up to 150 rows
-- per discovery request and then truncating to 600 chars in JS. That ships the entire JD body over
-- the wire only to throw ~99% of it away. Compute the 600-char snippet once, at write time, as a
-- STORED generated column, so the read selects a tiny column instead of the whole body.
--
-- GENERATED ALWAYS AS (...) STORED needs Postgres 12+ (Supabase runs 15+) and requires NO ingest
-- changes: every insert/update recomputes jd_snippet from jd_raw automatically. left(jd_raw, 600)
-- caps characters exactly as the old client-side .slice(0, 600) did for JD text. jd_raw is nullable,
-- so left(null, 600) yields null; the read boundary coerces that to '' like it did before.
--
-- NOT granted to anon/authenticated: like jd_raw (see 0006), the snippet is read server-side only
-- (the secret key bypasses column grants), so it stays off the browser-visible column list.
--
-- Run after 0001-0016. Idempotent: safe to re-run.
alter table jobs
  add column if not exists jd_snippet text generated always as (left(jd_raw, 600)) stored;
