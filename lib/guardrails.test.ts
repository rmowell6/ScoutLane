import { describe, expect, test } from 'vitest'
import type { Profile, TailoredContent } from '@/lib/schemas'
import {
  checkAtsSafe,
  checkBannedTerms,
  checkNoFabrication,
  checkStyle,
  indexFacts,
  runGuardrails,
} from '@/lib/guardrails'

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    name: 'Ada Lovelace',
    summary: 'Infrastructure engineer.',
    skills: ['Azure', 'VMware'],
    roles: [
      {
        company: 'Analytical Engines',
        title: 'Platform Engineer',
        startDate: '2022',
        endDate: null,
        bullets: ['Migrated 40 VMs to Azure', 'Cut backup costs 30%'],
      },
    ],
    certs: ['Azure Administrator Associate'],
    education: [{ school: 'Cambridge', degree: 'BSc', field: 'Mathematics', year: '2018' }],
    ...overrides,
  }
}

function makeTailored(overrides: Partial<TailoredContent> = {}): TailoredContent {
  return {
    summary: 'Platform Engineer with Azure experience.',
    skills: ['Azure', 'VMware'],
    claims: [{ text: 'Migrated 40 VMs to Azure', factId: 'role:0:bullet:0' }],
    coverLetter: 'I would be glad to bring my Azure experience to your team.',
    ...overrides,
  }
}

describe('indexFacts', () => {
  test('indexes skills, role bullets, and certs as addressable facts', () => {
    const index = indexFacts(makeProfile())
    expect(index.byId.get('skill:0')).toBe('Azure')
    expect(index.byId.get('role:0:bullet:1')).toBe('Cut backup costs 30%')
    expect(index.byId.get('cert:0')).toBe('Azure Administrator Associate')
  })
})

describe('checkNoFabrication', () => {
  test('rejects a skill not present in the profile (factId null)', () => {
    const profile = makeProfile({ skills: ['Azure', 'VMware'] })
    const tailored = makeTailored({ claims: [{ text: 'Kubernetes', factId: null }] })
    const result = checkNoFabrication(tailored, profile)
    expect(result.ok).toBe(false)
    expect(result.unverifiable).toHaveLength(1)
  })

  test('rejects a claim that references a non-existent factId', () => {
    const tailored = makeTailored({ claims: [{ text: 'Led a team of 10', factId: 'role:9:bullet:9' }] })
    expect(checkNoFabrication(tailored, makeProfile()).ok).toBe(false)
  })

  test('passes when every claim traces to a real fact', () => {
    const tailored = makeTailored({
      claims: [
        { text: 'Migrated 40 VMs to Azure', factId: 'role:0:bullet:0' },
        { text: 'Azure Administrator Associate', factId: 'cert:0' },
      ],
    })
    expect(checkNoFabrication(tailored, makeProfile()).ok).toBe(true)
  })

  test('accepts a claim that verbatim-restates a fact even with a wrong/null factId', () => {
    // The model cited null but the text is an exact restatement of a real bullet — not fabricated.
    const tailored = makeTailored({ claims: [{ text: 'Migrated 40 VMs to Azure', factId: null }] })
    expect(checkNoFabrication(tailored, makeProfile()).ok).toBe(true)
  })

  test('rejects a stripped fragment of a longer fact (factId null) — no one-directional substring pass', () => {
    const profile = makeProfile({
      roles: [
        {
          company: 'Analytical Engines',
          title: 'Platform Engineer',
          startDate: '2022',
          endDate: null,
          bullets: ['Migrated 40 VMs to Azure with zero data loss and full rollback coverage'],
        },
      ],
    })
    const tailored = makeTailored({ claims: [{ text: 'Migrated 40 VMs', factId: null }] })
    const result = checkNoFabrication(tailored, profile)
    expect(result.ok).toBe(false)
    expect(result.unverifiable).toHaveLength(1)
  })

  test('flags a tailored skill not grounded in any profile fact', () => {
    const tailored = makeTailored({ skills: ['Azure', 'Kubernetes'] })
    const result = checkNoFabrication(tailored, makeProfile())
    expect(result.ok).toBe(false)
    expect(result.ungroundedSkills).toContain('Kubernetes')
  })

  test('passes when tailored skills are all present in the profile', () => {
    const tailored = makeTailored({ skills: ['Azure', 'VMware'] })
    expect(checkNoFabrication(tailored, makeProfile()).ungroundedSkills).toEqual([])
  })
})

describe('checkBannedTerms', () => {
  test('flags a banned term absent from the profile', () => {
    const tailored = makeTailored({ summary: 'Expert in Kubernetes and Azure.' })
    const result = checkBannedTerms(tailored, makeProfile(), ['Kubernetes', 'Docker'])
    expect(result.ok).toBe(false)
    expect(result.violations).toContain('Kubernetes')
  })

  test('allows a watched term that IS present in the profile', () => {
    const profile = makeProfile({ skills: ['Azure', 'VMware', 'Kubernetes'] })
    const tailored = makeTailored({ summary: 'Expert in Kubernetes and Azure.' })
    expect(checkBannedTerms(tailored, profile, ['Kubernetes']).ok).toBe(true)
  })
})

describe('checkStyle', () => {
  test('flags em dashes by default', () => {
    expect(checkStyle('I led the team — and shipped.').ok).toBe(false)
  })

  test('passes clean prose', () => {
    expect(checkStyle('I led the team and shipped.').ok).toBe(true)
  })

  test('flags repeated spaces within a line', () => {
    expect(checkStyle('I led  the team.').ok).toBe(false)
  })

  test('does NOT flag newlines or blank-line paragraph breaks', () => {
    expect(checkStyle('First paragraph.\n\nSecond paragraph.').ok).toBe(true)
  })
})

describe('checkAtsSafe', () => {
  test('flags tables, images, and multi-column layouts', () => {
    const result = checkAtsSafe({ columns: 2, hasTables: true, hasImages: true, textRunCount: 5 })
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual(
      expect.arrayContaining(['multi-column layout', 'contains tables', 'contains images']),
    )
  })

  test('passes a single-column, text-only document', () => {
    expect(checkAtsSafe({ columns: 1, hasTables: false, hasImages: false, textRunCount: 12 }).ok).toBe(true)
  })
})

describe('runGuardrails', () => {
  test('passes a faithful, clean packet', () => {
    const report = runGuardrails(makeTailored(), makeProfile(), {
      bannedTerms: ['Kubernetes'],
      atsDoc: { columns: 1, hasTables: false, hasImages: false, textRunCount: 20 },
    })
    expect(report.ok).toBe(true)
  })

  test('fails the whole report if any single check fails', () => {
    const tailored = makeTailored({ claims: [{ text: 'Kubernetes', factId: null }] })
    const report = runGuardrails(tailored, makeProfile())
    expect(report.ok).toBe(false)
    expect(report.noFabrication.ok).toBe(false)
  })
})
