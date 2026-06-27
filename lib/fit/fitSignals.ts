// The LLM extraction contract for fit (Fit_Assessment_SPEC.md): an LLM reads the resume + JD and
// emits these fuzzy signals; the deterministic engine (fitScore.ts) does the exact math. Keeping
// extraction and scoring separate is what makes the score reproducible.
//
// Categoricals are enums; booleans/arrays are required (no optionals) so structured output never
// omits a field. Candidate-side signals the resume can't supply — targetCompTopUsd (primary,
// from preferences) and lanesSurfaced — are injected by assembleFitInput, not asked of the model.
import * as z from 'zod'
import type { CandidatePreferences, JobReqs } from '@/lib/schemas'
import type { FitInput } from '@/lib/fit/fitScore'

export const FitSignalsSchema = z.object({
  roleTypeMatch: z.enum(['best', 'solid', 'stretch', 'off']),
  mustHaveSkills: z.array(z.string()),
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
})
export type FitSignals = z.infer<typeof FitSignalsSchema>

/**
 * Merge extracted JD/resume signals with candidate preferences into the engine's FitInput.
 * Pure + deterministic so it's unit-testable without the LLM.
 *
 * targetCompTopUsd precedence: candidate's target -> the JD's posted top -> 1 (a harmless
 * placeholder; when compTopUsd is null the comp scorer returns neutral 65 regardless of target).
 */
export function assembleFitInput(
  signals: FitSignals,
  preferences: CandidatePreferences | undefined,
  jobReqs: JobReqs,
): FitInput {
  const targetCompTopUsd = preferences?.targetCompTopUsd ?? signals.compTopUsd ?? 1
  return {
    title: jobReqs.title,
    roleTypeMatch: signals.roleTypeMatch,
    mustHaveSkills: signals.mustHaveSkills,
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
  }
}
