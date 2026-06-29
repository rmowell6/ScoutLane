-- 0013: waitlist capture (M4). The public landing's "request access" form writes here. This is the
-- demand-signal funnel for the POC: people ask for access, an admin promotes them into the invite
-- allowlist (migration 0008) when ready. Distinct from `allowlist` on purpose — a waitlist row is an
-- *unverified* request from an anonymous visitor; an allowlist row is a granted invite.
--
-- Server writes use the SECRET key (bypasses RLS). RLS is ON with NO policies, so anon/authenticated
-- clients can never read the list (no email harvesting) or write it directly (writes go through the
-- rate-limited /api/waitlist handler).
--
-- Run after 0001-0012. Idempotent: safe to re-run.

create table if not exists public.waitlist (
  id         uuid primary key default gen_random_uuid(),
  -- UNIQUE column (not an expression index): the /api/waitlist handler always normalizes to
  -- lowercase before insert, so a plain unique on `email` IS case-insensitive in practice AND can be
  -- targeted by an ON CONFLICT upsert (PostgREST `onConflict` takes a column/constraint, not an
  -- expression). A repeat signup is then a silent no-op, not a duplicate or a 409.
  email      text not null unique,
  source     text,                       -- where the signup came from (e.g. 'landing')
  note       text,                       -- optional free-text context the visitor provided
  status     text not null default 'pending'
             check (status in ('pending', 'invited', 'declined')),
  created_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;

-- Promote a waitlist request into the invite allowlist (the manual approval step). Run by an admin
-- with the SECRET key / SQL editor when granting access:
--
--   update public.waitlist set status = 'invited' where lower(email) = lower('person@example.com');
--   insert into public.allowlist (email, note) values ('person@example.com', 'from waitlist')
--     on conflict (email) do nothing;
--
-- Kept as a comment (not a function) so approval stays a deliberate, audited manual action.
