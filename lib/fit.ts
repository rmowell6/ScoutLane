// Presentation helpers for the fit assessment — pure + client-safe (used by both the .docx
// builder and the on-screen packet view). These derive a band/recommendation from the score;
// they invent no data (the score and notes come from scoreFit).

export interface FitBand {
  /** Short label, e.g. "Strong fit". */
  band: string
  /** One-sentence, plain-language recommendation. */
  recommendation: string
}

/** Map an overall 0–100 fit score to a band + recommendation. */
export function fitBand(overall: number): FitBand {
  if (overall >= 75) {
    return { band: 'Strong fit', recommendation: 'A strong match — worth applying with a tailored packet.' }
  }
  if (overall >= 55) {
    return { band: 'Solid fit', recommendation: 'A solid match — apply, and lean into the strongest dimensions.' }
  }
  if (overall >= 40) {
    return { band: 'Stretch fit', recommendation: 'A stretch — apply only if you can close the gaps the assessment flags.' }
  }
  return { band: 'Reach', recommendation: 'A reach for now — consider roles that match more of your background.' }
}

/** Turn a reason code like "strong-domain" / "junior_seniority" into "Strong domain". */
export function humanizeCode(code: string): string {
  const words = code.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
