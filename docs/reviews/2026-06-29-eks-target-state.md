# ScoutLane — AWS EKS Target-State Architecture

Companion to `2026-06-29-architecture-review.md` (Batch 3 gaps E-1…E-25). This is the **proposed**
target design for migrating ScoutLane off Vercel onto **AWS EKS** — design only, nothing applied.
Keep the existing **managed Supabase** (Auth/Postgres/Storage) and **Anthropic API** as attached
backing services; EKS hosts only the Next.js app + the scheduled ingest.

## 1. Target topology

```
                 Route 53
                    │  (apex + www)
                    ▼
              CloudFront  ──cache──►  S3? no — origin is the ALB
                    │  (cache /_next/static/*, /public/*; forward /api/* + pages)
                    ▼
        ACM cert ── ALB (HTTPS 443, HTTP→HTTPS redirect, idle_timeout=130s)
                    │   AWS Load Balancer Controller (IngressClass: alb)
                    ▼
            ┌────────────────── EKS cluster (private subnets) ──────────────────┐
            │  Ingress(alb) → Service(ClusterIP) → Deployment: scoutlane-web     │
            │     • Next standalone pods (node:24-slim, non-root)                │
            │     • HPA (KEDA, concurrency-based)  • PDB(minAvailable:1)         │
            │     • readiness /api/ready  liveness /api/health  startupProbe     │
            │  CronJob: scoutlane-ingest (0 3 * * *) → curls /api/jobs/ingest-all│
            │  External Secrets Operator (IRSA) ─┐                               │
            └────────────────────────────────────┼──────────────────────────────┘
                    │ egress via NAT GW (443)     │ syncs
                    ▼                             ▼
        Supabase · Anthropic · job boards   AWS Secrets Manager / SSM
                                            (ANTHROPIC_API_KEY, SUPABASE_SECRET_KEY,
                                             CRON_SECRET, provider keys)
   Observability: pods → stdout(JSON) → Fluent Bit → CloudWatch Logs;
                  /api/metrics (prom-client) → Prometheus/AMP → Grafana/CloudWatch alarms;
                  OTel traces → ADOT collector → X-Ray/Tempo.
```

## 2. Containerization (E-1, E-2, E-24)

**`next.config.ts`** — enable standalone tracing:
```ts
const nextConfig: NextConfig = {
  output: 'standalone',
  // unpdf bundles pdf.js; docx/mammoth are pure JS — verify they're traced, else:
  // outputFileTracingIncludes: { '/api/extract': ['./node_modules/unpdf/**'] },
}
```

**`Dockerfile`** (multi-stage, non-root, glibc base for pdf.js):
```dockerfile
# ---- deps ----
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ----
FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* are build-time-inlined (E-4) — pass per-env at build:
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
RUN npm run build

# ---- runner ----
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN useradd -r -u 1001 nextjs
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```
Pin the base by **digest** in CI. **`.dockerignore`** must exclude `node_modules .next .git .env*
test-results playwright-report coverage *.tsbuildinfo tests docs` (E-1: prevents `.env.local` leak).

> ⚠️ Server secrets (`SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`, `CRON_SECRET`) are **never** build
> args — only the three `NEXT_PUBLIC_*` are. Server secrets are injected at runtime (§4).

## 3. Code changes required before/at migration (cross-ref findings)

These are app-side prerequisites — most are small and should land as normal PRs **before** infra:

| Finding | Change |
|---------|--------|
| E-2 | `output:'standalone'` in next.config.ts |
| E-6 / E-7 | `instrumentation.ts` (or custom server) SIGTERM drain; split probes — add **`/api/ready`** (checks Supabase) and keep `/api/health` dependency-free for liveness |
| E-10 / E-19 | structured JSON logger (pino) + request-id minted in `proxy.ts` and threaded through `runStep`; OTel spans per step |
| E-11 / E-20 | `prom-client` + `/api/metrics`; capture `message.usage` per Anthropic call (token/$ cost) |
| E-16 | Zod-validated **config module** loaded at boot; exit non-zero if a required secret is missing for the mode |
| E-17 / B1-16 | `clientIp()` trust the **rightmost** trusted hop (ALB), not the first XFF element |
| E-20 (audit) | write a `generations` row per packet (also closes the audit gap) |
| E-4 | confirm only `NEXT_PUBLIC_*` are build-inlined; document |

## 4. Config & secrets (E-3, E-4, E-18)

- **Source of truth:** AWS **Secrets Manager** (rotatable keys) / **SSM Parameter Store** (cheap config).
- **Sync:** **External Secrets Operator** with **IRSA** (no static AWS keys) → a k8s `Secret` →
  `envFrom`. Rotation via ESO `refreshInterval` + **Reloader** (podTemplate checksum) to roll pods.
