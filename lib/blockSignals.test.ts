import { describe, expect, test } from 'vitest'
import { runGuardrails } from '@/lib/guardrails'
import { deriveBlockSignals } from '@/lib/blockSignals'
import type { Profile, TailoredContent } from '@/lib/schemas'

// A profile that holds a VMware cert and two Azure-migration bullets, so a claim can be TRUE about the
// profile's content while adding a count the lexical checker can't verify.
const profile: Profile = {
  name: 'Ada Lovelace',
  summary: 'Infrastructure engineer.',
  skills: ['Azure', 'VMware'],
  roles: [
    {
      company: 'Analytical Engines',
      title: 'Platform Engineer',
      startDate: '2021',
      endDate: null,
      bullets: ['Ran Azure migrations for the org', 'Migrated 40 VMs to Azure'],
    },
  ],
  certs: [{ name: 'VMware Certified Professional (VCP-DCV)' }],
  education: [{ school: 'Cambridge', degree: 'BSc', field: 'Mathematics', year: '2018' }],
}

const atsDoc = { columns: 1, hasTables: false, hasImages: false, textRunCount: 5 }

// Benign, fully-grounded prose so the ONLY failing check is no-fabrication (unverifiable claims).
const baseTailored: Omit<TailoredContent, 'claims'> = {
  summary: 'Platform Engineer with Azure and VMware experience.',
  skills: ['Azure', 'VMware'],
  coverLetter: 'I would be glad to bring my Azure and VMware experience to your team.',
  outreach: { linkedin: 'Azure and VMware engineer keen to connect.', email: 'Hello, I bring Azure experience. Best, Ada' },
}

const reportFor = (claims: TailoredContent['claims']) =>
  runGuardrails({ ...baseTailored, claims }, profile, { atsDoc })

describe('deriveBlockSignals', () => {
  test('flags a true derived aggregate (word-count "three-time" and a digit "5") vs a genuine invention', () => {
    const report = reportFor([
      { text: 'Three-time VMware Certified Professional', factId: 'cert:0' }, // true aggregate (word number + quantifier)
      { text: 'Ran 5 Azure migrations', factId: 'role:0:bullet:0' }, // true aggregate (digit), content grounds
      { text: 'Led Kubernetes platform migration', factId: null }, // genuine invention, Kubernetes not in profile
    ])
    expect(report.ok).toBe(false)
    expect(report.noFabrication.unverifiable.length).toBe(3) // all three are blocked as unverifiable

    const s = deriveBlockSignals(report, profile)
    expect(s.block_reasons).toContain('unverifiable_claims')
    expect(s.unverifiable_count).toBe(3)
    expect(s.claims_with_number).toBe(2) // "three-time" (word) + "5" (digit)
    expect(s.claims_with_quantifier).toBe(1) // "time"
    expect(s.claims_like_aggregate).toBe(2) // the two grounded-except-for-the-count claims
    expect(s.looks_like_aggregate).toBe(true)
  })

  test('a pure invention with no count does NOT look like an aggregate', () => {
    const report = reportFor([{ text: 'Led Kubernetes platform migration', factId: null }])
    expect(report.ok).toBe(false)
    const s = deriveBlockSignals(report, profile)
    expect(s.unverifiable_count).toBe(1)
    expect(s.claims_with_number).toBe(0)
    expect(s.claims_with_quantifier).toBe(0)
    expect(s.claims_like_aggregate).toBe(0)
    expect(s.looks_like_aggregate).toBe(false)
  })

  test('a clean report yields all-zero signals and no reasons (safe to call unconditionally)', () => {
    const report = reportFor([{ text: 'Migrated 40 VMs to Azure', factId: 'role:0:bullet:1' }])
    expect(report.ok).toBe(true) // faithful restatement, nothing blocked
    const s = deriveBlockSignals(report, profile)
    expect(s.block_reasons).toEqual([])
    expect(s.unverifiable_count).toBe(0)
    expect(s.looks_like_aggregate).toBe(false)
  })

  test('surfaces non-fabrication block reasons (style) alongside the counts', () => {
    // An em dash in the cover letter trips the style check; assert it shows up as a reason.
    const report = runGuardrails(
      { ...baseTailored, coverLetter: 'Azure and VMware experience — ready to help.', claims: [] },
      profile,
      { atsDoc },
    )
    expect(report.ok).toBe(false)
    const s = deriveBlockSignals(report, profile)
    expect(s.block_reasons).toContain('style')
    expect(s.style_violation_count).toBeGreaterThan(0)
  })
})
