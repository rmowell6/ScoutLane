# Deploying ScoutLane to Vercel (M0)

This is the runbook for standing up the M0 skeleton as a live URL. It does **not** require
Supabase or Anthropic to be configured first — the app boots and serves `/` and `/api/health`
with no env vars (the `proxy.ts` middleware skips session refresh until Supabase is wired).

## Prerequisites

- A GitHub repo (this one) and a Vercel account.
- The PR merged to `main` (or deploy a preview straight from the feature branch).

## 1. Import the project

1. Vercel → **Add New… → Project** → import `<your-org>/ScoutLane`.
2. Framework preset: **Next.js** (auto-detected; also pinned in `vercel.json`).
3. Build command `next build`, output handled by Vercel — leave defaults.
4. **Node.js version:** **24.x** — pinned by `engines.node` in `package.json` and `.nvmrc`, and
   matches CI. Vercel reads `engines.node`, so no manual Project Settings change is needed.
   (Vercel supports 24.x/22.x; Node 20 reached end-of-maintenance on 2026-04-30, so we avoid it.)

## 2. Environment variables (Project → Settings → Environment Variables)

The app deploys without these, but Supabase/Anthropic features stay inert until they are set.
Add them for **Production** (and Preview if you want PR previews to be fully functional):

| Variable | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | all | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | all | `sb_publishable_...` |
| `SUPABASE_SECRET_KEY` | **server only** | `sb_secret_...` — bypasses RLS; never expose |
| `ANTHROPIC_API_KEY` | **server only** | `sk-ant-...` |
| `CRON_SECRET` | server only | Cron auth (required for the ingest routes in production) |

Never prefix a secret with `NEXT_PUBLIC_` — only `NEXT_PUBLIC_*` values are shipped to the browser.

### Waitlist signup email notification (OPTIONAL — AWS SES)

Landing-page waitlist signups are always captured in the `waitlist` table. To also get **emailed**
when someone joins, wire AWS SES. When these are unset the notifier is a no-op — signups are still
recorded, only the email is skipped — so this can be added at any time without touching the form.

| Variable | Scope | Notes |
|---|---|---|
| `AWS_REGION` | server only | e.g. `us-east-1` (the region your SES identity lives in) |
| `AWS_ACCESS_KEY_ID` | **server only** | IAM user with a `ses:SendEmail` policy |
| `AWS_SECRET_ACCESS_KEY` | **server only** | matching secret; never expose |
| `WAITLIST_NOTIFY_FROM` | server only | a **verified** SES sender, e.g. `notify@scoutlane.app` |
| `WAITLIST_NOTIFY_TO` | server only | the admin inbox to notify on each signup |

**One-time AWS setup:**
1. **SES → Verify a sender.** Verify the domain `scoutlane.app` (add the DKIM CNAMEs SES gives you to
   Route 53) so you can send from `notify@scoutlane.app`, or just verify a single email address.
2. **Sandbox:** a new SES account can only send to **verified** recipients, so also verify
   `WAITLIST_NOTIFY_TO`. That is all that is needed to notify yourself — no production-access request.
   (Request production access later only if you want to email arbitrary users, e.g. M5 invites.)
3. **IAM:** create a user with an inline policy allowing `ses:SendEmail` (and `ses:SendRawEmail`),
   generate an access key, and set the four `AWS_*` / `WAITLIST_NOTIFY_*` vars above in Vercel.

The send runs via Next's `after()` (after the response), so it never slows or fails a signup.

### Job-board providers (all OPTIONAL — `/api/jobs/ingest-all`)

The unified ingest cron pulls ATS boards plus a job-board aggregator. Four aggregator sources are
**free with no key** (Himalayas, Arbeitnow, Remotive, RemoteOK) and run automatically — but they are
**remote-only** boards. To add **US onsite/hybrid** coverage, set any of these free-tier keys; each
provider lights up only when its vars are present:

| Variable | Provider | Coverage | Get a key |
|---|---|---|---|
| `JSEARCH_RAPIDAPI_KEY` | JSearch | Indeed + LinkedIn + Glassdoor + ZipRecruiter (200 req/mo) | rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch |
| `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` | Adzuna | US + international IT | developer.adzuna.com/signup |
| `USAJOBS_API_KEY` (+ `USAJOBS_USER_AGENT`) | USAJobs | US federal IT (onsite) | developer.usajobs.gov/apirequest |
| `APIFY_API_TOKEN` | Apify | Dice.com + Wellfound ($5/mo credit) | console.apify.com/settings/integrations |

All are **server-only**. `USAJOBS_USER_AGENT` defaults to `ScoutLane/1.0` if unset.

### Apify cadence (metered — does not run daily)

