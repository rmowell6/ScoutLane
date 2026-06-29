# ScoutLane — Architecture & Security Review (2026-06-29)

**Lenses:** security architect · full-stack dev · senior cloud/EKS architect · reliability/cost · Claude Code hygiene
**Target:** harden the POC and prepare migration to **AWS ECS on Fargate** _(corrected from EKS — see `2026-06-29-ecs-fargate-target-state.md`; the Batch 3 gaps are platform-agnostic, only their implementation mapping changed)_.
**Method:** exhaustive, multi-agent (parallel finders per sub-area + adversarial verification). Read-only — no code changes until the remediation set is approved.
**Codebase at review:** ~9.9k LOC TS/TSX · Next.js 16 (App Router) on Vercel · Supabase (Auth + Postgres + Storage) · Anthropic SDK · 40 test files · CI in `.github/workflows/ci.yml`.

## Severity legend
`CRIT` exploitable / data-loss / outage · `HIGH` likely impact · `MED` should-fix · `LOW` polish/nit · `INFO` note

## Status
| Batch | Scope | State |
|---|---|---|
| 0 | Static scan + recon | ✅ done |
| 1 | Security deep-dive | ✅ done (28 findings) |
| 2 | App correctness | ✅ done (37 findings) |
| 3 | EKS-readiness | ✅ done (57→25 deduped) |
| 4 | Reliability + perf + cost | ✅ done (30 findings) |
| 5 | Synthesis + ECS target-state design | ✅ done (design doc + roadmap below) |

---

## Findings register
> Each finding: `ID · SEV · lens · location · impact · recommendation · effort · EKS?`

### Batch 0 — static scan + recon

| ID | SEV | Lens | Location | Finding | Recommendation | Effort | EKS? |
|----|-----|------|----------|---------|----------------|--------|------|
| B0-1 | LOW | sec/deps | `package-lock` (postcss via next) | npm audit: 2 moderate — `postcss` XSS in CSS-stringify (GHSA-qx2v-qp2m-jg93), transitive through Next. Not reachable in app usage (no untrusted CSS processed). | Track; clears on next Next.js patch bump. Do NOT `audit fix --force` (suggests catastrophic next@9 downgrade). | S | N |
| B0-2 | INFO | sec | repo-wide | No tracked `.env*` (gitignored), no hardcoded secrets, no `eval`/`new Function`/`child_process`/`dangerouslySetInnerHTML` in app code. `NEXT_PUBLIC_` carries only URL + publishable key. | — (good baseline) | — | N |
| B0-3 | LEAD→B1 | sec | `lib/services/ats/fetchJson.ts:13` | Outbound `fetch(url)` for job ingest — **SSRF surface**. Risk depends on whether `url` is from a fixed board allowlist or user/DB-influenced. | Deep-dive in Batch 1: confirm URL provenance + add allowlist/scheme/host guards if needed. | — | N |
| B0-4 | LEAD→B3 | cloud | `next.config.ts` | Empty config — no `output: 'standalone'`, so no slim self-contained server bundle for a container image. | Batch 3: add standalone output + multi-stage Dockerfile. | S | **Y** |
| B0-5 | LEAD→B3 | cloud | `vercel.json` crons | Daily cron `/api/jobs/ingest-all` is Vercel-managed. No portable scheduler for EKS. | Batch 3: design k8s `CronJob` (or EventBridge) hitting the bearer-secured endpoint. | M | **Y** |
| B0-6 | INFO | cloud | `proxy.ts` (Next middleware) | Edge-style middleware (auth gate + session refresh). Runs in the Node server when self-hosted, but is a migration touch-point (cold-path auth on every request). | Batch 3: validate behavior under self-host + connection reuse. | — | **Y** |

---

### Batch 1 — security (deduped; 28 raw → 19; 3/3 HIGH-CRIT right-sized to MED on adversarial verify)

