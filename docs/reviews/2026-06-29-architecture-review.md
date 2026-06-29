# ScoutLane — Architecture & Security Review (2026-06-29)

**Lenses:** security architect · full-stack dev · senior cloud/EKS architect · reliability/cost · Claude Code hygiene
**Target:** harden the POC and prepare migration to **AWS EKS**.
**Method:** exhaustive, multi-agent (parallel finders per sub-area + adversarial verification). Read-only — no code changes until the remediation set is approved.
**Codebase at review:** ~9.9k LOC TS/TSX · Next.js 16 (App Router) on Vercel · Supabase (Auth + Postgres + Storage) · Anthropic SDK · 40 test files · CI in `.github/workflows/ci.yml`.

## Severity legend
`CRIT` exploitable / data-loss / outage · `HIGH` likely impact · `MED` should-fix · `LOW` polish/nit · `INFO` note

## Status
| Batch | Scope | State |
|---|---|---|
| 0 | Static scan + recon | ✅ done |
| 1 | Security deep-dive | ✅ done (28 findings) |
| 2 | App correctness | ⏳ pending |
| 3 | EKS-readiness | ✅ done (57→25 deduped) |
| 4 | Reliability + perf + cost | ⏳ pending |
| 5 | Synthesis + EKS target-state design | ⏳ pending |

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

_Subsequent batches appended below as they complete._
