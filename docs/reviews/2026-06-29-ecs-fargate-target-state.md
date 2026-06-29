# ScoutLane — AWS ECS Fargate Target-State Architecture

Companion to `2026-06-29-architecture-review.md` (Batch 3 gaps E-1…E-25). Proposed target design for
migrating ScoutLane off Vercel onto **AWS ECS on Fargate** — design only, nothing applied. Keep
managed **Supabase** (Auth/Postgres/Storage) and the **Anthropic API** as attached backing services;
Fargate hosts only the Next.js app + the scheduled ingest.

> **Why ECS Fargate over EKS for this workload:** no control plane / node fleet to run, **native
> secret injection** (task-def `secrets` — no External Secrets Operator/IRSA), **native autoscaling**
> (Application Auto Scaling on ALB request count), lower ops + cost at this scale, and a faster path
> to production. EKS only wins if you need the k8s ecosystem or heavy multi-workload portability —
> not the case here. The Batch 3 *gaps* are platform-agnostic; only their *implementation* changes
> (k8s objects → ECS primitives), captured below.

## 1. Target topology (the AWS reference pattern for a scaling web app)

```
                         Route 53 (apex + www)
                              │
                              ▼
                     CloudFront  (TLS via ACM; cache /_next/static/*, /public/*;
                              │   forward /api/* + pages to origin; WAF optional)
                              ▼
            ACM ── Application Load Balancer (HTTPS 443, HTTP→HTTPS redirect,
                              │    idle_timeout=130s, public subnets, multi-AZ)
                              ▼
                     Target Group (type: ip, awsvpc; health check → /api/health)
                              ▼
        ┌──────────────── ECS Service: scoutlane-web (Fargate, private subnets, ≥2 AZ) ─────────┐
        │  Task: Next standalone container (node:24-slim, non-root, 1 vCPU / 2 GB)              │
        │   • container healthCheck (CMD curl /api/health)   • stopTimeout=120s                 │
        │   • secrets injected from Secrets Manager via execution role                          │
        │   • awslogs/FireLens → CloudWatch Logs                                                 │
        │  Service Auto Scaling: target-track ALBRequestCountPerTarget (+CPU guardrail)         │
        │  Deployment: rolling + circuit breaker (auto-rollback); min/max healthy %             │
        └───────────────────────────────────────────────────────────────────────────────────────┘
                              │ egress via NAT GW (443)
                              ▼
               Supabase · Anthropic · job-board APIs

   EventBridge Scheduler (0 3 * * *) ──► ECS RunTask: scoutlane-ingest
                                          (curl image → POST /api/jobs/ingest-all, Bearer CRON_SECRET)

   Secrets: AWS Secrets Manager / SSM Parameter Store ──(execution role)──► task env
   Observability: awslogs → CloudWatch Logs; Container Insights (CPU/mem/net);
                  /api/metrics → ADOT/CloudWatch agent; OTel → ADOT sidecar → X-Ray.
```

This **CloudFront → ALB → ECS Fargate (target-tracking autoscaling, multi-AZ, private subnets) +
Secrets Manager + CloudWatch** stack *is* the current AWS reference architecture for a scalable
containerized web app — see Sources.

## 2. Containerization (E-1, E-2, E-24 — identical to any container target)

`next.config.ts` → `output: 'standalone'`. Multi-stage **Dockerfile** on `node:24-slim` (glibc, for
unpdf/pdf.js), non-root, copying `.next/standalone` + `.next/static` + `public`, `CMD ["node","server.js"]`.
`.dockerignore` excludes `.env* node_modules .next .git test-results docs *.tsbuildinfo` (prevents the
`.env.local` leak). The **three `NEXT_PUBLIC_*`** are build `ARG`s (image is env-specific, E-4);
server secrets are **never** build args — injected at task runtime (§4).

```dockerfile
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL; ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
RUN npm run build
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN useradd -r -u 1001 nextjs
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER nextjs
EXPOSE 3000
CMD ["node","server.js"]
```

## 3. App-code changes required (platform-agnostic; land as PRs first)

