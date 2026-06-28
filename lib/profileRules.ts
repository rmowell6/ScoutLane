// The reference profile's standing content rules, lifted from the resume template spec
// ("Standing content rules"). These are enforced in code by the guardrails — the
// no-fabrication promise is mechanical, not a prompt suggestion (CLAUDE.md invariant).
//
// SCOPE / TODO (multi-user): both BANNED_TERMS and FACT_NOTES below are CURRENTLY GLOBAL — a
// single reference profile's corrections applied to every packet. BANNED_TERMS is generically
// safe (it only blocks a term when it is NOT grounded in the user's own profile facts), but
// FACT_NOTES is persona-specific. When ScoutLane becomes multi-user, move both to a per-profile
// record keyed by user_id. For now they encode the corrections that must never regress, and the
// persona values are aligned to the fictional load-sample (lib ... app/page.tsx).

/** Terms that must NEVER appear unless literally present in the profile facts. */
export const BANNED_TERMS: string[] = [
  'Kubernetes',
  'Docker',
  'AKS',
  'containers',
  'container',
  // The reference profile never deployed Azure landing zones — block the phrase outright.
  'Azure landing zones',
  'landing zone',
]

/** Phrasing rules the style check enforces (em dashes read as AI-generated). */
export const STYLE_RULES = {
  allowEmDash: false,
} as const

/**
 * Claims/phrasings that are factually constrained. Used to refine prompts and as
 * documentation of the corrections; the banned list above is the hard enforcement.
 */
// Aligned to the fictional load-sample persona (Jordan Rivera @ Northwind Health) so the
// documentation is self-consistent — no entities here that aren't in that sample.
export const FACT_NOTES: string[] = [
  'Terraform is working knowledge only (no heavy production use).',
  'Azure Virtual Desktop (AVD) and Veeam belong to the Northwind Health role and the skills section.',
]
