// Seed pool of public ATS boards to ingest (M3). These are public, no-auth board APIs — never
// gated pages or logins (product invariant). EDIT THIS LIST freely: it's plain config. Tokens are
// best-effort and must be verified against production (the ingest report flags any that fail, e.g.
// a 404 means the token/slug changed). Keep the list small for the POC.
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
  // report flags any that 404 (slug changed) — prune those when you see them in production.
  { provider: 'greenhouse', token: 'cloudflare', company: 'Cloudflare' },
  { provider: 'greenhouse', token: 'hashicorp', company: 'HashiCorp' },
  { provider: 'greenhouse', token: 'elastic', company: 'Elastic' },
  { provider: 'greenhouse', token: 'databricks', company: 'Databricks' },
  // NOTE: 'confluent' and 'digitalocean' returned 404 (no public Greenhouse board at that slug),
  // so they were dropped and swapped for two more data/infra boards below. Still best-effort —
  // verify against the next ingest report and prune/correct any that 404.
  { provider: 'greenhouse', token: 'mongodb', company: 'MongoDB' },
  { provider: 'greenhouse', token: 'datadog', company: 'Datadog' },
]
