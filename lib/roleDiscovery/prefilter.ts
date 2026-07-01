// Role discovery, stage 1 of 2: the deterministic LEXICAL pre-filter (Approach A).
//
// Goal: cheaply narrow the live pool to a high-recall candidate set BEFORE the (paid) Claude
// re-rank. Titles vary across companies for the same work ("Cloud Engineer" vs "Platform" vs
// "Infrastructure Engineer"), so we don't match on titles alone, we match the candidate's real
// skill/role vocabulary against each posting's title AND a JD snippet. That surfaces title-variant
// roles whose *content* overlaps the candidate's experience, which Claude then ranks for true fit.
//
// Pure + deterministic so it's unit-testable without the LLM or the DB.
import type { CandidatePreferences, Profile } from '@/lib/schemas'

/** A pool posting reduced to the fields we match on (from jobStore.listJobsForMatch). */
export interface MatchableJob {
  id: string
  provider: string
  title: string
  company: string
  location: string | null
  url: string
  /** A truncated slice of the JD body, enough to carry its skill vocabulary. */
  snippet: string
}

export interface ScoredJob extends MatchableJob {
  /** Lexical overlap score (higher = more of the candidate's vocabulary appears in the posting). */
  lexScore: number
  /** The candidate terms that matched, for debugging / explainability. */
  hits: string[]
}

// Words too common to carry signal, kept tiny on purpose (the term set is already domain-specific).
const STOP = new Set([
  'and', 'the', 'for', 'with', 'our', 'you', 'your', 'are', 'has', 'have', 'will', 'this', 'that',
  'from', 'into', 'across', 'using', 'use', 'work', 'team', 'teams', 'role', 'roles', 'job', 'years',
  'experience', 'engineer', 'engineering', 'senior', 'lead', 'staff', 'principal', 'manager',
])

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((t) => t.replace(/^[.]+|[.]+$/g, ''))
    .filter((t) => t.length >= 3 && !STOP.has(t))
}

/**
 * Build the candidate's matching vocabulary: their skills and certs (kept whole as phrases AND
 * tokenized), role-title words, and any target lanes from preferences. Multi-word skills are kept
 * as phrases so "incident response" can match as a unit, not just on "incident".
 */
export function candidateTerms(profile: Profile, preferences?: CandidatePreferences): string[] {
  const phrases = new Set<string>()
  const tokens = new Set<string>()

  const addPhrase = (raw: string) => {
    const p = raw.toLowerCase().trim()
    if (p.includes(' ') && p.length >= 5) phrases.add(p)
    for (const t of tokenize(raw)) tokens.add(t)
  }

  profile.skills.forEach(addPhrase)
  profile.certs.forEach((c) => addPhrase(c.name))
  profile.roles.forEach((r) => addPhrase(r.title))
  ;(preferences?.targetLanes ?? []).forEach(addPhrase)

  // Phrases first (weighted higher in scoring), then single tokens that aren't already a phrase word.
  return [...phrases, ...tokens]
}

/** Score one posting by how much of the candidate vocabulary appears in its title + snippet. */
export function scoreJob(job: MatchableJob, terms: string[]): { score: number; hits: string[] } {
  const title = ` ${job.title.toLowerCase()} `
  const body = ` ${job.title.toLowerCase()} ${job.snippet.toLowerCase()} `
  let score = 0
  const hits: string[] = []
  for (const term of terms) {
    const phrase = term.includes(' ')
    // Phrases match as substrings; single tokens match on word boundaries to avoid "go" in "google".
    const inTitle = phrase ? title.includes(term) : new RegExp(`\\b${escapeRe(term)}\\b`).test(title)
    const inBody = phrase ? body.includes(term) : new RegExp(`\\b${escapeRe(term)}\\b`).test(body)
    if (!inBody) continue
    // Title hits are the strongest signal; phrases beat single tokens; body-only hits still count.
    const weight = (inTitle ? 2 : 1) * (phrase ? 2 : 1)
    score += weight
    hits.push(term)
  }
  return { score, hits }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Score every posting and return the top K, highest first. `minScore` is the relevance floor, a
 * posting must clear it to qualify (default 1 = any overlap; a higher floor trims long-tail roles
 * that share only one incidental keyword). Ties break by input order (recency-stable).
 */
export function prefilter(jobs: MatchableJob[], terms: string[], topK: number, minScore = 1): ScoredJob[] {
  if (terms.length === 0) return []
  const scored = jobs
    .map((job) => {
      const { score, hits } = scoreJob(job, terms)
      return { ...job, lexScore: score, hits }
    })
    .filter((j) => j.lexScore >= minScore)
  // Stable sort by score desc; equal scores keep their incoming (recency) order.
  scored.sort((a, b) => b.lexScore - a.lexScore)
  return scored.slice(0, topK)
}
