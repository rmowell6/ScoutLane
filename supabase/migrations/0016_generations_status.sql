-- 0016: generations.status. Distinguish a SHIPPED packet from a guardrail-BLOCKED one, so the
-- generations table records blocked attempts too. Without this, a user who keeps getting blocked and
-- gives up is invisible in the history (looks identical to someone who never tried), and there is no
-- durable signal for how often / why packets get blocked to tune the guardrails and rubric over time.
--
-- Every row written before this migration was, by construction, a shipped packet, the blocked path
-- never wrote a row until now, so the 'shipped' default backfills existing rows correctly with NO
-- manual data migration. Small-enum column constrained like waitlist.status (0013).
--
-- Run after 0001-0015. Idempotent: safe to re-run.
alter table public.generations
  add column if not exists status text not null default 'shipped'
  constraint generations_status_check check (status in ('shipped', 'blocked'));
