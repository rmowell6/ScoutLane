-- 0012: harden the rate_limit_hit RPC (security review B1-12).
--
-- Two defense-in-depth fixes on the function from 0011:
--   1. Pin search_path. A SECURITY-sensitive function with a mutable search_path can be hijacked: a
--      caller (or a table owner) that can create objects in an earlier schema on the path could shadow
--      `rate_limit_counters` / `make_interval` and run their definition instead. Pinning to a known
--      schema set removes that ambiguity. (Also clears the Supabase linter "function_search_path_mutable"
--      warning.) The function is SECURITY INVOKER (the default), so this is hardening, not privilege.
--   2. Lock down EXECUTE. Postgres grants EXECUTE on new functions to PUBLIC by default. The limiter is
--      called only by the server (SECRET key → service_role); anon/authenticated have no business
--      invoking it directly (doing so could let a logged-in user burn another key's window, or probe
--      timing). Revoke from PUBLIC and re-grant solely to service_role.
--
-- Run after 0011. Idempotent: re-running create-or-replace + revoke/grant is safe.

-- Re-declare the function identically to 0011 but with an explicit, pinned search_path. `set ... from
-- current` is avoided so the path is deterministic regardless of the running role's settings.
create or replace function rate_limit_hit(p_key text, p_limit int, p_window_seconds int)
returns table(allowed boolean, retry_after int)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_now    timestamptz := clock_timestamp();
  v_window interval := make_interval(secs => p_window_seconds);
  v_count  int;
  v_start  timestamptz;
begin
  insert into rate_limit_counters as r (key, count, window_start)
    values (p_key, 1, v_now)
  on conflict (key) do update
    set count        = case when r.window_start < v_now - v_window then 1 else r.count + 1 end,
        window_start = case when r.window_start < v_now - v_window then v_now else r.window_start end
  returning r.count, r.window_start into v_count, v_start;

  if v_count > p_limit then
    return query select false, greatest(1, ceil(extract(epoch from (v_start + v_window - v_now))))::int;
  else
    return query select true, 0;
  end if;
end;
$$;

-- Only the server (service_role) may call it. anon/authenticated are denied.
revoke execute on function rate_limit_hit(text, int, int) from public;
revoke execute on function rate_limit_hit(text, int, int) from anon, authenticated;
grant  execute on function rate_limit_hit(text, int, int) to service_role;
