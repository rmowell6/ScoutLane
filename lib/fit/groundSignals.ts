// Fit-signal grounding (ai-27): the LLM fit-extractor classifies the candidate's skills/certs, but a
// hallucinated candidate token the resume doesn't support would inflate skill/cert COVERAGE and so
// the deterministic fit score. After extraction we drop any CANDIDATE-side token that doesn't appear
// anywhere in the profile facts. JD-side lists (mustHaveSkills / requiredCerts / hardGaps) describe
// the job, not the candidate, so they are NOT filtered, they must stay intact for coverage to mean
// anything.
import { groundedInFacts, indexFacts, mentionsAny, normalize, numbersIn } from '@/lib/guardrails'
import type { FitSignals } from '@/lib/fit/fitSignals'
import type { Profile } from '@/lib/schemas'

export interface GroundedSignals {
  signals: FitSignals
  /** Candidate-side tokens dropped because no profile fact supports them (for logging/telemetry). */
  dropped: string[]
}

/**
 * Filter the candidate-side skill/cert lists to tokens actually grounded in the profile facts.
 * Pure + deterministic so it's unit-testable without the LLM.
 *
 * Grounding reuses guardrails.groundedInFacts, the SAME fact-by-fact, negation-aware primitive the
 * no-fabrication check uses, NOT an independent flattened-text scan. The flattened approach was the
 * "old approach" guardrails already fixed: it let a disclaimer keep the very skill it denies ("No
 * hands-on Kubernetes experience" kept candidateSkills "Kubernetes", inflating skillsCoverage and the
 * on-screen coverage table while the guardrail simultaneously refused to ground the term). Same
 * fail-closed, whole-fact negation scope as guardrails; shared, not re-implemented, so the two
 * consumers cannot drift again.
 */
// Finding 11: full SCORING credit for a candidate skill must trace to an explicit capability
// assertion, the skills list, certs, role bullets, or summary, NOT to an incidental word match in a
// COMPANY name, JOB TITLE, or EDUCATION entry. Working at a company named "Oracle Health" is not
// Oracle experience, yet the full indexFacts() corpus (which includes company/title/school) grounded
// it and inflated skillsCoverage. We reuse indexFacts as the ONE fact source but drop the
// non-capability entries by their stable ids. Education is dropped whole: indexFacts joins the school
// NAME (an incidental-collision risk like a company name) with the degree/field into one string, so
// there is no clean way to keep only the field without restructuring indexFacts (out of scope), and
// the finding's credit-bearing set is skills/certs/bullets/summary. The fabrication-grounding path
// (guardrails.checkNoFabrication) still searches the FULL corpus, which is deliberate and unchanged:
// its fail-closed goal is to avoid false-blocking a legitimate claim, the opposite trade-off.
function creditBearingFacts(profile: Profile): string[] {
  const isCredit = (id: string): boolean =>
    !/:title$/.test(id) && !/:company$/.test(id) && !id.startsWith('edu:')
  return [...indexFacts(profile).byId.entries()]
    .filter(([id]) => isCredit(id))
    .map(([, text]) => normalize(text))
}

export function groundCandidateSignals(signals: FitSignals, profile: Profile): GroundedSignals {
  const facts = creditBearingFacts(profile)
  const dropped: string[] = []

  const keep = (tokens: string[]): string[] =>
    (tokens ?? []).filter((t) => {
      const grounded = groundedInFacts(facts, t)
      if (!grounded) dropped.push(t)
      return grounded
    })

  return {
    signals: {
      ...signals,
      candidateSkills: keep(signals.candidateSkills),
      adjacentSkills: keep(signals.adjacentSkills),
      heldCerts: keep(signals.heldCerts),
      adjacentCerts: keep(signals.adjacentCerts),
    },
    dropped,
  }
}

/** The five synthesized categoricals whose evidence quote is checked against the JD text. */
const EVIDENCE_FIELDS = ['roleTypeMatch', 'seniorityMatch', 'location', 'employerType', 'vertical'] as const

export interface JobGroundedSignals {
  signals: FitSignals
  /** Tier 1: JD-side skill/cert tokens dropped because the JD text does not contain them. */
  droppedJd: string[]
  /** Tier 2: true when compTopUsd was nulled because no matching figure appears in the JD text. */
  compNulled: boolean
  /** Tier 3: categorical fields whose evidence quote was missing or not a JD substring (non-blocking). */
  lowConfidenceFields: string[]
  /** hardGaps not found in the JD text (non-blocking telemetry, the gaps are NOT dropped). */
  ungroundedHardGaps: string[]
}

/**
 * True when `compTopUsd` corresponds to a number actually present in the JD text. Reuses guardrails'
 * numbersIn (ReDoS-bounded digit runs, comma-stripped), then also accepts the k/m shorthand: "$150K"
 * yields the token "150", which stands for 150000, so a JD figure n matches when n, n*1000, or
 * n*1000000 equals the posted top. Coarse on purpose (a bare "150" can validate 150000); it only ever
 * KEEPS a comp, so a false miss simply routes to the neutral path rather than fabricating a score.
 */
