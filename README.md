# ScoutLane

ScoutLane turns a validated job shortlist into a one-click **application packet**: a fit
assessment plus a tailored, ATS-safe resume and cover letter, generated from the user's real
history — with a code-enforced **no-fabrication** guardrail.

This repo is at **Milestone M0** (skeleton). The packet pipeline (M1) is not built yet.
See [`docs/ScoutLane_POC_Build_Plan.md`](docs/ScoutLane_POC_Build_Plan.md) for the roadmap and
[`docs/ScoutLane_Engineering_Plan.md`](docs/ScoutLane_Engineering_Plan.md) for authoritative,
verified syntax and architecture rules.

## Stack

- **Next.js 16.2** (App Router, TypeScript) · React 19 · Node 24 (CI) / 20.9+ (local)
- **Supabase** via `@supabase/ssr` (+ `@supabase/supabase-js`), session refresh in `proxy.ts`
- **Anthropic** `@anthropic-ai/sdk` — Claude Haiku/Sonnet/Opus
- **docx** (doc generation) · **zod** (validation) · **Vitest** (unit) · Playwright (e2e, later)

## Getting started

```bash
npm install
cp .env.local.example .env.local   # then fill in the values below
npm run dev                        # http://localhost:3000
```

Health check: `GET /api/health` → `{ "ok": true }`.

## Environment variables

Create `.env.local` (gitignored — never commit it). Only `NEXT_PUBLIC_*` values reach the
browser; never prefix a secret with `NEXT_PUBLIC_`.

| Variable | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser + server | `sb_publishable_...` |
| `SUPABASE_SECRET_KEY` | **server only** | `sb_secret_...` — bypasses RLS |
| `ANTHROPIC_API_KEY` | **server only** | `sk-ant-...` |
| `CRON_SECRET` | server only | Phase 2 cron auth |

The app starts without live Supabase/Anthropic credentials — clients are only constructed when
a request actually uses them, so M0 runs and the health route responds with placeholder env vars.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` / `npm run test:run` | Vitest (watch / once) |
| `npm run e2e` | Playwright (added in a later milestone) |

**A task is done only when typecheck + lint + tests are green** (see `CLAUDE.md`).

## Project layout

```
app/
  api/health/route.ts     # GET → { ok: true }
  layout.tsx  page.tsx     # default Next.js shell
lib/
  anthropic.ts             # Anthropic client + model constants
  supabase/{client,server,admin}.ts
proxy.ts                   # Next 16 middleware: Supabase session refresh via getClaims()
docs/                      # build plan + engineering plan + handoff guide
.github/workflows/ci.yml   # typecheck → lint → test on Node 24
```

## Deploying to Vercel

See **[`docs/DEPLOY.md`](docs/DEPLOY.md)** for the full runbook. In short: import the repo into
Vercel (Next.js auto-detected via `vercel.json`), pick Node 22.x+, and set the environment
variables above. The app deploys and serves `/` and `/api/health` even before Supabase is
configured — `proxy.ts` skips session refresh until the Supabase env vars are present. The
default Node runtime is used; doc-generation routes added later pin `export const runtime = 'nodejs'`.
