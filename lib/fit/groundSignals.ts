// Fit-signal grounding (ai-27): the LLM fit-extractor classifies the candidate's skills/certs, but a
// hallucinated candidate token the resume doesn't support would inflate skill/cert COVERAGE and so
// the deterministic fit score. After extraction we drop any CANDIDATE-side token that doesn't appear
// anywhere in the profile facts. JD-side lists (mustHaveSkills / requiredCerts / hardGaps) describe
// the job, not the candidate, so they are NOT filtered, they must stay intact for coverage to mean
// anything.
import { indexFacts, mentions } from '@/lib/guardrails'
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
 */
export function groundCandidateSignals(signals: FitSignals, profile: Profile): GroundedSignals {
  const profileText = indexFacts(profile).texts.join(' \n ')
  const dropped: string[] = []

  const keep = (tokens: string[]): string[] =>
    (tokens ?? []).filter((t) => {
      const grounded = mentions(profileText, t)
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