- **Runtime secrets** (Secret): `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, provider
  keys (Apify/RapidAPI). **Build args** (per-env image): the 3 `NEXT_PUBLIC_*`.
- Produce a single authoritative **env manifest** (the current `.env.local.example` is missing ~9
  vars, E-… ) classifying each var: build-arg | runtime-secret | runtime-config.

## 5. Workload manifests (illustrative)

**Deployment** (probes, lifecycle, resources — E-6/E-7/E-13):
```yaml
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 140          # > maxDuration 120s (E-6)
      containers:
        - name: web
          image: <ECR>/scoutlane-web@sha256:...
          ports: [{ containerPort: 3000 }]
          envFrom: [{ secretRef: { name: scoutlane-secrets } }]   # from ESO
          readinessProbe:  { httpGet: { path: /api/ready,  port: 3000 }, periodSeconds: 10 }
          livenessProbe:   { httpGet: { path: /api/health, port: 3000 }, periodSeconds: 15 }
          startupProbe:    { httpGet: { path: /api/health, port: 3000 }, failureThreshold: 30 }
          lifecycle: { preStop: { exec: { command: ["sleep","15"] } } }  # ALB dereg drain
          resources:
            requests: { cpu: "250m", memory: "512Mi" }
            limits:   { cpu: "1",    memory: "1Gi" }   # docx/pdf are memory-heavy (E-13)
          env: [{ name: NODE_OPTIONS, value: "--max-old-space-size=896" }]
```
**HPA — concurrency, not CPU** (E-12): the pipeline is I/O-bound (≤120s, 4 model calls). Use **KEDA**
(or Prometheus Adapter) on an in-flight-requests / RPS metric, target ~4–8 concurrent per pod.
**PDB** `minAvailable: 1` (E-13). **Ingress** ALB + ACM, `alb.ingress.kubernetes.io/load-balancer-
attributes: idle_timeout.timeout_seconds=130` (E-9), HTTP→HTTPS redirect.
**CronJob** `scoutlane-ingest` (`0 3 * * *`, E-8): a tiny `curl` image POSTing the in-cluster Service
`/api/jobs/ingest-all` with `Authorization: Bearer $CRON_SECRET` (from the same Secret). Already
idempotent.

## 6. Networking (E-14, E-15)

- Nodes in **private subnets**; **NAT Gateway** for egress (size for the cron burst). Default-deny
  `NetworkPolicy`, allow 443 egress to Supabase / Anthropic / job-board hosts only.
- **CloudFront** in front of the ALB: long-cache immutable `/_next/static/*` + `/public/*`, forward
  dynamic/`/api/*` to origin (E-14). TLS at both CloudFront and ALB (ACM).
- Supabase stays HTTPS/PostgREST — no pooler needed unless a direct-Postgres feature is added (E-25).

## 7. Observability (E-10, E-11, E-19, E-22, E-23)

- **Logs:** JSON to stdout → **Fluent Bit** DaemonSet → **CloudWatch Logs**. Correlation id on every
  line. **Redaction** layer (deny-list secret env keys + `sk-ant-`/`sb_secret_` value patterns) before
  stdout (E-22).
- **Metrics:** `/api/metrics` (prom-client) scraped by **Prometheus/AMP**: `http_request_duration`,
  `anthropic_tokens_total{model}` + cost, `guardrail_blocks_total{reason}`, `rate_limit_hits_total`,
  `rate_limit_store_failopen_total`. **Alerts:** page on sustained rate-limit fail-open and on error
  rate / p95 latency (E-23).
- **Traces:** ADOT collector → X-Ray; one span per `runStep`.

## 8. CI/CD (E-5)

Extend `.github/workflows/ci.yml`: after the existing typecheck/lint/test/e2e gate, add a `docker`
job (main/tags): Buildx + layer cache → **Trivy** scan (fail on HIGH/CRIT) → push to **ECR** via
**OIDC** role assumption (no static keys) → smoke-test `/api/extract` (pdf+docx) + `/api/packet`
inside the built image. Deploy via **Argo CD / Flux** (GitOps) or `kubectl`/Helm with image digest.

## 9. Migration phasing (de-risked, parallel-run)

1. **Containerize & validate (app PRs):** standalone config, Dockerfile/.dockerignore, `/api/ready`,
   SIGTERM, structured logs + request id, config validation, XFF fix, metrics. Run the image locally
   + in CI; e2e green in-container. *(No infra yet — fully reversible.)*
2. **AWS foundation:** VPC/subnets/NAT, EKS cluster, ECR, IRSA roles, Secrets Manager entries, ESO,
   ALB Controller, CloudFront, ACM, observability stack. IaC (Terraform/CDK).
3. **Deploy to EKS in parallel with Vercel** (new image, secrets synced). Smoke + load test (validate
   HPA on concurrency, 120s requests through ALB, cron firing, graceful drain on rollout).
4. **Cutover:** shift DNS (Route 53 weighted → 100% EKS) once green; keep Vercel warm as rollback.
5. **Decommission Vercel:** remove `vercel.json`; the k8s CronJob owns ingest; delete the project.

## 10. What does NOT change

Supabase (Auth/RLS/Storage/Postgres) and the Anthropic API are unchanged — same SDK calls, same
managed services, reached over HTTPS from EKS. The app is already mostly 12-factor (stateless after
the shared rate-limiter; config in env; logs to stdout); the gaps above are the delta to production-
grade EKS.
