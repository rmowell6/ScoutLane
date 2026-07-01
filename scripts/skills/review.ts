// Phase 2 triage of the Phase 1 candidate pairs (scripts/skills/candidate-aliases.json). Produces a
// DRAFT recommendation per pair, NOT a merge list. Nothing here is trusted automatically: the user
// reviews and edits the output before Phase 3 promotes anything into lib/skillAliases.ts.
//
// The bar is lib/skillAliases.ts's own: only genuinely UNAMBIGUOUS pairs belong in the table. That
// file already excludes "TS" (collides with TS/SCI clearances), bare "Go", and "Node" (everyday word
// / cluster-node collisions). Being a real synonym in its SOURCE system does not make a pair safe
// here: "golang" -> "go" is an officially mod-curated Stack Exchange tag synonym and must still be
// REJECTED, for exactly the reason "Go" was hand-excluded.
import type { OnetCandidate } from './onet'
import type { SynonymCandidate } from './stackexchange'

export type Candidate = OnetCandidate | SynonymCandidate
export type Recommendation = 'approve' | 'reject' | 'needs-human-judgment'

export interface ReviewedCandidate {
  recommendation: Recommendation
  reason: string
  candidate: Candidate
}

// Known collision-prone short forms. STARTS from lib/skillAliases.ts's documented exclusions (ts, go,
// node) and extends with obvious analogues: single-letter language names, and short forms that double
// as another domain's acronym or an everyday word. Membership always REJECTS, regardless of source
// credibility (this is what rejects the mod-curated "golang" -> "go" pair).
export const COLLISION_TERMS = new Set<string>([
  // straight from skillAliases.ts
  'ts', 'go', 'node',
  // spelled-out form of an excluded term
  'golang',
  // single-letter / ultra-short language names (also caught by the length rule, listed for a clear reason)
  'r', 'c', 'd', 'j',
  // short forms that collide with another domain or an everyday word
  'es', // Elasticsearch vs Spanish locale vs "Exact Software" ES
  'it', 'os', 'pc', 'hr', 'ar', 'vr', 'id', 'db', 'ux', 'ui', 'ip',
])

// A modest list of common English words with no standalone skill meaning. Reusing the "Go"/"Node"
// precedent as the bar: a term that is just an everyday word on its own is too ambiguous to auto-trust.
// Deliberately does NOT include real product/language names that happen to be words (Spark, Rust,
// Swift, Spring, Storm), so those are not auto-rejected, they fall to the source default / human.
export const COMMON_ENGLISH_WORDS = new Set<string>([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'has', 'her', 'was', 'one', 'our',
  'out', 'day', 'get', 'his', 'how', 'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'did',
  'its', 'let', 'put', 'say', 'she', 'too', 'use', 'any', 'may', 'this', 'that', 'with', 'from',
  'they', 'have', 'more', 'will', 'your', 'what', 'when', 'make', 'like', 'time', 'just', 'know',
  'take', 'into', 'some', 'only', 'over', 'also', 'back', 'work', 'well', 'even', 'want', 'give',
  'most', 'good', 'best', 'need', 'here', 'each', 'both', 'go', 'no', 'on', 'in', 'at', 'to', 'of',
  'is', 'it', 'be', 'or', 'up', 'us', 'we', 'an', 'as', 'by', 'do', 'he', 'if', 'me', 'my', 'so',
  // everyday words that collide with tech tokens
  'node', 'form', 'view', 'page', 'code', 'data', 'flow', 'run', 'test', 'build', 'name', 'type',
  'list', 'item', 'tag', 'box', 'hub', 'net', 'web', 'dash', 'set', 'map', 'key', 'call', 'load',
])

function norm(term: string): string {
  return term.toLowerCase().trim()
}

/** True when the term is on the hardcoded collision list (case-insensitive). */
export function isCollisionTerm(term: string): boolean {
  return COLLISION_TERMS.has(norm(term))
}

/** True when the term is a common English word with no standalone skill meaning (case-insensitive). */
export function isCommonEnglishWord(term: string): boolean {
  return COMMON_ENGLISH_WORDS.has(norm(term))
}

/** True when the term is under 3 characters (too ambiguous to trust as a whole-token alias). */
export function isTooShort(term: string): boolean {
  return norm(term).length < 3
}

/** The two terms a candidate pairs, source-agnostic: [full, acronym] for O*NET, [fromTag, toTag] for SE. */
export function termsOf(candidate: Candidate): [string, string] {
  return candidate.source === 'onet'
    ? [candidate.full, candidate.acronym]
    : [candidate.fromTag, candidate.toTag]
}

/**
 * Recommend approve / reject / needs-human-judgment for one candidate, with a one-line reason.
 * Collision checks run FIRST and reject regardless of source (so a legitimately mod-curated pair like
 * "golang" -> "go" still rejects). Only after those pass does source credibility matter.
 */
export function reviewCandidate(candidate: Candidate): { recommendation: Recommendation; reason: string } {
  const terms = termsOf(candidate)

  for (const t of terms) {
    if (isCollisionTerm(t)) {
      return { recommendation: 'reject', reason: `"${norm(t)}" is a known collision-prone term (excluded like TS/Go/Node in skillAliases.ts)` }
    }
  }
  for (const t of terms) {
    if (isTooShort(t)) {
      return { recommendation: 'reject', reason: `"${t.trim()}" is under 3 characters, too ambiguous to trust as a whole token` }
    }
  }
  for (const t of terms) {
    if (isCommonEnglishWord(t)) {
      return { recommendation: 'reject', reason: `"${norm(t)}" is a common English word with no standalone skill meaning` }
    }
  }

  if (candidate.source === 'stackexchange') {
    return { recommendation: 'approve', reason: 'mod-curated Stack Exchange tag synonym; passed the collision, length, and common-word checks' }
  }
  // O*NET: only a genuine initialism of ONE product name auto-approves. A looser (substring) match must
  // be confirmed by a human, it is never auto-approved.
  if (candidate.confidence === 'parenthetical' || candidate.confidence === 'initials-exact') {
    return { recommendation: 'approve', reason: `O*NET initialism of one product name (${candidate.confidence}); passed the collision checks` }
  }
  return {
    recommendation: 'needs-human-judgment',
    reason: `O*NET ${candidate.confidence} pair; confirm both terms name the SAME product before trusting`,
  }
}

// The user most needs to scan the pairs that need a decision (needs-human-judgment) and the rejects
// (to catch a false reject), so those sort ahead of the approvals.
const RANK: Record<Recommendation, number> = { 'needs-human-judgment': 0, reject: 1, approve: 2 }

/** Review every candidate and return them sorted with needs-human-judgment + reject first (stable). */
export function reviewAll(candidates: Candidate[]): ReviewedCandidate[] {
  return candidates
    .map((candidate) => {
      const { recommendation, reason } = reviewCandidate(candidate)
      return { recommendation, reason, candidate }
    })
    .map((r, i) => ({ r, i }))
    .sort((a, b) => RANK[a.r.recommendation] - RANK[b.r.recommendation] || a.i - b.i)
    .map(({ r }) => r)
}
