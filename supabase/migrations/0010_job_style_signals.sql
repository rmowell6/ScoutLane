-- 0010: job-row style classification cache.
--
-- A pooled job's domain/seniority/role-type classification is a pure function of its (static) JD, so
-- recommendStyle classifies it once and caches the result here; a repeat packet against the same job
-- reuses it and skips the classification LLM call. DB-backed so it's shared across all instances
-- (container-friendly), unlike an in-memory cache. jsonb shape: { domain, seniority, roleType }.
--
-- Run after 0001-0009. Idempotent: safe to re-run.

alter table jobs add column if not exists style_signals jsonb;
