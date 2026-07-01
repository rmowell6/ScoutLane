// Human-facing copy for a blocked packet. The guardrail report is precise but developer-speak
// ("no-fabrication: 1 tailored skill(s) not in the profile"), this turns each failed check into a
// plain-language explanation of WHY the packet was held and HOW to fix it, so a non-technical user
// isn't left confused or frustrated. The raw GuardrailReport still ships alongside for debugging.
import type { GuardrailReport } from '@/lib/guardrails'

export interface FriendlyGuardrailFailure {
  /** A calm, non-alarming headline. */
  title: string
  /** One actionable sentence per failed check. */
  reasons: string[]
}

const list = (items: string[]) => items.map((s) => `"${s}"`).join(', ')

/** Map a failed GuardrailReport to user-facing title + reasons. Assumes report.ok === false. */
export function describeGuardrailFailure(g: GuardrailReport): FriendlyGuardrailFailure {
  const reasons: string[] = []

  const nf = g.noFabrication
  if (!nf.ok) {
    if (nf.ungroundedSkills.length > 0) {
      reasons.push(
        `A tailored skill (${list(nf.ungroundedSkills)}) doesn't appear in your resume, so we held the ` +
          `packet back rather than overstate your background. ScoutLane only lists skills you've actually ` +
          `written down. What to do: add that skill to your resume in the same words and regenerate, or just ` +
          `try again (this can happen when the wording differs only slightly).`,
      )
    }
    if (nf.unverifiable.length > 0) {
      reasons.push(
        `A tailored bullet couldn't be traced back to your resume (${list(nf.unverifiable.map((c) => c.text))}). ` +
          `To keep every line truthful, we won't ship a claim we can't ground. What to do: regenerate; if it ` +
          `repeats, make sure that experience is actually in your resume.`,
      )
    }
    if (nf.ungroundedMetrics.length > 0) {
      reasons.push(
        `A number in the summary or cover letter (${list(nf.ungroundedMetrics)}) isn't in your resume, and we ` +
          `don't invent figures. What to do: add the real figure to your resume, or regenerate to drop it.`,
      )
    }
  }

  if (!g.bulletsGrounded.ok) {
    reasons.push(
      `A number in your resume bullets (${list(g.bulletsGrounded.ungroundedMetrics)}) couldn't be matched to the ` +
        `resume you uploaded. What to do: check that figure is in your uploaded resume, then regenerate.`,
    )
  }

  if (!g.bannedTerms.ok) {
    reasons.push(
      `The draft used a term you asked us to avoid (${list(g.bannedTerms.violations)}) that your resume doesn't ` +
        `support. What to do: regenerate, or add the term to your resume if it genuinely applies.`,
    )
  }

  if (!g.style.ok) {
    reasons.push(
      `The draft tripped a formatting rule (${g.style.violations.join('; ')}). This is usually a one-off. ` +
        `What to do: just regenerate.`,
    )
  }

  if (g.ats && !g.ats.ok) {
    reasons.push(
      `The draft wasn't ATS-safe (${g.ats.problems.join('; ')}). What to do: regenerate; if it persists, ` +
        `simplify any unusual formatting in your resume.`,
    )
  }

  if (reasons.length === 0) {
    reasons.push('A safety check held this packet back. Please regenerate. If it keeps happening, let us know.')
  }

  return {
    title: 'We held this packet back to keep it accurate',
    reasons,
  }
}