| ID | SEV | Location | Finding | Recommendation | Eff |
|----|-----|----------|---------|----------------|-----|
| B1-1 | MED | `lib/guardrails.ts:52` | `traceable()` returns true the instant a claim's `factId` exists in the index — the claim **text is never diffed against the cited fact**. An injected instruction in the resume/JD can make the tailor emit fabricated text with a real factId and the no-fabrication gate passes. (Bounded today: `tailored.claims` aren't rendered into the .docx — becomes a direct sink if ever wired in.) | On the factId path, also require the claim text to be a faithful restatement of the cited fact (reuse the ≥70% near-equality used on the fallback path). + regression test. | S |
| B1-2 | MED | `lib/guardrails.ts:128` | Summary + cover-letter prose are grounded only for **numeric** metrics + the skills array. A **qualitative** fabrication ("led a team of 50", "Top Secret clearance") in that prose ships unblocked. | Assemble summary/cover-letter only from traced claims, OR add a content-word overlap check vs the source resume. | M |
| B1-3 | LOW | `lib/guardrails.ts:61` | Fallback near-equality is one-directional (shorter is ≥70% substring of longer) — a padded fabrication embedding a short real fact under ~1.43× its length can pass. | Compare against the single best-matching fact and reject material added content; symmetric near-equality. | S |
| B1-4 | MED | `lib/http/rateLimit.ts:111` | Shared limiter **fails fully open**: any `rate_limit_hit` RPC error → `return {ok:true}` (does NOT fall back to the local LRU). A store hiccup removes the per-IP cap on the paid `/api/packet` route. | In the catch, fall back to `checkRateLimit(...)` (local LRU) instead of `ok:true`. | S |
| B1-5 | MED | `lib/services/extractResumeText.ts:122` | Input bytes are capped (5 MB) but **extracted text is not** — unpdf/mammoth can decompress to far more (decompression-bomb amplification into the LLM). | After tidy(), enforce a hard output cap (reuse the 100k `MAX_RESUME_CHARS`) → 422/truncate. | S |
| B1-6 | MED | `lib/services/extractResumeText.ts:42` | File kind dispatched by **attacker-controlled filename ext / declared MIME** with no magic-byte check (content-type spoofing). | Verify leading magic bytes (`%PDF`, `PK\x03\x04`) before dispatch; reject on mismatch. | M |
| B1-7 | MED | `app/auth/callback/route.ts:11` | `safeNext` open-redirect: `next=/\evil.com` passes the `//` guard but the WHATWG URL parser normalizes `\`→`/`, so `new URL(next,origin)`… → off-origin redirect. | Resolve against origin and re-check host: `const u=new URL(next??'/',origin); return u.origin===origin ? u.pathname+u.search : '/'`. | S |
| B1-8 | MED | `app/api/packet/route.ts:120` | On every guardrail block, the handler logs resume **PII verbatim** (`unverifiable[].text`, ungrounded skills/metrics — candidate sentences). | Log counts + safe step id only, not raw text/skills/metrics (friendly reasons already cover the user). | S |
| B1-9 | LOW | `lib/services/extractFitInput.ts:82` | Dropped candidate skill/cert **PII tokens logged in plaintext**. | Log `dropped.length`, or gate token detail behind a debug flag. | S |
| B1-10 | MED | `app/api/jobs/route.ts:9` | `GET /api/jobs` has **neither `requireUser()` nor `rateLimit()`** — the only public, unthrottled route (proxy excludes `/api/*` from the page gate). Exposes the pool + an unmetered DB query. | Add `await rateLimit(request,'jobs')` + a `jobs` budget; decide deliberately whether to gate behind auth (rest of app is invite-only). | S |
| B1-11 | LOW | `app/api/jobs/route.ts:18` | `q`/`limit` taken raw from query string (sanitized only in the service, not Zod-validated at the boundary) — violates the boundary-validation convention. | `safeParse` a Zod schema in the handler. | S |
| B1-12 | LOW | `supabase/migrations/0011_rate_limit.sql:21` | `rate_limit_hit()` is **not `search_path`-pinned** (unlike 0008's trigger) and **EXECUTE is grantable to anon/authenticated** by default (callable from PostgREST). | `set search_path=public` + schema-qualify; `revoke execute … from public, anon, authenticated; grant … to service_role`. | S |
| B1-13 | LOW | `lib/services/ats/fetchJson.ts:13`, `src/jobBoards/providers/base.ts:30` | Outbound ingest fetch uses default `redirect:'follow'` — hosts are hardcoded today, but a redirect could leave the allowlist. | `redirect:'error'` (or `'manual'` + re-validate Location host). | S |
| B1-14 | LOW | `src/jobBoards/aggregator.ts:167` | Per-provider `withTimeout` races a setTimeout but has **no AbortController** — the underlying fetch / metered Apify actor keeps running after the race is lost. | Thread an `AbortSignal` into `provider.search()`/fetch and abort on timeout. | M |
| B1-15 | LOW | `lib/services/jobStore.ts:244` | `getJobJd()` selects by id with **no `status='live'`** filter (list paths scope to live) — packets can be built against expired/unverified postings (not cross-tenant; post-auth). | Add `.eq('status','live')` (route already maps null→404). | S |
| B1-16 | LOW | `lib/http/rateLimit.ts:41` | `clientIp()` trusts the **first XFF hop** — spoof-resistant only behind Vercel's edge. **Breaks behind an ALB** (attacker-controllable). *(EKS-relevant — see E-18.)* | Derive client IP from the rightmost trusted hop / known proxy depth; document the trusted-edge dependency. | M |
| B1-17 | INFO | `lib/services/ats/fetchJson.ts:46` | Non-streaming size cap compares UTF-16 `string.length` to a **byte** budget — multi-byte UTF-8 can exceed the intended cap. | Measure `Buffer.byteLength`. | S |
| B1-18 | INFO | `lib/services/parseJob.ts:35` | Only LLM service not using `readParsed` — a truncated parse surfaces as opaque "no structured output" instead of a truncation error. | `return readParsed(message,'parseJob',1500)`. | S |
| B1-19 | INFO | `supabase/migrations/0009_auth_phase_b.sql:30` | `generations` has owner SELECT/INSERT but no UPDATE/DELETE policy (safe-by-default; no writer yet). | When a writer lands, mirror the profileStore stamp+filter pattern. | S |

**Verified-clean positives (no action):** `getClaims()` is the only server-side identity source (no `getSession`/`getUser` anywhere) ✓ · `requireUser()` on all state-changing/user-data routes ✓ · untrusted resume/JD/prefs always passed as labeled JSON in the user message, never the system prompt ✓ · structured outputs everywhere ✓ · docgen has no injection sink (claims not rendered) ✓ · no user-controlled outbound URL (SSRF surface is a hardcoded board allowlist) ✓.

### Batch 3 — EKS-readiness (deduped to 25 gaps; feeds the Batch 5 target-state design)

| ID | SEV | Area | Gap | Recommendation | Eff |
|----|-----|------|-----|----------------|-----|
| E-1 | CRIT | container | No `Dockerfile`/`.dockerignore` — app is unbuildable as an image; a naive `COPY . .` would also leak the working-tree `.env.local`. | Multi-stage Dockerfile (deps→build→runner) on `node:24-slim`, non-root, + `.dockerignore` (`.env*`, `node_modules`, `.next`, `test-results`, `docs`, `*.tsbuildinfo`). | M |
| E-2 | CRIT | container | `next.config.ts` has no `output:'standalone'` → image must ship full `node_modules` + `next start` (fat, slow). | `output:'standalone'`; runner copies `.next/standalone` + `.next/static` + `public`; verify mammoth/unpdf/docx assets are traced (`outputFileTracingIncludes`). | S |
| E-3 | CRIT | secrets | No portable secret injection (Vercel env store has no EKS equivalent). | **AWS Secrets Manager / SSM** → **External Secrets Operator** → k8s Secret → env, with **IRSA** (no static keys). | L |
| E-4 | HIGH | config | `NEXT_PUBLIC_*` are **build-time-inlined** → image is env-specific, breaking build-once-promote. | Per-env build-arg (`ARG`→`ENV`) image builds, OR a runtime `/config` endpoint / `window.__ENV__`. Server secrets must NEVER be build args. | M |
| E-5 | HIGH | CI | CI never builds/scans/pushes an image — no ECR artifact, no scan, no SBOM. | Add a build-push job: Buildx + cache → Trivy/Inspector scan → ECR via OIDC; gate deploy on scan; smoke-test extract+packet in the image. | M |
| E-6 | HIGH | lifecycle | **No SIGTERM graceful shutdown** — in-flight 120s packet (live LLM call) killed on every rollout/scale-in. | Custom server traps SIGTERM → `server.close()` + drain; `terminationGracePeriodSeconds≈130`, `preStop` sleep, ALB dereg delay. | M |
| E-7 | HIGH | lifecycle | `/api/health` conflates liveness/readiness and returns 200 even when Supabase is down. | Keep `/api/health` (dep-free) as **liveness**; add `/api/ready` (checks Supabase) as **readiness**; wire both probes + a startupProbe. | M |
| E-8 | HIGH | scheduling | Vercel cron (`vercel.json`) has no EKS equivalent — daily ingest silently stops. | k8s **CronJob** (or EventBridge Scheduler) POSTing `/api/jobs/ingest-all` with `Bearer $CRON_SECRET`; endpoint already idempotent. | S |
| E-9 | HIGH | ingress | Long requests (≤120s) exceed default LB timeouts; no ingress/TLS exists. | **AWS LB Controller ALB** + ACM (or NGINX+cert-manager); ALB `idle_timeout≥130s`; HTTP→HTTPS redirect. | M |
| E-10 | HIGH | observability | Logs are **unstructured text**, not JSON — poor CloudWatch/Fluent Bit extraction; no correlation/trace id. | Structured JSON logger (pino) to stdout `{ts,level,area,step,durMs,requestId,userId}`; mint/propagate a request id in `proxy.ts`. | M |
| E-11 | HIGH | observability | **No metrics** (req rate, LLM latency, **token/$ cost**, guardrail-block rate, rate-limit hits, fail-open). | `prom-client` + `/api/metrics`; capture `message.usage` per Anthropic call (cost is the dominant driver). | M |
| E-12 | HIGH | scaling | HPA on CPU is wrong — pipeline is **I/O-bound** (4 model calls, ≤120s). | Scale on **concurrency/RPS** via KEDA / Prometheus Adapter; target small per-pod concurrency (4–8). | L |
| E-13 | HIGH | scaling | No resource requests/limits or PDB — docx/pdf gen is memory-heavy; node drains can take all packet pods down. | Set requests/limits (≈250m–1 CPU, 512Mi–1Gi; tune from load tests) + `NODE_OPTIONS=--max-old-space-size`; PDB `minAvailable:1`. | M |
| E-14 | HIGH | CDN | `_next/static` + `public` served by the Node pod — no CDN. | Front ALB with **CloudFront**; cache immutable `/_next/static/*` long, forward dynamic/API to origin. | M |
| E-15 | MED | network | Egress to Supabase/Anthropic/boards from private subnets undefined. | Private subnets + NAT (sized for cron burst); default-deny `NetworkPolicy` allowing 443 egress to the required hosts. | M |
| E-16 | MED | config | No **fail-fast startup config validation** — missing secrets silently degrade. | Zod config module loaded at boot; exit non-zero if the deployment-mode's required secret set is incomplete. | M |
| E-17 | MED | security | `clientIp()` XFF trust is **attacker-controllable behind an ALB** (= B1-16). | Derive client IP from the rightmost trusted hop / known proxy-chain depth. | S |
| E-18 | MED | secrets | No rotation/reload — keys read once at process start. | ESO `refreshInterval` + Reloader (checksum annotation) to roll pods on secret change. | M |
| E-19 | MED | observability | No distributed tracing for the multi-step pipeline. | `instrumentation.ts` + OTel; one span per `runStep` (model, tokens, durMs); propagate trace/request id. | M |
| E-20 | MED | audit | `generations` table exists but is **never written** — no record of what was generated/blocked. | Insert a `generations` row per packet (scores, keyword_coverage, guardrail_report, user_id); also closes a product/audit gap. | M |
| E-21 | MED | data | docx delivery via Supabase Storage signed URLs — cross-cloud safe; secret key must come from ESO. | (covered by E-3) verify egress to Supabase Storage from EKS. | S |
| E-22 | LOW | observability | Secret-leak risk to logs (CLAUDE.md mandates step logging). | Central redaction layer (deny-list of secret env keys + `sk-ant-`/`sb_secret_` value patterns) before stdout. | S |
| E-23 | LOW | observability | Fail-open + guardrail-block events logged but not **alertable**. | Dedicated metrics + CloudWatch/Prometheus alerts (page on sustained fail-open). | S |
| E-24 | INFO | container | All 12 routes need the Node runtime (mammoth/unpdf/docx) — favorable (no edge split). | Base on `node:24-slim` (glibc, not alpine/musl for pdf.js) pinned by **digest**; CI smoke-test extract+packet in-image. | S |
| E-25 | INFO | data | Supabase access is all PostgREST/Storage over HTTPS — works cross-cloud unchanged; no pooler wiring needed. | If a direct-Postgres feature is ever added, route via Supavisor pooler + cap per-pod pool. | S |

### Batch 2 — app correctness (deduped; 37 raw → 25; 6/6 HIGH-CRIT verified)

> Cross-batch corroboration: the `guardrails.ts:52` factId gap was found **independently** by both the security and correctness batches → high confidence (logged once as B1-1; not repeated here).

| ID | SEV | Location | Finding | Recommendation | Eff |
|----|-----|----------|---------|----------------|-----|
| C-1 | HIGH | `lib/guardrails.ts:149` | `mentions()` uses `\b…\b` for single-token skills — **false-blocks any skill with a non-word char**: C++, C#, F#, .NET, Node.js. A legit, listed skill reads as "fabricated" → packet blocked (same false-block class as the dash bug). 3 finders flagged this. | Replace `\b` with non-word/string-edge boundary checks tolerant of `#`/`+`/`.` edges; add regression tests for C++/C#/.NET. | M |
| C-2 | MED | `lib/guardrails.ts:110` | Metric grounding matches the **bare number** only, ignoring unit/magnitude — an invented quantity passes if any coincidental matching digit exists in the profile ("$5M" grounded by an unrelated "5"). | Ground the full metric token (number + unit/magnitude), e.g. require the normalized phrase ("40 %", "$2 m") in the source. | M |
| C-3 | MED | `lib/guardrails.ts:87-113` | **Quadratic regex / CPU DoS** — the metric scan over a 100k-char numeric paste was measured at ~57s CPU (blocks the event loop; EKS-relevant under load). | Cap the text length fed to the scan (slice source/prose to a few KB) and bound digit runs (`\d{1,15}`). | S |
| C-4 | MED | `lib/fit/fitScore.ts:156`, `lib/fit/fitSignals.ts:52` | `scoreComp` **divides by zero → "ratio NaN"** ships into the Fit Assessment when JD comp extracts as 0 and no target comp set. | Treat `compTopUsd<=0`/`targetTopUsd<=0` as null → neutral 65 branch. | S |
| C-5 | MED | `app/sign-in/page.tsx:48-52` | **Hydration mismatch** — the `?error=` state is read from `window` in a `useState` lazy initializer (server renders null, client renders the banner). *(This was my earlier fix to dodge the setState-in-effect lint — needs a better pattern.)* | Read `?error=` after mount in a one-time effect, or via a server component / `useSearchParams` in a Suspense boundary. | S |
| C-6 | MED | `lib/services/parseJob.ts:35` | Bypasses `readParsed` — truncation mislabeled as "no structured output" (corroborates B1-18; raised to MED). | `return readParsed(message,'parseJob',1500)`; consider raising max_tokens. | S |
| C-7 | MED | `app/api/discover/route.ts:68`, `profileStore`/`structureResume` direct calls | Standalone `structureResume` calls in /discover and /profile **lose their step tag** on failure (no `runStep` wrapper). | Wrap in a runStep-style tagger, or map untagged errors in the route catch. | S |
| C-8 | MED | `app/api/packet/route.ts:73-99` | Packet reuse/pooled-job path returns **500 (not 503)** when Supabase store is unconfigured (inconsistent with profile route's 503). | Detect the `configure` step in the catch → map to 503 "not configured". | S |
| C-9 | MED | `lib/services/jobStore.ts:179-213` | `listJobs`/`listJobsForMatch` trust untyped DB rows with `as string` casts and **skip the Zod re-validation the module mandates** (only `getJobJd` validates). | Add a Zod row schema mirroring `JobJdRowSchema`; `safeParse` each row. | S |
| C-10 | MED | `lib/supabaseServer.ts:12` | Supabase client is **untyped** (no `Database` generic) → every `.select()` row is `any` across the store layer (defeats strict). | `supabase gen types typescript` → `createClient<Database>()`. | M |
| C-11 | MED (test gaps) | route/service tests | **Untested critical paths**: packet 422 guardrail-block (the product invariant!), transient→503, profile/job 404; `cronAuth` (fail-closed + constant-time); `checkRateLimitShared` (Postgres path + fail-open); `buildPacket` failure/block branches; 4 hero LLM services; /api/{extract,profile,discover}. | Add the targeted tests (most are trivial since deps are already mockable). | M |
| C-12 | LOW | `lib/fit/fitSignals.ts:71` | Cross-lane conviction bonus is **dead code** (`lanesSurfaced` always 1 in the hero pipeline). | Thread a real `lanesSurfaced`, or remove the dead bonus. | M |
| C-13 | LOW | `lib/services/buildPacket.ts:76` | `safeName` strips all non-ASCII — **mangles accented/CJK candidate names** in packet filenames. | Keep Unicode letters (`\p{L}\p{N}` with `u` flag); strip only FS-unsafe chars. | S |
| C-14 | LOW | `lib/docgen/mapProfile.ts:35` | Resume renders a "Technical Skills" heading even with **zero skills**. | Return `[]` skillCategories when empty so the builder's length gate suppresses it. | S |
| C-15 | LOW | `app/sign-in/page.tsx:119` | Turnstile widget **never renders if the script is already cached** (bfcache / client re-entry) → captcha can't complete. | On mount, if `window.turnstile` exists, call `renderTurnstile()`. | S |
| C-16 | LOW | `lib/guardrails.ts:324` | `checkCertStatus` uses first `indexOf` — a cert re-listed under Previously-Held after an Active mention isn't flagged. | Scan all occurrences. | S |
| C-17 | LOW | `lib/services/ats/index.ts:27` | Per-source upstream error strings returned **raw in prod** from ingest endpoints (inconsistent with `legError` redaction). | Route through prod redaction. | S |
| C-18 | LOW | misc casts | `buildPacket.ts:178` (`resumeText as string` defeats narrowing), `profileStore.ts:122` (`source_resume` cast unchecked), `buildPacket.ts:95` (theme/font JSON `as Theme[]` unvalidated at 5 sites). | Narrow without casts; validate the style JSON once with Zod at module load. | S |
| C-19 | LOW | `lib/services/buildPacket.ts:362` | Shipped resume role **bullets never pass through `checkStyle`** (em-dash/space) — only tailored summary/cover/claims do. | Include `profile.roles[].bullets` in styleText, or confirm `resume.ts` gates them. | S |
| C-20 | INFO | `lib/services/buildPacket.ts:116` | Storage upload can **orphan files** on partial `Promise.all` failure (acceptable given cleanup cron). | Best-effort delete succeeded paths in the catch (low priority). | S |

### Batch 4 — reliability + performance + cost (deduped; 30 raw → 18; 1/1 HIGH verified)

| ID | SEV | Location | Finding | Recommendation | Eff |
|----|-----|----------|---------|----------------|-----|
| R-1 | HIGH | `lib/anthropic.ts:8` + all 6 call sites | Anthropic client has **no per-request `timeout`** → SDK default **10 min, retried ×4**. A single hung model call blows the 120s budget → opaque **504 + full token spend**, and the careful `isTransientAnthropicError→503` mapping never runs. | Set explicit per-call `timeout` (≈25–30s Haiku, 45–60s Sonnet) sized to budget; cap retries so `timeout×(retries+1)≤budget`; share an `AbortSignal` wall-clock deadline. | M |
| R-2 | MED | `lib/services/buildPacket.ts:186` | Parallel `Promise.all` is fail-fast: first rejection unwinds, but the **sibling paid model calls keep running** (billed, discarded); no partial salvage. | `allSettled` + a shared `AbortController` to cancel siblings on a fatal rejection. | M |
| R-3 | MED | `lib/supabaseServer.ts:20`, `buildPacket.ts:116`, `rateLimit.ts:102` | Supabase Storage uploads / upserts / rate-limit RPC have **no per-call timeout** — a hung tail upload (after all 4 model calls spent tokens) can 504 the request. | Bounded `fetch` (`AbortSignal.timeout`) in the Supabase client; reserve a tail budget; timeout→ the existing inline fallback. | M |
| R-4 | MED | `lib/services/*` (6 system prompts) | `cache_control` markers are a **no-op** — each system block is below the model's minimum cacheable prefix; the comments mislead. | Either remove the markers+comments, OR make caching real (move the large repeated profile/JD into a cached prefix, fan out after first token). | M |
| R-5 | MED | `lib/services/buildPacket.ts:179` + `jobStore.ts` | Pooled-job **`parseJob` is recomputed every packet** against the same posting (only style signals are cached). | Persist parsed `JobReqs` on the job row (`job_reqs` jsonb), read on the `jobId` path (mirror the style-signals cache). | M |
| R-6 | MED | `lib/services/discoverRoles.ts:147` | Re-rank sends full **36-char UUIDs** and asks the model to echo them — inflates in/out tokens + UUID-echo errors (corroborates the #50 follow-up). | Use compact integer indices 0..N-1; map back in `assembleDiscoveries`. | M |
| R-7 | MED | `supabase/migrations/0011_rate_limit.sql` | `rate_limit_counters` **grows unboundedly** — no TTL/cleanup of expired windows. | Daily idempotent cleanup (`delete … where window_start < now()-interval '1 day'`) or opportunistic purge. | S |
| R-8 | MED | `lib/style/skin.ts:8` | Full `themes.json`+`fonts.json` (mostly server-only prose: `designer`/`recruiter`/`character`) **shipped to the browser**. | Split a slim client file (`{id,name,primary,accent,wash,body}`); keep the rich data server-side. | M |
| R-9 | MED | `lib/services/buildPacket.ts:133` | Up to 3 docx **base64-inlined into the JSON response** (~2.3× peak memory; no streaming). | Prefer the signed-URL path; on fallback, a single download endpoint; encode/release one buffer at a time. | M |
| R-10 | MED | `app/page.tsx:714` | **No loading/progress UI** during the ≤120s packet wait (just a button label). | Skeleton + indeterminate progress + ETA; ideally stream step-level progress. | M |
| R-11 | MED | `app/api/packet/route.ts:24` | 120s I/O-bound requests with **no per-instance concurrency cap/queue** — a burst pins memory across overlapping long requests. | Semaphore around `buildPacket` → 503+Retry-After when saturated (also an ECS task-sizing input). | M |
| R-12 | MED | `app/api/jobs/ingest-all/route.ts:108` | Apify actor timeout **doesn't bound the leg's wall-clock**; a slow scrape eats the cron budget and still bills. | Race strictly below the actor budget; abort the actor run on race-timeout. | M |
| R-13 | LOW | `src/jobBoards/aggregator.ts:167,195` | `withTimeout` leaks the timer + never aborts the loser (held connection); O(n²) `concat`-in-loop accumulation. | `clearTimeout` in `.finally`; thread `AbortController`; `push(...)`/`flat()` once. | S |
| R-14 | LOW | `lib/services/extractFitInput.ts:64` | Sends the **entire profile** (incl. contact PII) when only a subset drives extraction. | Send a trimmed projection (as `recommendStyle` does). | S |
| R-15 | LOW | services | `max_tokens` budgets oversized with **no token/cost accounting**. | Read `message.usage` in `runStep` (`in/out/cache` per step) — the basis for cost metrics (E-11/E-20). | S |
| R-16 | LOW | `lib/services/jobStore.ts:173` | ILIKE title/company search has **no trigram index** — seq scan per keyword search as the pool grows. | `pg_trgm` + GIN index on `lower(title)`/`lower(company)` if the pool grows into the thousands. | S |
| R-17 | LOW | `components/Packet.tsx:165`, `app/layout.tsx:6` | PacketView recomputes sorts/Sets each render (no `useMemo`); fonts lack `display:'swap'`; `Geist_Mono` loaded but unused. | `useMemo` derived values; `display:'swap'`; drop unused mono font. | S |
| R-18 | INFO | `0001`/`0009` | `profiles.user_id` / `generations.user_id` have **no index** (fine at current scale; needed when user-scoped listing is wired). | Add indexes when those queries land. | S |

---

## Batch 5 — Synthesis & prioritized remediation roadmap

**Totals:** 4 deep batches + static scan → **~87 deduped findings** (1 HIGH-sev confirmed at R-1; the rest MED/LOW/INFO after adversarial verification; **0** CRIT in the running app — the only CRITs are the *EKS/ECS migration* prerequisites, which are "missing infra," not bugs). **Verified-clean positives** are documented in Batch 1.

### Cross-batch corroboration (highest confidence — found independently by ≥2 batches)
- **`guardrails.ts:52` factId laundering** (B1-1 + C-2) — the no-fabrication gate is a no-op for any cited claim.
- **Rate-limiter fails fully open** (B1-4 + R-Low + E-…) — should fall back to the local LRU.
- **`parseJob` skips `readParsed`** (B1-18 + C-6 + R-Low).
- **discover UUID echo** inflates tokens (R-6 + the #50 follow-up).
- **aggregator `withTimeout` doesn't abort** (B1-14 + R-13).

### Recommended remediation, grouped into shippable PRs (priority order)

| PR | Theme | Findings | Why first |
|----|-------|----------|-----------|
| **P1 — Guardrail integrity** | the product differentiator | B1-1/C-2 (factId text-diff), **C-1** (`mentions()` `\b` false-blocks C++/C#/.NET), B1-2 (qualitative prose), C-2 (metric unit grounding), C-3 (ReDoS cap) | Restores the "no-fabrication" guarantee **and** stops a live false-block class (same family as the dash bug already shipped). High user + trust impact, low effort. |
| **P2 — Abuse & cost controls** | reliability/$ | **R-1** (Anthropic timeouts), B1-4 (rate-limit fail-to-LRU), R-7 (counter cleanup), R-2 (abort siblings), R-11 (concurrency cap) | R-1 is the lone HIGH; protects spend + removes 504s. |
| **P3 — Security hardening** | security | B1-7 (open-redirect), B1-8/B1-9 (PII in logs), B1-5/B1-6 (extract bomb + magic-bytes), B1-10 (`/api/jobs` gate), B1-12 (RPC search_path + revoke), B1-13 (redirect:'error') | Discrete, mostly-S fixes; closes the real security gaps. |
| **P4 — Correctness & tests** | correctness | C-4 (NaN), C-6 (readParsed), C-8 (503 mapping), C-5 (hydration), C-9/C-10 (typed rows), C-11 (the untested 422/cron/rate-limit/route paths) | Locks the invariant with tests; removes latent bugs. |
| **P5 — Cost/perf optimization** | $/latency | R-4 (cache_control), R-5 (parseJob cache), R-6 (short ids), R-8 (client bundle), R-9 (docx streaming), R-10 (loading UI) | Token/$ + UX wins; do after correctness. |
| **MIG — ECS Fargate migration** | cloud | E-1…E-25 + the app-code prereqs (standalone, SIGTERM, `/api/health`, structured logs+request-id, metrics+token cost, config validation, XFF, `generations` write) → then IaC | Big track; app-code prereqs land as small PRs first, then infra per `ecs-fargate-target-state.md`. |

> **Nothing here is shipped.** Pick the PR set(s) to execute and I'll implement them on branches with the usual typecheck/lint/test/build gate + adversarial self-review.

_End of review._
