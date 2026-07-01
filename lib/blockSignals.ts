// Privacy-safe analytics signals for a BLOCKED packet (guardrails.ok === false).
//
// The point of these signals is to answer one question empirically: when the no-fabrication guardrail
// blocks a packet, is it catching a genuine INVENTION, or a TRUE DERIVED AGGREGATE the checker can't
// see (e.g. "three-time VMware Certified Professional", true because the profile holds three VMware
// certs, but not a lexical restatement of any single fact)? `looks_like_aggregate` is that signal.
//
// Everything here is DERIVED (booleans + counts). We deliberately emit NO claim text, skill, or metric
// string: those are verbatim resume content (user PII) and must never reach a third party. This mirrors
// the route's existing "log counts, never the offending strings" rule.
import { GLUE_WORDS, mentionsAny, normalize, type GuardrailReport } from '@/lib/guardrails'
import type { Claim } from '@/lib/schemas'

// Spelled-out quantities the tailor reaches for when it states a count in words. Kept separate from
// number words so "three-time" (three + time) trips both the number and the quantifier signal.
const NUMBER_WORDS = new Set([
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
  'hundred', 'thousand', 'million',
])
// Words that signal a COUNT/multiplicity rather than a single fact ("three-time", "twice", "multiple
// certifications", "second promotion"). Ordinals included, they mark a ranked count.
const QUANTIFIER_WORDS = new Set([
  'time', 'times', 'once', 'twice', 'thrice', 'multiple', 'several', 'numerous', 'various', 'many',
  'double', 'triple', 'quadruple', 'fold',
  'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
])

/** Lowercased alphanumeric tokens via the shared dash/space normalize (matches guardrails tokenizing). */
function tokens(s: string): string[] {
  return normalize(s)
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** One claim's aggregate profile: does it carry a number/quantifier, and (crucially) do its remaining
 *  CONTENT words all ground in the profile? If both, the block is likely a true computed aggregate, not
 *  an invention. `factsJoined` is the already-normalized profile fact text. */
function claimShape(claim: Claim, factsJoined: string): { hasNumber: boolean; hasQuantifier: boolean; looksLikeAggregate: boolean } {
  const ts = tokens(claim.text)
  const hasDigit = /\d/.test(claim.text)
  const hasNumberWord = ts.some((t) => NUMBER_WORDS.has(t))
  const hasNumber = hasDigit || hasNumberWord
  const hasQuantifier = ts.some((t) => QUANTIFIER_WORDS.has(t))

  // Content tokens = the substantive words once the count itself is removed. Drop connectors via the
  // SAME GLUE_WORDS set guardrails uses (not an ad-hoc length cutoff), so a benign function word like
  // "with"/"from" that happens to be absent from the profile can't falsely sink the aggregate flag.
  // The claim "looks like an aggregate" only if EVERY content word is genuinely in the profile
  // (alias-aware) AND there is at least one such word, i.e. the sentence is true except for the count
  // our lexical checker can't verify.
  const content = ts.filter(
    (t) => !GLUE_WORDS.has(t) && !/^\d+$/.test(t) && !NUMBER_WORDS.has(t) && !QUANTIFIER_WORDS.has(t),
  )
  const contentGrounds = content.length > 0 && content.every((t) => mentionsAny(factsJoined, t))
  return { hasNumber, hasQuantifier, looksLikeAggregate: (hasNumber || hasQuantifier) && contentGrounds }
}

// A `type` (not `interface`) so it carries an implicit index signature and can pass straight to
// captureServer's `Record<string, unknown>` properties without a cast.
export type BlockSignals = {
  /** Which guardrail buckets fired (low-cardinality strings, safe to group by). */
  block_reasons: string[]
  unverifiable_count: number
  ungrounded_skill_count: number
  ungrounded_metric_count: number
  bullets_metric_count: number
  banned_terms_count: number
  style_violation_count: number
  ats_problem_count: number
  /** Of the unverifiable claims, how many carry a number / a quantifier word. */
  claims_with_number: number
  claims_with_quantifier: number
  /** The headline diagnostic: unverifiable claims that read as a TRUE computed aggregate. */
  claims_like_aggregate: number
  /** True when at least one blocked claim looks like a true aggregate (a checker blind spot, not a lie). */
  looks_like_aggregate: boolean
}

/**
 * Derive the privacy-safe block signals from a failed guardrail report. Pure and deterministic; emits
 * only counts/booleans/low-cardinality reason strings. Reuses the fact texts the report already carries
 * (runGuardrails.factTexts) rather than re-indexing the profile.
 */
export function deriveBlockSignals(guardrails: GuardrailReport): BlockSignals {
  const nf = guardrails.noFabrication
  const factsJoined = (guardrails.factTexts ?? []).join(' \n ')
  const shapes = nf.unverifiable.map((c) => claimShape(c, factsJoined))

  const block_reasons: string[] = []
  if (nf.unverifiable.length > 0) block_reasons.push('unverifiable_claims')
  if (nf.ungroundedSkills.length > 0) block_reasons.push('ungrounded_skills')
  if (nf.ungroundedMetrics.length > 0) block_reasons.push('ungrounded_metrics')
  if (guardrails.bulletsGrounded.ungroundedMetrics.length > 0) block_reasons.push('bullets_metric')
  if (!guardrails.bannedTerms.ok) block_reasons.push('banned_terms')
  if (!guardrails.style.ok) block_reasons.push('style')
  if (guardrails.ats && !guardrails.ats.ok) block_reasons.push('ats')

  return {
    block_reasons,
    unverifiable_count: nf.unverifiable.length,
    ungrounded_skill_count: nf.ungroundedSkills.length,
    ungrounded_metric_count: nf.ungroundedMetrics.length,
    bullets_metric_count: guardrails.bulletsGrounded.ungroundedMetrics.length,
    banned_terms_count: guardrails.bannedTerms.violations.length,
    style_violation_count: guardrails.style.violations.length,
    ats_problem_count: guardrails.ats?.problems.length ?? 0,
    claims_with_number: shapes.filter((s) => s.hasNumber).length,
    claims_with_quantifier: shapes.filter((s) => s.hasQuantifier).length,
    claims_like_aggregate: shapes.filter((s) => s.looksLikeAggregate).length,
    looks_like_aggregate: shapes.some((s) => s.looksLikeAggregate),
  }
}
