import { describe, expect, test } from 'vitest'
import { groundCandidateSignals } from './groundSignals'
import type { FitSignals } from './fitSignals'
import type { Profile } from '@/lib/schemas'

function profile(over: Partial<Profile> = {}): Profile {
  return {
    name: 'Jordan Rivera',
    skills: ['azure', 'terraform'],
    certs: [{ name: 'az-104' }],
    roles: [
      {
        title: 'Cloud Engineer',
        company: 'Acme',
        bullets: ['Led the kubernetes migration for the platform team.'],
      },
    ],
    education: [],
    ...over,
  } as Profile
}

function signals(over: Partial<FitSignals> = {}): FitSignals {
  return {
    roleTypeMatch: 'solid',
    mustHaveSkills: ['azure', 'aws'],
    candidateSkills: ['azure'],
    adjacentSkills: [],
    seniorityMatch: 'exact',
    compTopUsd: null,
    employerType: 'direct',
    location: 'remote_us',
    locationFlags: { onCall: false, travelModerate: false, travelHeavy: false },
    vertical: 'match',
    requiredCerts: ['az-104'],
    heldCerts: ['az-104'],
    adjacentCerts: [],
    hardGaps: [],
    flags: { expired: false, unconfirmedLive: false, defenseAdjacent: false, heavyTravelOrPresales: false },
    ...over,
  }
}

describe('groundCandidateSignals', () => {
  test('keeps candidate skills present in the profile facts (skills list OR a role bullet)', () => {
    const { signals: out, dropped } = groundCandidateSignals(
      signals({ candidateSkills: ['azure', 'kubernetes'] }), // azure=skill, kubernetes=in a bullet
      profile(),
    )
    expect(out.candidateSkills.sort()).toEqual(['azure', 'kubernetes'])
    expect(dropped).toEqual([])
  })

  test('drops a hallucinated candidate skill the profile does not support', () => {
    const { signals: out, dropped } = groundCandidateSignals(
      signals({ candidateSkills: ['azure', 'cobol'] }), // cobol appears nowhere
      profile(),
    )
    expect(out.candidateSkills).toEqual(['azure'])
    expect(dropped).toEqual(['cobol'])
  })

  test('grounds heldCerts/adjacentCerts too', () => {
    const { signals: out, dropped } = groundCandidateSignals(
      signals({ heldCerts: ['az-104', 'ccie'], adjacentCerts: ['az-104'] }),
      profile(),
    )
    expect(out.heldCerts).toEqual(['az-104'])
    expect(out.adjacentCerts).toEqual(['az-104'])
    expect(dropped).toEqual(['ccie'])
  })

  test('does NOT filter JD-side lists (mustHaveSkills / requiredCerts / hardGaps stay intact)', () => {
    const { signals: out } = groundCandidateSignals(
      signals({ mustHaveSkills: ['azure', 'aws'], requiredCerts: ['az-104', 'ccna'], hardGaps: ['aws'] }),
      profile(),
    )
    expect(out.mustHaveSkills).toEqual(['azure', 'aws']) // aws not in profile but kept (JD-side)
    expect(out.requiredCerts).toEqual(['az-104', 'ccna'])
    expect(out.hardGaps).toEqual(['aws'])
  })
})