function compFigureInJd(compTopUsd: number, jdText: string): boolean {
  return numbersIn(jdText).some((tok) => {
    const n = Number(tok)
    if (!Number.isFinite(n)) return false
    return n === compTopUsd || n * 1000 === compTopUsd || n * 1_000_000 === compTopUsd
  })
}

/**
 * Ground the JD-side signals against the RAW job-description text (never jobReqs, which is itself
 * LLM-derived). Three tiers:
 *   Tier 1 (filter): drop mustHave/preferred skills and required certs absent from the JD text.
 *   Tier 2 (neutralize): null a compTopUsd with no matching JD figure, so it routes to scoreComp's
 *     existing neutral 65 path (no change to fitScore.ts).
 *   Tier 3 (flag, non-blocking): for each synthesized categorical, verify the model's evidence quote
 *     is a real JD substring; a missing/non-matching quote flags the field without altering its value.
 * hardGaps are flagged like Tier 3 (non-blocking): they are paraphrased judgments, so a literal filter
 * would false-drop legitimate gaps and make the score too generous. Pure + deterministic (LLM-free).
 */
export function groundJobSignals(signals: FitSignals, jdText: string): JobGroundedSignals {
  const jdNorm = normalize(jdText)
  const droppedJd: string[] = []

  const keepJd = (tokens: string[]): string[] =>
    (tokens ?? []).filter((t) => {
      const grounded = mentionsAny(jdNorm, t)
      if (!grounded) droppedJd.push(t)
      return grounded
    })

  // Tier 2: keep the comp only when a matching figure is in the JD text; otherwise null (neutral path).
  const compGrounded = signals.compTopUsd != null && compFigureInJd(signals.compTopUsd, jdText)
  const compNulled = signals.compTopUsd != null && !compGrounded
  const compTopUsd = compGrounded ? signals.compTopUsd : null

  // Tier 3: flag any categorical whose evidence quote is missing or not literally in the JD.
  const lowConfidenceFields: string[] = EVIDENCE_FIELDS.filter((f) => {
    const quote = normalize(signals.evidence?.[f] ?? '')
    return !quote || !jdNorm.includes(quote)
  })

  // Rubric 1.1.0 penalizing signals (engagementType, sponsorshipAvailable): NEUTRALIZE to 'unspecified'
  // when their evidence quote is not in the JD, so a hallucinated "no sponsorship" or wrong engagement
  // type can never apply a penalty from thin air. This is stronger than the Tier-3 flag above (which
  // only annotates): because these drive penalties, they fail SAFE by dropping to the no-penalty value.
  const jdHasQuote = (q: string | undefined): boolean => {
    const n = normalize(q ?? '')
    return n.length > 0 && jdNorm.includes(n)
  }
  const engagementGrounded =
    signals.engagementType === 'unspecified' || jdHasQuote(signals.evidence?.engagementType)
  const sponsorshipGrounded =
    signals.sponsorshipAvailable === 'unspecified' || jdHasQuote(signals.evidence?.sponsorshipAvailable)
  if (!engagementGrounded) lowConfidenceFields.push('engagementType')
  if (!sponsorshipGrounded) lowConfidenceFields.push('sponsorshipAvailable')

  // hardGaps: flag ungrounded gaps for telemetry, but keep them (paraphrase-safe, non-blocking).
  const ungroundedHardGaps = (signals.hardGaps ?? []).filter((g) => !mentionsAny(jdNorm, g))

  // must-haves drive the skillsCoverage SCORE (coverage()'s `required` list), so dropping them is not
  // score-neutral like dropping a display-only preferred skill: fewer requirements can only RAISE the
  // score. Tier 1's per-token drop of hallucinated requirements stays, with ONE guard (finding 7):
  // never empty a NON-empty must-have list. coverage() returns a fixed neutral (80) for an empty
  // `required`, which is right when the JD genuinely specified no must-haves, but if grounding drops
  // EVERY real must-have (e.g. all paraphrased in the JD text), that same neutral 80 would replace an
  // honest low score, silently turning a candidate who meets none of the requirements into an 80. So
  // when grounding would drop all of them, keep the originals: they stay counted as unmet in the
  // denominator, so grounding can never raise skillsCoverage. A list that was ALREADY empty still
  // takes the legitimate neutral path unchanged.
  const mustHaveGrounded = (signals.mustHaveSkills ?? []).filter((t) => mentionsAny(jdNorm, t))
  const dropWouldEmptyAll = signals.mustHaveSkills.length > 0 && mustHaveGrounded.length === 0
  const mustHaveSkills = dropWouldEmptyAll ? signals.mustHaveSkills : mustHaveGrounded
  // Report as dropped only the must-haves actually removed (none, when the originals were kept).
  for (const t of signals.mustHaveSkills) if (!mustHaveSkills.includes(t)) droppedJd.push(t)

  return {
    signals: {
      ...signals,
      mustHaveSkills,
      preferredSkills: keepJd(signals.preferredSkills),
      requiredCerts: keepJd(signals.requiredCerts),
      compTopUsd,
      engagementType: engagementGrounded ? signals.engagementType : 'unspecified',
      sponsorshipAvailable: sponsorshipGrounded ? signals.sponsorshipAvailable : 'unspecified',
    },
    droppedJd,
    compNulled,
    lowConfidenceFields,
    ungroundedHardGaps,
  }
}
