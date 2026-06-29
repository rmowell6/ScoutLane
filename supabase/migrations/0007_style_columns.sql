-- 0007: style feature (theme + font skin per generation; saved default per profile).
--
-- A StyleRecord is { theme: string, font: string, source: 'recommended'|'user'|'default' }.
-- profiles.style_default: the user's saved style preference (null = never set; UI defaults to the
-- master navy_copper / cambria_calibri). generations.style: the style actually used for that packet.
-- template_key stays — it's a separate concept (layout) from the color/font skin.
--
-- Run after 0001-0006. Idempotent: safe to re-run.

alter table profiles    add column if not exists style_default jsonb;
alter table generations add column if not exists style         jsonb;
