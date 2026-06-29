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
| 1 | Security deep-dive | ⏳ pending |
| 2 | App correctness | ⏳ pending |
| 3 | EKS-readiness | ⏳ pending |
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

_Subsequent batches appended below as they complete._
