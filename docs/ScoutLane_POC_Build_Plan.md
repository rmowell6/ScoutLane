# ScoutLane — Packet-First POC Build Plan

**Prepared for:** ScoutLane · **Date:** June 26, 2026 · **Status:** v1 build runbook
**Scope decision:** Packet-first proof of concept · **Stack decision:** scalable / least-rework (see §2)

This is an execution runbook, not a pitch. It assumes you'll build it yourself with Claude Code. The headline: **most of this is porting code we already wrote**, not new invention — see the reuse map in §7.

---

## 1. Goal, success criteria, and non-goals

**Goal.** Stand up a hosted web app that delivers the "application packet" end to end, for strangers, without a human in the loop: a user gives a resume and a target job, and the app returns a fit assessment, a tailored ATS-safe resume, a matching cover letter, and the packet view.

**What the POC is actually testing** is not "can we build it" (we've shown that) but **demand and unattended quality**: do real people want it, and does the automated pipeline produce packets as good as the two we made by hand?

**Success criteria (the Phase-0 thresholds from the assessment):**
- At least ~60% of invited users generate and open a packet.
- At least ~30% say they would pay after two weeks.
- At least ~50% of generated packets are rated "I'd actually send this" by the user.

**Non-goals — deliberately deferred (do NOT build for the POC):**
- Accounts, billing, teams.
- Broad/paid job ingestion (start with a tiny pool or user-supplied jobs).
- A multi-template gallery (ship one ATS-safe template).
- The formal evaluation harness and fairness audits (per the v2 assessment).

---

## 1.5 Build status — as-built (2026-06-29)

> **New here?** Read §1 for intent, then this section for where the code actually is. Everything below it (§2–§13) is the **original** POC plan, kept for design rationale — where it diverges from the shipped code, *this* section is authoritative. Verified syntax/architecture detail lives in `docs/ScoutLane_Engineering_Plan.md`; the latest deep review + cloud target-state in `docs/reviews/`.

**TL;DR.** The hero pipeline (M0–M3) is built, security-hardened, and tested; auth landed early; M4 (landing / waitlist / analytics) is implemented and in review. Remaining: M4 merge + config, M5 (real users), and the ECS migration track.

### Milestones
| # | Milestone | Status |
|---|-----------|--------|
| **M0** | Skeleton + deploy | ✅ Done — live on Vercel + Supabase; `/api/health` readiness probe |
| **M1** | Packet endpoint (the hero) | ✅ Done & extended — `/api/packet` → fit assessment + tailored `.docx` resume & cover letter + guardrails; plus a style/theming engine |
| **M2** | Profile intake + persistence | ✅ Done — `/api/profile` (structure once, reuse) + `/api/extract` (PDF/DOCX/TXT upload → text) |
| **M3** | ATS job pool | ✅ Done & extended — Greenhouse/Lever/Ashby + more boards, `/api/jobs` picker, daily cron ingest, `/api/discover` role ranking |
| **M4** | Landing + waitlist + analytics | 🟡 Implemented, **in review** (PRs #60 landing/routing, #61 waitlist, #62 PostHog); pending merge + config (domain, `NEXT_PUBLIC_POSTHOG_KEY`, migration 0013) |
| **M5** | Real users | ⬜ Pending — needs M4 live; the three §1 thresholds are now instrumented (M4-C events) |
| *(gate)* | Auth + Stripe | 🔵 **Auth shipped early** (invite allowlist + owner-scoped profiles); Stripe still deferred per plan |

### API surface — actual vs §5
**Built:** `POST /api/packet` (hero — accepts pasted resume/JD **or** `profileId`/`jobId`), `POST /api/profile`, `POST /api/extract` (upload→text), `GET /api/jobs` (pool list, auth-gated + rate-limited), `POST /api/discover` (the plan's later `/api/rank`), `GET /api/health`, `POST /api/jobs/ingest` + `POST /api/jobs/ingest-all` (Vercel Cron, bearer-authed), `POST /api/waitlist` (M4-B), and auth routes `/auth/callback` + `/auth/sign-out`.

**Diverged from the plan:**
- **No standalone `POST /api/job`** — JD parsing is folded into `/api/packet` (paste a JD or pick a pooled job by id).
- **No `GET /api/docs/:id` stream** — the `.docx` come back from `/api/packet` as Supabase Storage **signed URLs**, with a base64 inline fallback when Storage isn't configured.
- **`GET /api/cron/ingest`** is realized as **`POST /api/jobs/ingest-all`** on a daily Vercel Cron.

### Data model — actual
Migrations `supabase/migrations/0001–0015`: `profiles`, `jobs`, **`generations` (now WRITTEN: `/api/packet` persists a row for each shipped packet via `lib/services/generationStore.ts`, best-effort and owner-scoped; blocked packets that fail a guardrail are not persisted)**, `ingest_run_markers`, `allowlist` (invite gate, 0008), `rate_limit_counters` (shared limiter, 0011), `waitlist` (M4-B, 0013). Migrations `0014`–`0015` hardened RLS/EXECUTE. **RLS is enabled on every table.**

### Repo structure — actual vs §9
- **Marketing landing** at `app/page.tsx`; **product UI** at `app/app/page.tsx` (auth-gated). [M4-A]
- Middleware is **`proxy.ts`** (the Next 16 name), not `middleware.ts`.
- **Business logic lives in `lib/services/*`** (the plan put it loose in `lib/`): `buildPacket`, `structureResume`, `parseJob`, `extractFitInput`, `tailorResume`, `discoverRoles`, `recommendStyle`, `profileStore`, `jobStore`, `waitlistStore`, `extractResumeText`, plus `lib/services/ats/*` (ingest providers) and the vendored `src/jobBoards/*`.
- Supporting libs: `lib/anthropic.ts` (SDK client + `readParsed`), `lib/guardrails.ts`, `lib/fit/*` (deterministic scoring), `lib/docgen/*` (resume/coverLetter), `lib/http/*` (rateLimit/errors), `lib/analytics.ts` (M4-C), `lib/auth.ts`, `lib/supabase*`, `lib/style/*`.
- Components: `components/{Packet,WaitlistForm,PacketFeedback}.tsx`. Env/ops in `docs/DEPLOY.md` + `docs/AUTH_SETUP.md`.

### Built beyond the original plan
Authentication (invite allowlist + owner-scoped profiles, Phases A/B), a document **style/theming engine**, per-IP **rate limiting** backed by a shared Postgres counter, an exhaustive **architecture & security review** plus an **ECS Fargate target-state** design (both in `docs/reviews/`), and many more ATS/job-board providers than the planned "handful."

### What remains
- **M4 go-live:** merge #60→#61→#62, apply migrations `0012`–`0013`, set the PostHog key, register the domain, wire SES email auth (see the AWS bootstrap steps in the engagement notes).
- **M5:** invite 10–20 users and measure the three §1 thresholds (now captured by the M4-C events: `signed_in`/`packet_generated`/`packet_opened`, `packet_rated`, `would_pay`).
- **P5 (cost/perf)** and **MIG (ECS Fargate)** — tracked in `docs/reviews/2026-06-29-architecture-review.md` and `…-ecs-fargate-target-state.md`.

---

## 2. Recommended stack and why it minimizes rework

| Layer | Choice | Why it survives the jump from POC to product |
|---|---|---|
| App + API | **Next.js (TypeScript, App Router) on Vercel** | One framework for the marketing site, the app UI, and the API routes. Scales POC → production without re-platforming. Excellent Claude Code support. |
| Data + Auth + Storage | **Supabase** (managed Postgres + Auth + file Storage + row-level security) | You need all three eventually. Bundling them now means adding login and document storage later is configuration, not a refactor. Plain Postgres underneath, so portable. *(Alternative: Neon for pure serverless Postgres if you'd rather pick auth/storage separately.)* |
| LLM | **Anthropic TypeScript SDK** (Claude Haiku/Sonnet) | Same SDK from POC to scale; we already have the prompts and rubric. |
| Document generation | **`docx-js`** (the builders we already wrote) | Pure JavaScript, runs in a serverless function as-is. **Zero porting.** |
| Background work | **Vercel Cron** now; **Inngest** (durable, serverless-friendly queue) when ingestion grows | Lets ingestion/ranking move off the request path later without a rewrite. |

**Why not Python.** A FastAPI build is perfectly reasonable, but it would force rewriting all the `docx-js` document generation we've already built and tested — exactly the rework you asked to avoid. TypeScript end-to-end keeps one language across front end, API, and doc-gen.

**The one hard constraint to design around.** Vercel serverless functions cannot run LibreOffice, and have execution-time limits. So: the **packet is HTML** (renders anywhere), the **resume and cover letter are `.docx`** (generated by `docx-js`, which is fast and serverless-safe), and **server-side PDF rendering is deferred**. The LibreOffice step I used was only for my own previews; it is not in the product path.

---

## 3. Architecture

```
        ┌──────────────────────────── Vercel ─────────────────────────────┐
Browser │  Next.js                                                         │
  │     │   ├─ UI (profile intake, job input, packet view, downloads)      │
  └────▶│   └─ API routes (/api/profile, /api/job, /api/packet, /api/docs) │
        │            │            │                 │                      │
        └────────────┼────────────┼─────────────────┼──────────────────────┘
                     ▼            ▼                 ▼
              Anthropic API   Supabase          docx-js (in-process module)
             (structure /    (Postgres:         → resume.docx, cover.docx
              score / tailor)  profiles, jobs,
                               generations;
                               Storage: docs)
                     ▲
                     │ (later) Vercel Cron / Inngest → ATS ingestion
                     └────────── Greenhouse / Lever / Ashby public JSON
```

**Packet request flow (the hero path):**
1. User submits resume text + a job (URL or pasted JD).
2. `/api/profile` structures the resume into a profile object (Claude), stored in Postgres.
3. `/api/job` fetches the URL, **validates it is live**, and parses the JD into structured requirements (Claude).
4. `/api/packet` runs fit scoring, tailors the resume content, generates both `.docx` files, runs the truth/ATS guardrails, and assembles the packet HTML.
5. UI renders the packet; the `.docx` files download from Supabase Storage.

---

## 4. Data model (thin, but forward-compatible)

Define these now so growth doesn't require migrations-as-rework. POC can leave `user_id` nullable until auth lands.

```sql
-- structured resume + the user's locked template/voice preferences
profiles(
  id uuid pk, user_id uuid null,
  source_resume text,           -- raw paste/upload
  structured jsonb,             -- {summary, skills[], roles[], certs[], education[], rules{}}
  template_key text default 'ats_default',
  created_at timestamptz)

-- a target job (user-supplied for POC; ingested later)
jobs(
  id uuid pk,
  source text,                  -- 'user' | 'greenhouse' | 'lever' | 'ashby'
  url text, canonical_url text,
  title text, company text,
  jd_raw text, jd_parsed jsonb, -- {must_have[], nice_to_have[], comp, location, employer_type}
  validated_at timestamptz, status text,  -- 'live' | 'expired' | 'unverified'
  created_at timestamptz)

-- one generated packet
generations(
  id uuid pk, profile_id uuid, job_id uuid,
  scores jsonb,                 -- {overall, subs[], reason_codes[]}
  keyword_coverage jsonb,       -- the match/adjacent/gap table
  resume_doc_path text, cover_doc_path text,  -- Supabase Storage keys
  guardrail_report jsonb,       -- truth/ATS check results
  created_at timestamptz)
```

---

## 5. API surface

| Endpoint | In | Out |
|---|---|---|
| `POST /api/profile` | `{ resume_text }` (or file) | `profile_id`, structured profile |
| `POST /api/job` | `{ url }` or `{ jd_text }` | `job_id`, parsed JD, `status` (live/expired) |
| `POST /api/packet` | `{ profile_id, job_id }` | `{ scores, keyword_coverage, packet_html, resume_doc_id, cover_doc_id }` |
| `GET /api/docs/:id` | — | the `.docx` file stream |
| *(later)* `POST /api/rank` | `{ profile_id }` | ranked shortlist over the job pool |
| *(later)* `GET /api/cron/ingest` | — | pulls ATS feeds into `jobs` |

---

## 6. The packet pipeline, codified

This is the manual process from our two examples, turned into deterministic steps. Steps marked **[have]** are prompts or templates we already wrote.

1. **Structure the resume** → profile JSON (Claude), capturing the locked template/voice and the standing truth rules. **[have: the SPEC rules]**
2. **Fetch + validate the job**: load the canonical URL, confirm it is not 404/expired, parse the JD into must-have / nice-to-have / comp / location / employer-type. **[have: validation logic]**
3. **Fit scoring**: apply the composite rubric → sub-scores, overall, and one-line reason codes. **[have: the rollup rubric]**
4. **Tailor the resume content**: select and reorder *real* bullets, reweight skills, rewrite the summary — drawing strictly from the profile facts. **[have: the tailoring approach]**
5. **Render documents**: `docx-js` builds the ATS-safe resume and the cover letter from the chosen template. **[have: the build scripts]**
6. **Guardrails (automated, blocking)**:
   - *No fabrication*: diff every claim in the tailored docs against the profile facts; anything not traceable to the source is rejected.
   - *Banned terms*: e.g., no Kubernetes/Docker if absent from the profile.
   - *Style*: em-dash policy and voice rules.
   - *ATS*: single-column / no-tables / real-text is guaranteed by the builder, but assert it.
   A failed check regenerates or flags rather than shipping. **[have: the exact checks I ran each build]**
7. **Assemble the packet HTML** (scores, why-you-fit/watch-outs, keyword coverage, doc thumbnails + links). **[have: the packet template]**

The point: steps 1–4 and 6 are prompts/logic we've written, and 5 and 7 are templates we've built. The POC wires them behind endpoints.

---

## 7. Reuse map — what ports from this folder

| Existing artifact (Job Search folder) | Where it goes |
|---|---|
| `Resume_Build_*.js` (docx-js builders) | `lib/docgen/resume.ts` — the template engine, parameterized by profile JSON |
| `CoverLetter_*` builders | `lib/docgen/coverLetter.ts` |
| `Resume_Template_SPEC.md` (rules) | `lib/guardrails.ts` (truth/ATS/style checks) + the structuring prompt |
| `Application_Packet_*.html` template | `components/Packet.tsx` |
| The rollup composite-fit rubric | the `/api/rank` and `/api/packet` scoring prompt |
| The weekly rollup scheduled task | `/api/cron/ingest` + the ranking prompt (Phase 2) |

---

## 8. The genuinely new or fiddly parts (and how to handle them)

- **Resume intake.** Arbitrary uploaded resumes are the messy part. POC: accept pasted text and let Claude structure it; add PDF/DOCX upload parsing in M2.
- **Template generalization.** Start with the single ATS-safe template as the default; keep the builder data-driven so more templates are content, not new code.
- **Untrusted JD text = prompt-injection surface.** Treat job descriptions as *data*, never instructions. Wrap them in clearly delimited blocks and instruct the model to ignore embedded directions.
- **Truth guardrail as code.** The "no fabrication" promise must be an automated check (claims-vs-source diff), not a hope — it is the product's whole differentiator. Keep the human (the user) in the loop to review before sending.
- **Doc-gen cold starts.** `docx-js` is light, but keep generation in its own module so it can move to an Inngest worker if latency matters at scale.

---

## 9. Proposed repo structure

```
scoutlane/
  app/
    page.tsx                 # landing + waitlist
    app/                     # the product UI (intake → job → packet)
    api/
      profile/route.ts
      job/route.ts
      packet/route.ts
      docs/[id]/route.ts
      cron/ingest/route.ts   # Phase 2
  components/
    Packet.tsx               # from Application_Packet_*.html
    IntakeForm.tsx
  lib/
    anthropic.ts             # SDK client + prompts (rubric, structuring, tailoring)
    docgen/resume.ts         # from Resume_Build_*.js
    docgen/coverLetter.ts
    guardrails.ts            # from Resume_Template_SPEC.md
    validateJob.ts
    db.ts                    # Supabase client
  supabase/                  # schema migrations
  README.md
```

---

## 10. Build milestones (each with a definition of done)

| # | Milestone | Done when |
|---|---|---|
| **M0** | Skeleton + deploy | Next.js app live on Vercel; Supabase connected; `ANTHROPIC_API_KEY` wired; a "hello packet" round-trips. |
| **M1** | Packet endpoint (the hero) | Paste a resume + a JD → get a real packet + downloadable tailored `.docx` + cover letter, with guardrails passing. |
| **M2** | Profile intake + persistence | Resume structured once and reused; file upload parsing. |
| **M3** | Small ATS job pool | Ingest a handful of Greenhouse/Lever/Ashby boards into `jobs`; user picks a role instead of pasting one. (Bridge toward the full loop.) |
| **M4** | Landing + waitlist + analytics | A shareable URL, signups captured, basic event tracking for the Phase-0 metrics. |
| **M5** | Real users | 10–20 people run packets; measure the three thresholds in §1. |
| *(gate)* | Auth + Stripe | Only after M5 shows signal. |

> _This is the **original** milestone plan. For current completion status see **§1.5 Build status — as-built**: M0–M3 are done, auth shipped early, M4 is in review._

---

## 11. Hosting, deploy, and cost

- **Deploy:** push to GitHub → import to Vercel; create a Supabase project; set env vars (`ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_*_KEY`). Ingestion runs on Vercel Cron (Phase 2).
- **Running cost at POC scale:** Vercel + Supabase free tiers; LLM cost is single-digit cents per packet on Haiku/Sonnet with prompt caching. Realistically **near-zero** until you have real traffic. *(Vercel/Supabase free-tier limits change — confirm current quotas at build time rather than trusting a number here.)*
- **Privacy from day one (cheap now, expensive later):** store only what's needed, rely on Supabase encryption at rest, show a plain AI-use disclosure, and honor the product invariant below.

---

## 12. Invariant and defer list (carry from the assessment)

**Non-negotiable invariant:** no scraping of gated sites, no logging into users' accounts, no auto-applying. It is the legal safe-harbor and the brand.

**Defer until there's demand signal:** auth, billing, multi-template gallery, paid aggregators, formal eval/fairness machinery, server-side PDF rendering.

---

## 13. Immediate next action

Execute **M0**: scaffold the Next.js + Supabase skeleton, wire the Anthropic key, and deploy a trivial round-trip to Vercel so there is a live URL. Then port the packet generator (M1) first, because it is the hero and it is mostly the code in §7.

> When you're ready, I can generate the M0/M1 starter repo (file tree, the ported `docx-js` modules, the packet component, the API route stubs, and a README) as a runnable project you open in Claude Code.
