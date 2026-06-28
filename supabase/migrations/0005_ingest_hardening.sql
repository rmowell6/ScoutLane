-- 0005: data-integrity + cost hardening for the daily ingest cron.
--
-- (1) Index the expire/reclaim scans. Stale-job retention filters on (status, validated_at): the
--     soft-expire UPDATE (status='live' AND validated_at < cutoff) and the reclaim DELETE
--     (status='expired' AND validated_at < cutoff). Without this index both sequentially scan the
--     whole jobs table as the pool grows.
--
-- (2) Apify run marker. The metered Apify leg (Wellfound $0.99/run flat) must fire at most once per
--     UTC day even if the best-effort Vercel cron double-fires or a near-120s-timeout function
--     re-enters. DB-row upsert on (source, external_id) dedups rows WRITTEN, never runs CHARGED — so
--     a separate marker, claimed atomically (INSERT ... ON CONFLICT DO NOTHING) BEFORE the actor
--     runs, is the cost-idempotency guard. The primary key IS the dedup target.
--
-- Run after 0001-0004. Idempotent: safe to re-run.

create index if not exists jobs_status_validated_at_idx
  on jobs (status, validated_at);

create table if not exists ingest_run_markers (
  run_key    text primary key,            -- e.g. 'apify:2026-06-21' (one claim per UTC day)
  claimed_at timestamptz not null default now()
);

-- RLS on (CLAUDE.md invariant). No policy: server writes use the secret key (bypasses RLS);
-- anon/authenticated get no access by omission. The marker carries no user data regardless.
alter table ingest_run_markers enable row level security;
