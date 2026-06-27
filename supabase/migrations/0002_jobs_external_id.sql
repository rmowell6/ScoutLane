-- M3: idempotent job ingestion. The pool is fetched from public ATS board APIs (Greenhouse /
-- Lever / Ashby) and re-ingested periodically, so each external posting needs a stable key to
-- upsert on instead of inserting duplicates. (source, external_id) is that key.
--
-- Run after 0001_init.sql. Idempotent: safe to re-run.

alter table jobs add column if not exists external_id text;
alter table jobs add column if not exists location text;

-- Upsert target for ingestion: one row per (provider, provider's posting id).
create unique index if not exists jobs_source_external_id_key
  on jobs (source, external_id);
