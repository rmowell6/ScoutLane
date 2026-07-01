-- 0019: ownership / foreign-key indexes.
--
-- The RLS policies and the (upcoming) owner-scoped read paths filter generations and profiles by the
-- exact columns indexed here, but none of these columns is indexed yet. There is no bulk-read path
-- for either table today, so the impact is zero right now, but the first "my generation history" or
-- "my profiles" listing would sequential-scan from day one. These are cheap b-tree indexes that make
-- an owner lookup, and the FK joins from generations to profiles/jobs, index-backed instead.
--
-- All columns are uuid and already exist: profiles.user_id (0001), generations.user_id (0009/0015),
-- generations.profile_id and generations.job_id (0001). Additive only, no column or data changes.
--
-- Run after 0001-0018. Idempotent: safe to re-run.
create index if not exists profiles_user_id_idx on profiles (user_id);
create index if not exists generations_user_id_idx on generations (user_id);
create index if not exists generations_profile_id_idx on generations (profile_id);
create index if not exists generations_job_id_idx on generations (job_id);