Apify is the one **metered** source: Wellfound is **$0.99/run flat** and Dice ~**$0.004/result**,
billed against Apify's **$5/month** free credit. Running it daily (30×/mo) would cost ~$30 and blow
the credit, so the Apify leg is gated to a few fixed days each month while the free boards keep
refreshing **every day**:

- `APIFY_INGEST` — master switch. Apify runs only when this is exactly `on` (default off).
- `APIFY_INGEST_DAYS` — comma-separated days-of-month it may run. **Default `1,11,21`** → exactly 3
  runs/month ≈ **$4.17** (3 × $0.99 Wellfound + 3 × ~$0.40 Dice), under the $5 credit with headroom.
  Those days exist in every month, so the run count never surprises. Widen it (e.g. `1,8,15,22`) only
  if you have paid Apify credit — 4+ runs/month can exceed the free $5.

The other keyed boards (JSearch 200 req/mo, Adzuna, USAJobs) and the free boards are all well within
their free limits at one run/day, which is the most frequent a Vercel Hobby cron allows.

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

## Supabase setup (for stored, downloadable documents)

The packet pipeline generates the `.docx` files regardless; **with Supabase configured it stores
them and returns signed download URLs, and without it falls back to returning the docx inline
(base64)**. To enable stored downloads:

1. **Storage bucket:** create a **private** bucket named `documents` (Storage → New bucket).
   `/api/packet` uploads under `resumes/` and `cover-letters/` and returns 1-hour signed URLs.
2. **Database schema:** apply the migrations in `supabase/migrations/` **in order** (`0001`–`0005`)
   via the SQL Editor or `supabase db push`. They create `profiles` / `jobs` / `generations` with
   RLS, the ingest indexes, and the `ingest_run_markers` table (the Apify per-day cost guard). Each
   is idempotent (`if not exists`), so re-running is safe. The unified ingest cron needs these
   applied; the stateless packet path does not. Note: `generations` records BOTH shipped and
   guardrail-blocked packets (migration `0016` adds `status` = `'shipped' | 'blocked'`), so when
   querying generation history, filter by `status` to separate the two.
3. **Env vars:** ensure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and
   `SUPABASE_SECRET_KEY` are set in Vercel (Production + Preview). The secret key is server-only.

## Notes

- **Runtime:** App Router route handlers default to the Node.js runtime. `/api/packet` pins
  `export const runtime = 'nodejs'` (docx `Packer` + Supabase upload need Node `Buffer`).
- **Function duration:** route handlers use Vercel's default duration. When M1's multi-step
  packet pipeline lands, set the limit per-route with `export const maxDuration = N` in the
  route file (the Next.js App Router segment option) rather than a `vercel.json` glob — a glob
  that matches no built function fails the Vercel build.
- **Cron (Phase 2):** add a `crons` entry to `vercel.json`; Hobby allows at most one run/day and
  cron only runs on Production — keep the endpoint idempotent.
- **Secrets:** `.env.local` is gitignored and never committed; production secrets live only in
  Vercel's encrypted env store and CI's `${{ secrets.* }}`.

## Security posture (POC)

Auth is deliberately deferred for the POC, so the public routes rely on these controls:

- **Per-IP rate limiting** on the LLM-backed routes (`/api/packet`, `/api/discover`, `/api/profile`,
  `/api/extract`). Defaults per minute: packet 5, discover 10, profile 10, extract 20. Override any
  of them without a redeploy via `RATE_LIMIT_PACKET` / `RATE_LIMIT_DISCOVER` / `RATE_LIMIT_PROFILE`
  / `RATE_LIMIT_EXTRACT`. The counter is **per serverless instance** (a deliberate zero-dependency
  POC tradeoff); for a hard cross-instance guarantee, back it with a shared store (Upstash Redis).
- **Anthropic spend cap (REQUIRED backstop).** Rate limiting is the per-request control; it does not
  survive an attacker who rotates IPs. Set a **monthly spend limit / usage cap** on the Anthropic API
  organization (ideally a dedicated workspace for ScoutLane) plus a billing alert. This is the only
  control that bounds worst-case dollar loss independent of app code.
- **Bearer-capability ids.** Until auth lands, a `profileId` (and a pooled `jobId`) is a bearer
  capability — whoever holds the UUID can fetch it. Treat profile ids as secrets, don't log them in
  full, and rely on the profile rate limit to blunt enumeration. When auth is wired, gate
  `getStoredProfile` reads on `user_id` (the column already exists, nullable, on `profiles`).
- **Public job pool** is column-scoped (migration `0006`): anon/authenticated can read only the
  display columns of `live` jobs, never the full `jd_raw` body or internal columns.