| Finding | Change | ECS mapping |
|---|---|---|
| E-2 | `output:'standalone'` | — |
| E-6 | SIGTERM drain in the standalone server | ECS deregisters from TG **before** SIGTERM; set `stopTimeout=120`, ALB `deregistration_delay=130`, app drains in-flight |
| E-7 | keep `/api/health` dependency-free | used as **both** the ALB target-group health check (gates traffic ≈ readiness) **and** the container `healthCheck` (gates task ≈ liveness). ECS has no separate readiness probe, so a Supabase-aware readiness check belongs in the **ALB health-check path** if you want unready tasks pulled from rotation |
| E-10/E-19 | pino JSON logs + request id in `proxy.ts`; OTel spans per `runStep` | awslogs/FireLens → CloudWatch; ADOT sidecar → X-Ray |
| E-11/E-20 | `prom-client` `/api/metrics`; capture `message.usage` (token/$) | scraped by ADOT/CloudWatch agent; Container Insights covers CPU/mem |
| E-16 | Zod config module at boot; exit non-zero on missing secret | task fails fast → ECS circuit breaker rolls back |
| E-17/B1-16 | `clientIp()` use **rightmost** trusted hop (ALB), not first XFF | required behind ALB |
| E-20 audit | write a `generations` row per packet | closes the audit gap too |

## 4. Config & secrets (E-3, E-4, E-18) — ECS-native, no ESO/IRSA

- **Store:** AWS **Secrets Manager** (rotatable: `ANTHROPIC_API_KEY`, `SUPABASE_SECRET_KEY`,
  `CRON_SECRET`, provider keys) / **SSM Parameter Store** (cheap config).
- **Inject:** Task Definition `secrets: [{ name: ANTHROPIC_API_KEY, valueFrom: <arn> }, …]` — the ECS
  agent resolves them at task start via the **execution role**; they land as env, never in the image.
- **Roles:** *execution role* = pull image from ECR + read the secret ARNs + write logs; *task role* =
  the app's own AWS perms (minimal — none today; Supabase/Anthropic are external).
- **Build args:** the 3 `NEXT_PUBLIC_*` only.
- **Rotation:** secrets resolve per task start → trigger a service deployment (or Secrets Manager
  rotation + forced new deployment) to pick up rotated values.
- Produce one authoritative **env manifest** (current `.env.local.example` omits ~9 vars): classify
  each as build-arg | runtime-secret | runtime-config.

## 5. Task Definition + Service (illustrative)

**Task Definition** (Fargate): `cpu: 1024, memory: 2048` (tune from load tests of packet+extract —
docx/pdf are memory-heavy, E-13), `networkMode: awsvpc`, `executionRoleArn`, `taskRoleArn`,
container `portMappings:[3000]`, `stopTimeout: 120` (E-6), `secrets:[…]`, `environment:[NODE_OPTIONS=
--max-old-space-size=1536]`, `healthCheck:{ command:["CMD-SHELL","curl -f http://localhost:3000/api/health || exit 1"], interval:15, timeout:5, retries:3, startPeriod:30 }`, `logConfiguration: awslogs` (or FireLens).

**Service:** `launchType: FARGATE`, `desiredCount: 2` (≥2 AZ), `deploymentConfiguration:
{ minimumHealthyPercent: 100, maximumPercent: 200, deploymentCircuitBreaker:{ enable:true, rollback:true } }`,
target group `type: ip`, `deregistration_delay.timeout_seconds: 130` (E-9), tasks in **private
subnets**, task SG allows the ALB SG on 3000.

**Service Auto Scaling** (Application Auto Scaling, E-12): target-tracking on
**`ALBRequestCountPerTarget`** — for this I/O-bound, ≤120s workload pick a **low** target (each task
holds a request busy for the whole call, so requests-per-target is naturally small; start ~20–40
req/target/min and tune), `scaleOutCooldown: 60`, `scaleInCooldown: 300`, `min: 2`, `max: N`. Add a
**CPU/memory** target-tracking policy as a guardrail. Optional **scheduled scaling** to pre-warm for
the 03:00 ingest. Use **rolling** deploys + circuit breaker — `ALBRequestCountPerTarget` target
tracking is **not** supported with CodeDeploy blue/green.

## 6. Networking (E-14, E-15)

- Fargate tasks in **private subnets** (awsvpc → one ENI per task), **NAT Gateway** egress (sized for
  the cron burst), **security groups** (task SG ← ALB SG on 3000; egress 443 to Supabase/Anthropic/boards).
- **ALB** in public subnets, multi-AZ. **CloudFront** in front: long-cache immutable `/_next/static/*`
  + `/public/*`, forward dynamic/`/api/*` to the ALB origin (E-14). Optional **WAF** on CloudFront/ALB.
