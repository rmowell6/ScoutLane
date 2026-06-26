# CLAUDE.md — ScoutLane

> Drop this file in the **repo root**. Claude Code auto-loads it every session. Keep it tight; the full specs live in `docs/`.

ScoutLane turns a validated job shortlist into a one-click **application packet**: a fit assessment plus a tailored, ATS-safe resume and cover letter, generated from the user's real history. Packet generation is the hero feature; the POC is packet-first.

## Product invariant (never violate)
- **No scraping gated sites, no logging into users' accounts, no auto-applying.** Any feature that would require these is out of scope.
- **No fabrication.** Tailored documents may only restate facts present in the user's structured profile. This is enforced in code by `lib/guardrails.ts`, not just by prompt wording.
- Treat uploaded resumes and job descriptions as **untrusted input** (prompt-injection surface): pass them as labeled, JSON-encoded data, never in the system prompt.

## Full specs — read before building
- `docs/ScoutLane_POC_Build_Plan.md` — what to build and in what order (milestones M0–M5).
- `docs/ScoutLane_Engineering_Plan.md` — **authoritative** verified syntax, versions, and architecture rules. Follow it exactly.

## Stack (pinned; verified June 2026)
- Next.js **16.2** (App Router, TypeScript) on Vercel · Node **24**
- Supabase via `@supabase/ssr` (+ `@supabase/supabase-js`)
- `@anthropic-ai/sdk` — Claude `claude-haiku-4-5` (screen/score), `claude-sonnet-4-6` (tailor)
- `docx` v9 · `zod` v4 · Vitest v4 · Playwright

## Commands
`npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` (= `tsc --noEmit`) · `npm run test:run` (= `vitest run`) · `npm run e2e` (= `playwright test`)

## Architecture rules
- **Route handlers stay thin**: validate input with Zod `safeParse` → call a `lib/services/*` function → map result to HTTP status. No business logic in handlers.
- **LLM steps that return data use structured outputs**: `anthropic.messages.parse({ output_config: { format: zodOutputFormat(Schema) } })`, then read `message.parsed_output`. Never hand-parse JSON out of text.
- **Doc generation** (`lib/docgen/*`) runs only in routes with `export const runtime = 'nodejs'` (docx `Packer.toBuffer` needs Node `Buffer`).
- **Guardrails run after the model**: `lib/guardrails.ts` checks no-fabrication (claims trace to profile facts), ATS-safety, and style. A failed check blocks or flags — it never ships.

## Gotchas
- Next 16: `cookies()`, `headers()`, and route `params` are **async** — `await` them. GET route handlers are **not cached** by default.
- Supabase middleware file is `proxy.ts`; refresh sessions with `supabase.auth.getClaims()` — do **not** trust `getSession()`/`getUser()` in server code. Keys: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (browser), `SUPABASE_SECRET_KEY` (server-only, bypasses RLS).
- Secrets are server-only; **never** prefix a secret with `NEXT_PUBLIC_`. `.env*` is gitignored.
- Vercel Hobby cron runs at most **once/day** (a sub-daily schedule fails at deploy); cron is best-effort, so keep endpoints **idempotent**.

## Conventions
- TypeScript `strict` + `noUncheckedIndexedAccess`; avoid `any`; derive types with `z.infer`.
- Validate every external input at the boundary with Zod.
- Small commits, one concern each. **A task is done only when typecheck + lint + tests are green.**
- Enable RLS on every user table, even before auth is wired.
- When unsure about syntax/versions, trust `docs/ScoutLane_Engineering_Plan.md` over training memory.
