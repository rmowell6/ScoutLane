# Deploying ScoutLane to Vercel (M0)

This is the runbook for standing up the M0 skeleton as a live URL. It does **not** require
Supabase or Anthropic to be configured first — the app boots and serves `/` and `/api/health`
with no env vars (the `proxy.ts` middleware skips session refresh until Supabase is wired).

## Prerequisites

- A GitHub repo (this one) and a Vercel account.
- The PR merged to `main` (or deploy a preview straight from the feature branch).

## 1. Import the project

1. Vercel → **Add New… → Project** → import `rmowell6/ScoutLane`.
2. Framework preset: **Next.js** (auto-detected; also pinned in `vercel.json`).
3. Build command `next build`, output handled by Vercel — leave defaults.
4. **Node.js version:** select **22.x or later** in Project → Settings → General.
   `package.json` sets `engines.node >= 20`, so Vercel uses its supported LTS.

## 2. Environment variables (Project → Settings → Environment Variables)

The app deploys without these, but Supabase/Anthropic features stay inert until they are set.
Add them for **Production** (and Preview if you want PR previews to be fully functional):

| Variable | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | all | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | all | `sb_publishable_...` |
| `SUPABASE_SECRET_KEY` | **server only** | `sb_secret_...` — bypasses RLS; never expose |
| `ANTHROPIC_API_KEY` | **server only** | `sk-ant-...` |
| `CRON_SECRET` | server only | Phase 2 cron auth |

Never prefix a secret with `NEXT_PUBLIC_` — only `NEXT_PUBLIC_*` values are shipped to the browser.

## 3. Deploy

Push to `main` (or open/refresh the PR for a Preview deploy). Vercel runs `next build` — the
same build validated locally in CI.

## 4. Validate the live deployment

```bash
# Replace with your deployment URL
curl -sS https://<your-app>.vercel.app/api/health      # -> {"ok":true}
curl -sS -o /dev/null -w "%{http_code}\n" https://<your-app>.vercel.app/   # -> 200
```

Both should succeed even before env vars are configured. Once Supabase env vars are set,
`proxy.ts` begins refreshing sessions on matched routes.

## Notes

- **Runtime:** App Router route handlers default to the Node.js runtime. Doc-generation routes
  added in M1 will pin `export const runtime = 'nodejs'` (docx needs Node `Buffer`).
- **Function duration:** `vercel.json` sets `app/api/**` to `maxDuration: 60`. Raise it (up to
  your plan's limit) once the multi-step packet pipeline lands in M1.
- **Cron (Phase 2):** add a `crons` entry to `vercel.json`; Hobby allows at most one run/day and
  cron only runs on Production — keep the endpoint idempotent.
- **Secrets:** `.env.local` is gitignored and never committed; production secrets live only in
  Vercel's encrypted env store and CI's `${{ secrets.* }}`.
