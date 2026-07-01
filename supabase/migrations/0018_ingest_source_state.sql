-- 0018: ATS conditional-GET state.
--
-- The ATS fetchers (greenhouse/lever/ashby) each pull one static per-company feed on every cron run,
-- unconditionally, re-downloading and re-parsing boards that have not changed since the last run.
-- Store the ETag / Last-Modified each feed returns so the next run can send If-None-Match /
-- If-Modified-Since and skip the whole fetch+parse on a 304 (not modified).
--
-- Keyed by the per-board source key '<provider>:<token>' (e.g. 'greenhouse:acme'), one row per feed.
-- Server-only bookkeeping (no user data); written with the secret key like ingest_run_markers (0005).
-- This is a cache, not a source of truth: the writer degrades to a full fetch if a row is missing.
--
-- Run after 0001-0017. Idempotent: safe to re-run.
create table if not exists ingest_source_state (
  source          text primary key,          -- '<provider>:<token>', one row per ATS feed
  etag            text,
  last_modified   text,
  last_checked_at timestamptz not null default now()
);

-- RLS on (CLAUDE.md invariant). No policy: server writes use the secret key (bypasses RLS);
-- anon/authenticated get no access by omission. The row carries no user data regardless.
alter table ingest_source_state enable row level security;
