-- 0008: invite allowlist (auth gate). Access is invite-only: a new account may be created ONLY if
-- its email is on public.allowlist. This is enforced in Postgres (not just the UI) by a BEFORE
-- INSERT trigger on auth.users, so it covers every sign-up path — magic link AND Google OAuth.
--
-- Existing users (already rows in auth.users) are unaffected; the trigger fires only on INSERT, i.e.
-- the first time a given email signs in. Admins manage invites with the SECRET key / SQL editor.
--
-- Run after 0001-0007. Idempotent: safe to re-run.

-- ── Allowlist table ────────────────────────────────────────────────────────────────────────────
create table if not exists public.allowlist (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);

-- RLS on, with NO policies: anon/authenticated clients can never read or write the allowlist. Only
-- the service role (SUPABASE_SECRET_KEY) and the SECURITY DEFINER trigger below bypass RLS.
alter table public.allowlist enable row level security;

-- ── Enforcement trigger ──────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER so it can read public.allowlist regardless of the caller; search_path pinned to
-- avoid hijacking. Email match is case-insensitive. Raising here aborts the auth.users INSERT, so an
-- un-invited sign-up fails cleanly (the user is bounced back to /sign-in with an access_denied note).
create or replace function public.enforce_invite_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.allowlist a where lower(a.email) = lower(new.email)
  ) then
    raise exception 'ScoutLane is invite-only: % is not on the allowlist', new.email
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_invite_allowlist on auth.users;
create trigger enforce_invite_allowlist
  before insert on auth.users
  for each row execute function public.enforce_invite_allowlist();

-- ── Seed your own invite(s) here, or via the SQL editor / service role, e.g.:
--   insert into public.allowlist (email, note) values ('you@example.com', 'founder')
--   on conflict (email) do nothing;
