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
]
