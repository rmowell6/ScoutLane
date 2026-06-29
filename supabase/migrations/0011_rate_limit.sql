-- 0011: shared rate-limit store (containerization).
--
-- The per-request limiter was a per-instance in-memory LRU, so on multiple serverless instances the
-- effective limit was N×(per-instance budget). This moves the counter into Postgres so every instance
-- shares one count. A single atomic RPC does the fixed-window increment + verdict (no read-modify-write
-- race across instances). The app uses the SECRET key (bypasses RLS); RLS is on with NO policies so
-- anon/authenticated can't touch it.
--
-- Run after 0001-0010. Idempotent: safe to re-run.

create table if not exists rate_limit_counters (
  key          text primary key,
  count        int not null default 0,
  window_start timestamptz not null default now()
);

alter table rate_limit_counters enable row level security;

-- Atomic fixed-window hit: increment (or reset if the window expired) and return the verdict.
-- allowed = the post-increment count is within p_limit; retry_after = seconds until the window frees.
create or replace function rate_limit_hit(p_key text, p_limit int, p_window_seconds int)
returns table(allowed boolean, retry_after int)
language plpgsql
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
