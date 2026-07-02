import { describe, expect, test } from 'vitest'
import { groundCandidateSignals, groundJobSignals } from './groundSignals'
import { assembleFitInput, type FitSignals } from './fitSignals'
import { assessFit } from './fitScore'
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
    preferredSkills: [],
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
    engagementType: 'unspecified',
    sponsorshipAvailable: 'unspecified',
    hardGaps: [],
    flags: { expired: false, unconfirmedLive: false, defenseAdjacent: false, heavyTravelOrPresales: false },
    evidence: { roleTypeMatch: '', seniorityMatch: '', location: '', employerType: '', vertical: '', engagementType: '', sponsorshipAvailable: '' },
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

  test('a fact stating "no Kubernetes experience" does NOT keep Kubernetes as held (negation guard)', () => {
    // Mirrors guardrails' negation rationale: a disclaimer must not ground the very skill it denies.
    // Before this guard, the flattened-text scan kept the token, inflating skillsCoverage and the
    // on-screen coverage table while checkNoFabrication simultaneously refused to ground it.
    const disclaiming = profile({
      summary: 'No hands-on Kubernetes experience yet, focused on containers.',
      roles: [{ title: 'Cloud Engineer', company: 'Acme', bullets: ['Built container pipelines.'] }],
    } as never)
    const { signals: out, dropped } = groundCandidateSignals(
      signals({ candidateSkills: ['azure', 'kubernetes'] }),
      disclaiming,
    )
    expect(out.candidateSkills).toEqual(['azure'])
    expect(dropped).toEqual(['kubernetes'])
  })

  test('a negated fact does not block grounding via a DIFFERENT positive fact (fact-by-fact scope)', () => {
    // Same semantics as guardrails.groundedInFacts: only the negated fact is skipped, so a skill
    // positively stated elsewhere still grounds.
    const mixed = profile({
      summary: 'No hands-on AWS experience.',
      roles: [{ title: 'Cloud Engineer', company: 'Acme', bullets: ['Led the kubernetes migration for the platform team.'] }],
    } as never)
    const { signals: out } = groundCandidateSignals(signals({ candidateSkills: ['kubernetes'] }), mixed)
    expect(out.candidateSkills).toEqual(['kubernetes'])
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

// A clean JD carrying every token, figure, and evidence phrase the fully-grounded cases reference.
const JD = [
  'Senior Cloud Engineer, remote in the US.',
  'Required qualifications: Azure, Terraform, incident response. Must hold AZ-104.',
  'Preferred: Kubernetes and Python.',
  'Compensation up to $150,000 for this direct-hire role at a healthcare company.',
].join('\n')

const goodEvidence = {
  roleTypeMatch: 'Senior Cloud Engineer',
  seniorityMatch: 'Senior Cloud Engineer',
  location: 'remote in the US',
  employerType: 'direct-hire role',
  vertical: 'healthcare company',
  engagementType: '',
  sponsorshipAvailable: '',
}

describe('groundJobSignals', () => {
  test('Tier 1: drops JD skills/certs absent from the JD, keeps present ones (case/dash variants)', () => {
    const g = groundJobSignals(
      signals({
        mustHaveSkills: ['azure', 'terraform', 'cobol'], // cobol appears nowhere
        preferredSkills: ['Kubernetes', 'fortran'], // case variant kept, fortran dropped
        requiredCerts: ['AZ-104', 'ccna'], // AZ-104 present (case/dash), ccna absent
      }),
      JD,
    )
    expect(g.signals.mustHaveSkills).toEqual(['azure', 'terraform'])
    expect(g.signals.preferredSkills).toEqual(['Kubernetes'])
    expect(g.signals.requiredCerts).toEqual(['AZ-104'])
    expect(g.droppedJd.sort()).toEqual(['ccna', 'cobol', 'fortran'])
  })

  test('Tier 2: keeps a compTopUsd matching a JD figure written as $150,000', () => {
    const g = groundJobSignals(signals({ compTopUsd: 150000 }), JD)
    expect(g.signals.compTopUsd).toBe(150000)
    expect(g.compNulled).toBe(false)
  })

  test('Tier 2: matches the k shorthand ($150K stands for 150000)', () => {
    const g = groundJobSignals(signals({ compTopUsd: 150000 }), 'Comp up to $150K for this role.')
    expect(g.signals.compTopUsd).toBe(150000)
    expect(g.compNulled).toBe(false)
  })

  test('Tier 2: nulls a comp with no matching JD figure and routes to scoreComp neutral 65', () => {
    const g = groundJobSignals(signals({ compTopUsd: 999999 }), JD)
    expect(g.signals.compTopUsd).toBeNull()
    expect(g.compNulled).toBe(true)
    const fit = assessFit(assembleFitInput(g.signals, undefined, { title: 'x', mustHave: [], niceToHave: [] }))
    expect(fit.dimensions.find((d) => d.key === 'compAlignment')?.score).toBe(65)
  })

  test('Tier 3: a real evidence quote passes with no flag; a bad quote flags the field but keeps its value', () => {
    const good = groundJobSignals(signals({ location: 'remote_us', evidence: goodEvidence }), JD)
    expect(good.lowConfidenceFields).toEqual([])

    const bad = groundJobSignals(
      signals({ location: 'onsite_elsewhere', evidence: { ...goodEvidence, location: 'onsite in Berlin' } }),
      JD,
    )
    expect(bad.lowConfidenceFields).toEqual(['location'])
    expect(bad.signals.location).toBe('onsite_elsewhere') // categorical value never altered
  })

  test('neutralizes a penalizing signal (sponsorship "no") when its evidence quote is not in the JD', () => {
    // A hallucinated "no sponsorship" must not apply a penalty from thin air: no matching quote -> reset
    // to "unspecified" (and flagged). A grounded one is kept.
    const hallucinated = groundJobSignals(
      signals({ sponsorshipAvailable: 'no', evidence: { ...goodEvidence, sponsorshipAvailable: 'we do not sponsor visas' } }),
      JD, // JD says nothing about sponsorship
    )
    expect(hallucinated.signals.sponsorshipAvailable).toBe('unspecified')
    expect(hallucinated.lowConfidenceFields).toContain('sponsorshipAvailable')

    const jdWithClause = `${JD}\nWe are unable to sponsor visas for this role.`
    const grounded = groundJobSignals(
      signals({ sponsorshipAvailable: 'no', evidence: { ...goodEvidence, sponsorshipAvailable: 'unable to sponsor visas' } }),
      jdWithClause,
    )
    expect(grounded.signals.sponsorshipAvailable).toBe('no') // real, kept
  })

  test('hardGaps: an ungrounded gap is flagged for telemetry but not dropped', () => {
    const g = groundJobSignals(signals({ hardGaps: ['ts/sci clearance'] }), JD)
    expect(g.ungroundedHardGaps).toEqual(['ts/sci clearance'])
    expect(g.signals.hardGaps).toEqual(['ts/sci clearance']) // kept, non-blocking
  })

  test('full happy path: a clean, fully-grounded JD produces zero drops and zero flags', () => {
    const g = groundJobSignals(
      signals({
        mustHaveSkills: ['azure', 'terraform'],
        preferredSkills: ['kubernetes'],
        requiredCerts: ['az-104'],
        compTopUsd: 150000,
        hardGaps: [],
        location: 'remote_us',
        evidence: goodEvidence,
      }),
      JD,
    )
    expect(g.droppedJd).toEqual([])
    expect(g.compNulled).toBe(false)
    expect(g.lowConfidenceFields).toEqual([])
    expect(g.ungroundedHardGaps).toEqual([])
    expect(g.signals.mustHaveSkills).toEqual(['azure', 'terraform'])
    expect(g.signals.compTopUsd).toBe(150000)
  })
})
