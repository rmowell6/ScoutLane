-- ScoutLane initial schema (Engineering Plan §4.4, POC Build Plan §4).
-- Thin but forward-compatible: user_id is nullable until auth lands. RLS is enabled on every
-- user table now, even pre-auth (CLAUDE.md invariant) — server writes use the secret key, which
-- bypasses RLS; anon/authenticated get no access until policies are added.
--
-- NOTE: the current /api/packet pipeline is stateless (resume + JD in, packet out). These tables
-- are scaffolded for when generations/profiles are persisted; wiring them is a later step.

create extension if not exists pgcrypto;

-- structured resume + locked template/voice preferences
create table if not exists profiles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid,
  source_resume text,
  structured    jsonb,
  template_key  text default 'ats_default',
  created_at    timestamptz not null default now()
);

-- a target job (user-supplied for the POC; ingested later)
create table if not exists jobs (
  id            uuid primary key default gen_random_uuid(),
  source        text,                       -- 'user' | 'greenhouse' | 'lever' | 'ashby'
  url           text,
  canonical_url text,
  title         text,
  company       text,
  jd_raw        text,
  jd_parsed     jsonb,                       -- { mustHave[], niceToHave[], comp, location, employerType }
  validated_at  timestamptz,
  status        text,                        -- 'live' | 'expired' | 'unverified'
  created_at    timestamptz not null default now()
);

-- one generated packet
create table if not exists generations (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid references profiles (id) on delete cascade,
  job_id           uuid references jobs (id) on delete cascade,
  scores           jsonb,
  keyword_coverage jsonb,
  resume_doc_path  text,
  cover_doc_path   text,
  guardrail_report jsonb,
  created_at       timestamptz not null default now()
);

alter table profiles    enable row level security;
alter table jobs        enable row level security;
alter table generations enable row level security;

-- Owner-only read of profiles once auth is wired. (select auth.uid()) caches per statement.
create policy "own profiles only"
  on profiles for select
  to authenticated
  using ((select auth.uid()) = user_id);
