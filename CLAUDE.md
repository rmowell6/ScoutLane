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
- `@anthropic-ai/sdk` — Claude `claude-haiku-4-5` (screen), `claude-sonnet-5` (score + tailor)
- `docx` v9 · `zod` v4 · Vitest v4 · Playwright

## Commands
`npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` (= `tsc --noEmit`) · `npm run test:run` (= `vitest run`) · `npm run e2e` (= `playwright test`)

## Architecture rules
- **Route handlers stay thin**: validate input with Zod `safeParse` → call a `lib/services/*` function → map result to HTTP status. No business logic in handlers.
- **LLM steps that return data use structured outputs**: `anthropic.messages.parse({ output_config: { format: zodOutputFormat(Schema) } })`, then read `message.parsed_output`. Never hand-parse JSON out of text.
- **Doc generation** (`lib/docgen/*`) runs only in routes with `export const runtime = 'nodejs'` (docx `Packer.toBuffer` needs Node `Buffer`).
- **Guardrails run after the model**: `lib/guardrails.ts` checks no-fabrication (claims trace to profile facts), ATS-safety, and style. A failed check blocks or flags — it never ships.
- **Error handling + logging in every step (required)**: every multi-step pipeline, service, and build process must localize failures. Wrap each step so a thrown error carries *which step failed* (see `PacketError`/`runStep` in `lib/services/buildPacket.ts`) and log each step's outcome + duration server-side (`[area] step ok/failed: <name> (<ms>)`). Route handlers map failures to HTTP and include a **safe** step identifier + message (no secrets — API keys never appear in error text). Never swallow an error silently.

## Gotchas
- Next 16: `cookies()`, `headers()`, and route `params` are **async** — `await` them. GET route handlers are **not cached** by default.
- Supabase middleware file is `proxy.ts`; refresh sessions with `supabase.auth.getClaims()` — do **not** trust `getSession()`/`getUser()` in server code. Keys: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (browser), `SUPABASE_SECRET_KEY` (server-only, bypasses RLS).
- Secrets are server-only; **never** prefix a secret with `NEXT_PUBLIC_`. `.env*` is gitignored.
- Vercel Hobby cron runs at most **once/day** (a sub-daily schedule fails at deploy); cron is best-effort, so keep endpoints **idempotent**.
- **Test live endpoints against the production URL only**, not `*-git-*.vercel.app` previews. Vercel **Deployment Protection** gates previews behind SSO, so a preview request returns a `302`/empty body before it reaches the app (looks like an app bug but isn't). Use preview URLs only when the user explicitly says to.
- **DNS for `scoutlane.app` is in AWS Route 53.** Add any DNS records there (e.g. SES sender-domain DKIM CNAMEs for the waitlist email notification, `WAITLIST_NOTIFY_FROM`). Keeping the domain and SES in the same AWS account simplifies sender-domain verification.

## Conventions
- TypeScript `strict` + `noUncheckedIndexedAccess`; avoid `any`; derive types with `z.infer`.
- Validate every external input at the boundary with Zod.
- Small commits, one concern each. **A task is done only when typecheck + lint + tests are green.**
- Enable RLS on every user table, even before auth is wired.
- When unsure about syntax/versions, trust `docs/ScoutLane_Engineering_Plan.md` over training memory.

## Code review
- **Always ground code reviews in the architecture we've actually built.** Before reviewing, (re)read the current architecture in `docs/ScoutLane_POC_Build_Plan.md`, `docs/ScoutLane_Engineering_Plan.md`, and the latest review under `docs/reviews/`, then judge the diff against *those* patterns and invariants (thin handlers → services, structured outputs + `readParsed`, guardrails-after-model, per-step error handling, RLS, the no-fabrication/no-scraping product invariant) — not against generic best practice in the abstract.

## Working rules (owner ruleset)

### Subagents
- **Do not spawn a subagent for work you can complete directly in a single response** (e.g. refactoring a function you can already see).
- **Spawn multiple subagents in the same turn when fanning out** across items or reading multiple files.

### Frontend aesthetics
<frontend_aesthetics>
NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto, Arial, system fonts), cliched color schemes (particularly purple gradients on white or dark backgrounds), predictable layouts and component patterns, and cookie-cutter design that lacks context-specific character. Use unique fonts, cohesive colors and themes, and animations for effects and micro-interactions.
</frontend_aesthetics>

### Issue reporting (reviews / audits)
- **Report every issue you find**, including ones you are uncertain about or consider low-severity. Do not filter for importance or confidence at this stage; a separate verification step does that. The goal is **coverage**: better to surface a finding that later gets filtered out than to silently drop a real bug.
- For each finding, include your **confidence level** and an **estimated severity** so a downstream filter can rank them.