- Supabase stays HTTPS/PostgREST — no pooler unless a direct-Postgres feature is added (E-25).

## 7. Observability (E-10, E-11, E-19, E-22, E-23)

- **Logs:** pino JSON → stdout → **awslogs** (or **FireLens**/Fluent Bit) → **CloudWatch Logs**;
  correlation id per line; **redaction** layer (secret env keys + `sk-ant-`/`sb_secret_` patterns)
  before stdout (E-22).
- **Metrics:** **Container Insights** (task CPU/mem/net) + app `/api/metrics` (prom-client) via an
  **ADOT** collector / CloudWatch agent: `http_request_duration`, `anthropic_tokens_total{model}` +
  cost, `guardrail_blocks_total{reason}`, `rate_limit_store_failopen_total`. **CloudWatch alarms:**
  page on sustained rate-limit fail-open, p95 latency, 5xx rate (E-23).
- **Traces:** **ADOT** sidecar → **X-Ray**; one span per `runStep`.

## 8. CI/CD (E-5)

Extend `.github/workflows/ci.yml`: after typecheck/lint/test/e2e, a `docker` job (main/tags): Buildx
+ cache → **Trivy** scan (fail HIGH/CRIT) → push to **ECR** via **GitHub OIDC** role (no static keys)
→ in-image smoke test of `/api/extract` (pdf+docx) + `/api/packet`. Deploy = register a new **task
definition revision** + `aws ecs update-service` (rolling, circuit-breaker auto-rollback). Keep
rolling (not blue/green) to preserve `ALBRequestCountPerTarget` scaling.

## 9. Scheduled ingest (E-8)

Replace the Vercel cron with **EventBridge Scheduler** (`cron(0 3 * * *)`) → **ECS RunTask** of a tiny
`scoutlane-ingest` Fargate task (curl image) that POSTs the internal ALB `/api/jobs/ingest-all` with
`Authorization: Bearer $CRON_SECRET` (same Secrets Manager source). Endpoint is already idempotent.
(Alternative: a scheduled task that imports the ingest service directly — avoids a network hop but
ships a second image.)

## 10. Migration phasing (de-risked, parallel-run)

1. **Containerize & validate (app PRs):** standalone config, Dockerfile/.dockerignore, SIGTERM,
   structured logs + request id, config validation, XFF fix, metrics, `generations` write. Image runs
   locally + e2e green in-container. *(No AWS yet — reversible.)*
2. **AWS foundation (IaC — Terraform/CDK):** VPC (public+private subnets, NAT), ECR, ALB + ACM,
   Secrets Manager entries, execution/task roles, ECS cluster + task def + service, autoscaling,
   CloudFront, EventBridge Scheduler, CloudWatch/ADOT.
3. **Deploy to Fargate parallel to Vercel.** Smoke + load test: validate `ALBRequestCountPerTarget`
   scaling, 120s requests through the ALB (idle_timeout), graceful drain on a rolling deploy, the
   scheduled ingest firing.
4. **Cutover:** Route 53 weighted shift → 100% Fargate once green; keep Vercel warm as rollback.
5. **Decommission Vercel:** remove `vercel.json`; EventBridge owns ingest; delete the project.

## 11. What does NOT change

Supabase (Auth/RLS/Storage/Postgres) and the Anthropic API are unchanged — same SDK calls over HTTPS
from Fargate. The app is already largely 12-factor (stateless after the shared rate-limiter; config in
env; logs to stdout); the items above are the delta to a production-grade Fargate deployment.

---

### Sources (current AWS guidance)
- [Automatically scale your Amazon ECS service](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html)
- [Target tracking scaling policy for ECS service auto scaling](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/target-tracking-create-policy.html)
- [Configure ECS Service Auto Scaling on Fargate (re:Post)](https://repost.aws/knowledge-center/ecs-fargate-service-auto-scaling)
- [Graceful shutdowns with ECS (AWS Containers blog)](https://aws.amazon.com/blogs/containers/graceful-shutdowns-with-ecs/)
- [Graceful shutdown & connection draining for Amazon ECS (re:Post)](https://repost.aws/knowledge-center/ecs-graceful-shutdown-connection-draining-deployments)
- [Developing Twelve-Factor Apps using Amazon ECS and AWS Fargate](https://aws.amazon.com/blogs/containers/developing-twelve-factor-apps-using-amazon-ecs-and-aws-fargate/)
