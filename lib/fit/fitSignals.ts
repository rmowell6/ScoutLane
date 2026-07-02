// The LLM extraction contract for fit (Fit_Assessment_SPEC.md): an LLM reads the resume + JD and
// emits these fuzzy signals; the deterministic engine (fitScore.ts) does the exact math. Keeping
// extraction and scoring separate is what makes the score reproducible.
//
// Categoricals are enums; booleans/arrays are required (no optionals) so structured output never
// omits a field. Candidate-side signals the resume can't supply, targetCompTopUsd (primary,
// from preferences) and lanesSurfaced, are injected by assembleFitInput, not asked of the model.
import * as z from 'zod'
import type { CandidatePreferences, JobReqs } from '@/lib/schemas'
import type { FitInput } from '@/lib/fit/fitScore'

export const FitSignalsSchema = z.object({
  roleTypeMatch: z.enum(['best', 'solid', 'stretch', 'off']),
  mustHaveSkills: z.array(z.string()),
  // The JD's PREFERRED / nice-to-have skills as canonical tokens. Display-only (ATS keyword coverage);
  // they do NOT feed the deterministic score, which stays on must-haves.
  preferredSkills: z.array(z.string()),
  candidateSkills: z.array(z.string()),
  adjacentSkills: z.array(z.string()),
  seniorityMatch: z.enum(['exact', 'adjacent', 'step_up', 'mismatch']),
  compTopUsd: z.number().nullable(),
  employerType: z.enum(['direct', 'managed_services', 'consulting', 'vendor']),
  location: z.enum(['remote_us', 'local_metro', 'hybrid_confirm', 'onsite_elsewhere']),
  locationFlags: z.object({
    onCall: z.boolean(),
    travelModerate: z.boolean(),
    travelHeavy: z.boolean(),
  }),
  vertical: z.enum(['match', 'adjacent', 'none']),
  // Engagement (tax/legal structure) and visa sponsorship, extracted ONLY when the JD is explicit;
  // 'unspecified' otherwise (never guess). These feed rubric 1.1.0 penalties, so they are grounded in
  // groundJobSignals (neutralized back to 'unspecified' if their evidence quote is not in the JD).
  engagementType: z.enum(['w2_fte', 'w2_contract', 'c2c', 'c2c_1099', 'unspecified']),
  sponsorshipAvailable: z.enum(['yes', 'no', 'unspecified']),
  requiredCerts: z.array(z.string()),
  heldCerts: z.array(z.string()),
  adjacentCerts: z.array(z.string()),
  hardGaps: z.array(z.string()),
  flags: z.object({
    expired: z.boolean(),
    unconfirmedLive: z.boolean(),
    defenseAdjacent: z.boolean(),
    heavyTravelOrPresales: z.boolean(),
  }),
  // A short VERBATIM JD excerpt backing each synthesized categorical, used only for JD-side grounding
  // (groundJobSignals), never fed to the scorer. Empty string when the JD offers no direct support.
  // A missing or non-matching quote sets a non-blocking low-confidence flag; it never changes the score.
  evidence: z.object({
    roleTypeMatch: z.string(),
    seniorityMatch: z.string(),
    location: z.string(),
    employerType: z.string(),
    vertical: z.string(),
    engagementType: z.string(),
    sponsorshipAvailable: z.string(),
  }),
})
export type FitSignals = z.infer<typeof FitSignalsSchema>

/**
 * Merge extracted JD/resume signals with candidate preferences into the engine's FitInput.
 * Pure + deterministic so it's unit-testable without the LLM.
 *
 * targetCompTopUsd: the candidate's own target, or 0 when they never set one. We deliberately do NOT
 * fall back to the JD's posted comp (finding 8): doing so made the comp scorer compare the posted
 * number to itself (ratio 1.0 -> score 92, "meets your target") for a target the candidate never
 * provided. Passing 0 routes scoreComp to its existing "target unavailable (neutral)" path, so
 * isUnassessed() marks the dimension "Not assessed" rather than displaying a fabricated match.
 */
export function assembleFitInput(
  signals: FitSignals,
  preferences: CandidatePreferences | undefined,
  jobReqs: JobReqs,
): FitInput {
  const targetCompTopUsd = preferences?.targetCompTopUsd ?? 0
  return {
    title: jobReqs.title,
    roleTypeMatch: signals.roleTypeMatch,
    mustHaveSkills: signals.mustHaveSkills,
    preferredSkills: signals.preferredSkills,
    candidateSkills: signals.candidateSkills,
    adjacentSkills: signals.adjacentSkills,
    seniorityMatch: signals.seniorityMatch,
    compTopUsd: signals.compTopUsd,
    targetCompTopUsd,
    employerType: signals.employerType,
    location: signals.location,
    locationFlags: signals.locationFlags,
    vertical: signals.vertical,
    requiredCerts: signals.requiredCerts,
    heldCerts: signals.heldCerts,
    adjacentCerts: signals.adjacentCerts,
    hardGaps: signals.hardGaps,
    flags: signals.flags,
    lanesSurfaced: 1,
    // Engagement + work-auth (rubric 1.1.0): JD side from the (grounded) signals, candidate side from
    // preferences. Absent candidate preferences leave these undefined -> no penalty.
    engagementType: signals.engagementType,
    sponsorshipAvailable: signals.sponsorshipAvailable,
    preferredEngagementType: preferences?.preferredEngagementType,
    needsSponsorship: preferences?.needsSponsorship,
  }
}
