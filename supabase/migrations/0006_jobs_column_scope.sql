-- 0006: column-scope the public job read. 0004 added a row policy letting anon/authenticated SELECT
-- live jobs, but with no column restriction that exposes the full jd_raw body and internal columns
-- (validated_at, status, external_id, jd_parsed, canonical_url) to the browser. The app reads the
-- pool SERVER-SIDE with the secret key (service_role bypasses RLS and is unaffected by these grants),
-- so restrict the anon/authenticated roles to only the columns the picker/discovery actually display.
--
-- RLS (0004) still gates WHICH rows are visible (status = 'live'); these privileges gate WHICH
-- columns. The row policy may reference `status` in its USING clause even though clients can no
-- longer SELECT it — policy evaluation is independent of column SELECT privileges.
--
-- Run after 0001-0005. Idempotent: re-running REVOKE/GRANT is safe.

revoke select on jobs from anon, authenticated;
grant select (id, source, title, company, location, url, created_at) on jobs to anon, authenticated;
