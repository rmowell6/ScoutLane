// Seed pool of public ATS boards to ingest (M3). These are public, no-auth board APIs, never
// gated pages or logins (product invariant). EDIT THIS LIST freely: it's plain config. Tokens are
// best-effort and must be verified against production (the ingest report flags any that fail, e.g.
// a 404 means the token/slug changed). Keep the list small for the POC.
//
// SCALING SIGNPOST: fetches are already concurrency-capped (MAX_SOURCE_CONCURRENCY in ./index.ts) and
// upserts are chunked, so growing this list is safe for a while. But the whole list still runs to
// completion inside one maxDuration=120s invocation (app/api/jobs/ingest-all/route.ts). Past roughly
// 40-50 sources, revisit that: raise maxDuration if the plan allows, or shard the list across runs
// (e.g. by day-of-month, like the Apify cadence). Below that, one run comfortably covers everything.
import type { AtsSource } from './types'

export const SOURCES: AtsSource[] = [
  // Greenhouse: boards-api.greenhouse.io/v1/boards/<token>/jobs
  { provider: 'greenhouse', token: 'stripe', company: 'Stripe' },
  { provider: 'greenhouse', token: 'gitlab', company: 'GitLab' },
  // Lever: api.lever.co/v0/postings/<company>
  { provider: 'lever', token: 'leverdemo', company: 'Lever (demo board)' },
  { provider: 'lever', token: 'plaid', company: 'Plaid' },
  // Ashby: api.ashbyhq.com/posting-api/job-board/<token> (canonical slug is lowercase)
  { provider: 'ashby', token: 'ramp', company: 'Ramp' },
  { provider: 'ashby', token: 'notion', company: 'Notion' },

  // ---- Infrastructure / cloud / IT-dense boards (added for role-discovery relevance) ----
  // These companies are engineering-heavy and post many cloud / infra / platform / security
  // roles, so the pool has more matches for that career path. Tokens are best-effort: the ingest
  // report flags any that 404 (slug changed), prune those when you see them in production.
  { provider: 'greenhouse', token: 'cloudflare', company: 'Cloudflare' },
  { provider: 'greenhouse', token: 'elastic', company: 'Elastic' },
  { provider: 'greenhouse', token: 'databricks', company: 'Databricks' },
  { provider: 'greenhouse', token: 'mongodb', company: 'MongoDB' },
  { provider: 'greenhouse', token: 'datadog', company: 'Datadog' },
  // Verified live in production ingest: cloudflare, elastic, databricks, mongodb, datadog.
  // Dropped after 404s: 'confluent', 'digitalocean', and 'hashicorp' (HashiCorp's public board
  // moved post-IBM-acquisition). 'dropbox' is a best-effort replacement (cloud/SRE-dense), verify
  // it in the next ingest report and prune/correct if it 404s.
  { provider: 'greenhouse', token: 'dropbox', company: 'Dropbox' },
]
