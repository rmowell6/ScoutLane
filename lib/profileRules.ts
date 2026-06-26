// Ryan Mowell's standing content rules, lifted from Ryan_Resume_Template_SPEC.md
// ("Standing content rules"). These are enforced in code by the guardrails — the
// no-fabrication promise is mechanical, not a prompt suggestion (CLAUDE.md invariant).
//
// When ScoutLane becomes multi-user these move to a per-profile record; for now they
// encode the corrections that must never regress.

/** Terms that must NEVER appear unless literally present in the profile facts. */
export const BANNED_TERMS: string[] = [
  'Kubernetes',
  'Docker',
  'AKS',
  'containers',
  'container',
  // "Azure landing zones were never deployed by Ryan" — block the phrase outright.
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
export const FACT_NOTES: string[] = [
  'Terraform is working knowledge only (Associate coursework, no exam, no heavy production use).',
  'AVD deployments belong at Signature Performance and Tempoe only.',
  'Veeam belongs in the Signature Performance role and the skills section.',
  'Preserve both education entries: Sinclair Community College and Kettering Fairmont High School.',
]
