-- Candidate preferences for the deterministic fit engine (target comp, target lanes, etc.).
-- User-set signals a resume doesn't contain; persisted alongside the structured profile so a
-- saved profile carries them across jobs. Nullable JSONB. Run after 0001. Idempotent.

alter table profiles add column if not exists preferences jsonb;
