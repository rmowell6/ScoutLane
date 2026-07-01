import { describe, expect, test } from 'vitest'
import { describeGuardrailFailure, describeReviewFlags } from './guardrailMessages'
import type { GuardrailReport } from './guardrails'

// Minimal passing report; tests flip individual checks to failing.
function report(over: Partial<GuardrailReport> = {}): GuardrailReport {
  return {
    ok: false,
    noFabrication: { ok: true, unverifiable: [], ungroundedSkills: [], ungroundedMetrics: [] },
    bannedTerms: { ok: true, violations: [] },
    style: { ok: true, violations: [] },
    ats: null,
    bulletsGrounded: { ok: true, skipped: false, ungroundedMetrics: [], flagged: [] },
    certStatus: { ok: true, skipped: false, suspicious: [], notFound: [] },
    educationGrounded: { ok: true, skipped: false, flagged: [] },
    ...over,
  }
}

describe('describeGuardrailFailure', () => {
  test('ungrounded skill → names the skill and tells the user how to fix it', () => {
    const { title, reasons } = describeGuardrailFailure(
      report({ noFabrication: { ok: false, unverifiable: [], ungroundedSkills: ['Windows Server 2012-2022'], ungroundedMetrics: [] } }),
    )
    expect(title).toMatch(/accurate/i)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('"Windows Server 2012-2022"')
    expect(reasons[0]).toMatch(/resume/i)
    expect(reasons[0]).toMatch(/regenerate|try again/i)
    // No developer jargon leaks through.
    expect(reasons[0]).not.toMatch(/no-fabrication|factId|guardrail/i)
  })

  test('aggregates multiple failed checks into separate reasons', () => {
    const { reasons } = describeGuardrailFailure(
      report({
        noFabrication: { ok: false, unverifiable: [], ungroundedSkills: ['Kubernetes'], ungroundedMetrics: ['40%'] },
        style: { ok: false, violations: ['contains em dash (—)'] },
      }),
    )
    expect(reasons.length).toBe(3) // ungrounded skill + ungrounded metric + style
  })

  test('always yields at least one actionable reason', () => {
    expect(describeGuardrailFailure(report()).reasons.length).toBeGreaterThan(0)
  })
})

describe('describeReviewFlags', () => {
  test('no flags yields no notes', () => {
    expect(describeReviewFlags(report())).toEqual([])
  })

  test('a cert absent from the source gets its own note, distinct from the previously-held one', () => {
    const notes = describeReviewFlags(
      report({ certStatus: { ok: false, skipped: false, suspicious: [], notFound: ['PMP'] } }),
    )
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('"PMP"')
    expect(notes[0]).toMatch(/isn't in the resume you uploaded/i)
    expect(notes[0]).not.toMatch(/previously held/i) // distinct from the suspicious message
  })

  test('a suspicious (looks previously-held) cert gets the currency note', () => {
    const notes = describeReviewFlags(
      report({ certStatus: { ok: false, skipped: false, suspicious: ['CCNA'], notFound: [] } }),
    )
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatch(/previously held/i)
  })

  test('a low-overlap education entry gets a review note', () => {
    const notes = describeReviewFlags(
      report({ educationGrounded: { ok: true, skipped: false, flagged: [{ text: 'PhD Astrophysics MIT', overlap: 0.1 }] } }),
    )
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('"PhD Astrophysics MIT"')
    expect(notes[0]).toMatch(/education/i)
  })
})
