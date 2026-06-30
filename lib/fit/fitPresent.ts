// Presentation-only helpers for the deterministic FitResult. These never change scoring — they map
// the engine's output to candidate-facing language so the UI doesn't show a misleading verdict.
//
// `isUnassessed` is intentionally COUPLED to the engine's neutral-note format (see scoreComp /
// assessFit in fitScore.ts): when a dimension has no real data, the engine emits a neutral placeholder
// score plus a note marked "(neutral)" (or "0 of 0" for an empty skills list). The UI uses this to
// render "Not assessed" instead of a number that reads as a real strength or gap. fitPresent.test.ts
// drives the real engine to pin this coupling, so a future note-text change can't silently break it.
import type { FitDimension } from './fitScore'

/** True when the engine could not actually judge this dimension (neutral placeholder, not a verdict). */
export function isUnassessed(d: FitDimension): boolean {
  return d.note.includes('(neutral)') || /^0 of 0\b/.test(d.note)
}

/** Candidate-facing band label. The engine's lowest band is internally "Lead" (CRM jargon); show plain
 * language. Display only — the engine value and golden output are unchanged. */
export function bandLabel(band: string): string {
  return band === 'Lead' ? 'Long shot' : band
}

/** Plain-language labels for the engine's penalty keys, so a docked score can explain itself. */
export const PENALTY_LABELS: Record<string, string> = {
  hardGaps: 'missing must-have requirements',
  expired: 'the posting may be expired',
  unconfirmedLive: 'the posting is not confirmed live',
  defenseAdjacent: 'a defense or clearance-adjacent role',
  heavyTravelOrPresales: 'heavy travel or pre-sales',
}
