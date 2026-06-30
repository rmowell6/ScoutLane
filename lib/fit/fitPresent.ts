// Presentation-only helpers for the deterministic FitResult. These never change scoring — they map
// the engine's output to candidate-facing language so the UI doesn't show a misleading verdict.
//
// `isUnassessed` is intentionally COUPLED to the engine's neutral-note format (see scoreComp /
// assessFit in fitScore.ts): when a dimension has no real data, the engine emits a neutral placeholder
// score plus a note marked "(neutral)" (or "0 of 0" for an empty skills list). The UI uses this to
// render "Not assessed" instead of a number that reads as a real strength or gap. fitPresent.test.ts
// drives the real engine to pin this coupling, so a future note-text change can't silently break it.
import type { FitDimension, FitResult } from './fitScore'

/** True when the engine could not actually judge this dimension (neutral placeholder, not a verdict). */
export function isUnassessed(d: FitDimension): boolean {
  return d.note.includes('(neutral)') || /^0 of 0\b/.test(d.note)
}

/** A confident, warm, HONEST one-line read on the overall band (no em dashes, per house style). Shared
 *  by the on-screen card and the generated document so the voice is identical. */
export function bandSummary(band: string): string {
  switch (band) {
    case 'Best fit':
      return 'A bullseye for your background. Tailor a packet and apply with confidence.'
    case 'Strong fit':
      return 'A strong match with a couple of honest stretches, well worth tailoring a packet for.'
    case 'Stretch':
      return 'A genuine stretch. Worth a shot if you can speak to the gaps below.'
    default: // Lead / Long shot
      return 'A reach for now. Weigh it against roles that fit more of your background.'
  }
}

/** Turn one dimension's terse engine note into candidate-facing copy. Coupled to the engine note
 *  formats in fitScore.ts (assessFit / scoreComp / scoreLocation); pinned by fitPresent.test.ts.
 *  Unknown/unassessed notes fall back to the raw note (isUnassessed handles the neutral display). */
export function humanizeNote(d: FitDimension): string {
  const after = (re: RegExp): string => d.note.match(re)?.[1]?.trim() ?? ''
  const pick = (map: Record<string, string>, key: string): string => map[key] ?? d.note

  switch (d.key) {
    case 'roleTypeMatch':
      return pick(
        {
          best: 'Your target title is a direct match for this role.',
          solid: 'Your title lines up closely with this role.',
          stretch: 'Your title is an adjacent fit, a reasonable stretch.',
          off: 'This role sits outside your usual title track.',
        },
        after(/fit:\s*(\w+)/),
      )
    case 'seniorityMatch':
      return pick(
        {
          exact: 'Your seniority is a direct match.',
          adjacent: 'Your seniority is a close, adjacent match.',
          step_up: 'A step up in seniority, a stretch worth making.',
          mismatch: 'The seniority level is a notable gap.',
        },
        after(/fit:\s*(\w+)/),
      )
    case 'employerPreference':
      return pick(
        {
          direct: 'A direct employer, which matches your preference.',
          managed_services: 'A managed-services employer.',
          consulting: 'A consulting employer.',
          vendor: 'A vendor employer.',
        },
        after(/type:\s*(\w+)/),
      )
    case 'verticalFit':
      return pick(
        {
          match: 'The industry is right in your wheelhouse.',
          adjacent: 'The industry is adjacent to your background.',
          none: 'This industry is new ground for you.',
        },
        after(/Vertical:\s*(\w+)/),
      )
    case 'locationLogistics':
      return pick(
        {
          remote_us: 'Remote within the US, a clean logistics fit.',
          local_metro: 'In a metro where you can work locally.',
          hybrid_confirm: 'Hybrid, worth confirming the on-site cadence.',
          onsite_elsewhere: 'On-site in a different location, a logistics hurdle.',
        },
        d.note.split(/[\s(.]/)[0] ?? '',
      )
    case 'skillsCoverage': {
      if (/^0 of 0\b/.test(d.note)) return 'No specific must-have skills were listed for this role.'
      const m = d.note.match(/(\d+) of (\d+)/)
      if (!m) return d.note
      const partial = d.note.match(/(\d+) partial/)?.[1]
      const base = `You bring ${m[1]} of the ${m[2]} must-have skills`
      return partial ? `${base}, with ${partial} more partially covered.` : `${base}.`
    }
    case 'certRequirementFit': {
      const m = d.note.match(/(\d+) of (\d+)/)
      return m ? `You hold ${m[1]} of the ${m[2]} required certifications.` : 'This role lists no required certifications.'
    }
    case 'compAlignment': {
      if (d.note.includes('(neutral)')) return 'No salary range was posted, so pay was not scored.'
      const m = d.note.match(/Posted top (\$[\d,]+) vs target (\$[\d,]+)/)
      if (!m) return d.note
      if (d.score >= 92) return `The posted top of ${m[1]} meets or beats your ${m[2]} target.`
      if (d.score >= 78) return `The posted top of ${m[1]} is close to your ${m[2]} target.`
      return `The posted top of ${m[1]} is below your ${m[2]} target.`
    }
    default:
      return d.note
  }
}

export interface SplitDimensions {
  /** Real strengths (assessed, score >= 75), best first. */
  strengths: FitDimension[]
  /** Everything assessed below a strength, weakest first (most actionable). No 60-75 dead zone. */
  stretches: FitDimension[]
  /** Dimensions the engine could not judge (shown as "Not assessed", never a number). */
  notAssessed: FitDimension[]
}

/** Group the dimensions for a strengths-first presentation shared by both surfaces. */
export function splitDimensions(fit: FitResult): SplitDimensions {
  const strengths: FitDimension[] = []
  const stretches: FitDimension[] = []
  const notAssessed: FitDimension[] = []
  for (const d of fit.dimensions) {
    if (isUnassessed(d)) notAssessed.push(d)
    else if (d.score >= 75) strengths.push(d)
    else stretches.push(d)
  }
  strengths.sort((a, b) => b.score - a.score)
  stretches.sort((a, b) => a.score - b.score)
  return { strengths, stretches, notAssessed }
}

/** Plain-language "what's holding this back": the penalties that actually applied, else the weakest
 *  assessed dimension. Empty string when there is nothing material to flag. */
export function holdingBackLine(fit: FitResult): string {
  const applied = Object.entries(fit.penalties).filter(([, v]) => v > 0)
  if (applied.length > 0) {
    return `What's holding this back: ${applied.map(([k]) => PENALTY_LABELS[k] ?? k).join(', ')}.`
  }
  const weakest = fit.dimensions.filter((d) => !isUnassessed(d)).sort((a, b) => a.score - b.score)[0]
  return weakest && weakest.score < 65 ? `Biggest gap: ${weakest.label} (${weakest.score}/100).` : ''
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
