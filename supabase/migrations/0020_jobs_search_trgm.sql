-- 0020: trigram indexes for the job picker's title/company search.
--
-- listJobs() (lib/services/jobStore.ts) filters the pool with a case-insensitive substring search:
--   .or('title.ilike.%<term>%,company.ilike.%<term>%')
-- A leading-wildcard ILIKE cannot use a plain b-tree index, so this scans every candidate row. It is
-- bounded today (the status filter narrows the set and the live pool is small), but degrades as the
-- pool grows past a few hundred rows. A GIN trigram index makes ILIKE '%term%' index-backed: the
-- planner can bitmap-OR the two indexes for the title/company OR and AND the status filter on top, so
-- the existing query needs NO change to benefit.
--
-- pg_trgm is a standard, Supabase-supported extension (enable-able via `create extension`). The guard
-- is idempotent. If a restricted plan rejects enabling it here, enable pg_trgm once from the Supabase
-- dashboard, then re-run this migration; do not drop the index requirement silently.
--
-- jobs.title and jobs.company are text (0001). Additive only, no column or data changes.
--
-- Run after 0001-0019. Idempotent: safe to re-run.
create extension if not exists pg_trgm;
create index if not exists jobs_title_trgm_idx on jobs using gin (title gin_trgm_ops);
create index if not exists jobs_company_trgm_idx on jobs using gin (company gin_trgm_ops);
