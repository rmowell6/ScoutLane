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

  // Finding 11: scoring credit must come from an explicit capability assertion, not an incidental word
  // match in a company name, job title, or school.
  test('a company name alone does NOT keep the matching candidate skill ("Oracle Health" != Oracle)', () => {
    const oracleEmployer = profile({
      skills: ['azure'],
      roles: [{ title: 'Support Engineer', company: 'Oracle Health', bullets: ['Resolved customer tickets'] }],
    } as never)
    const { signals: out, dropped } = groundCandidateSignals(signals({ candidateSkills: ['oracle'] }), oracleEmployer)
    expect(out.candidateSkills).toEqual([])
    expect(dropped).toEqual(['oracle'])
  })

  test('a job title alone does NOT keep the matching candidate skill', () => {
    const titled = profile({
      skills: ['azure'],
      roles: [{ title: 'Kubernetes Platform Lead', company: 'Acme', bullets: ['Resolved customer tickets'] }],
    } as never)
    const { signals: out } = groundCandidateSignals(signals({ candidateSkills: ['kubernetes'] }), titled)
    expect(out.candidateSkills).toEqual([])
  })

  test('regression: a genuine skill-list or bullet claim of Oracle still gets full credit', () => {
    const skillClaim = profile({ skills: ['oracle', 'azure'], roles: [{ title: 'Engineer', company: 'Acme', bullets: ['Resolved tickets'] }] } as never)
    expect(groundCandidateSignals(signals({ candidateSkills: ['oracle'] }), skillClaim).signals.candidateSkills).toEqual(['oracle'])
    const bulletClaim = profile({ skills: ['azure'], roles: [{ title: 'DBA', company: 'Acme', bullets: ['Administered Oracle databases in production'] }] } as never)
    expect(groundCandidateSignals(signals({ candidateSkills: ['oracle'] }), bulletClaim).signals.candidateSkills).toEqual(['oracle'])
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
  test('Tier 1 (F-B): keeps must-haves/certs for scoring, drops only display-only preferred absent from the JD', () => {
    const g = groundJobSignals(
      signals({
        mustHaveSkills: ['azure', 'terraform', 'cobol'], // cobol appears nowhere in the JD
        preferredSkills: ['Kubernetes', 'fortran'], // case variant kept, fortran dropped
        requiredCerts: ['AZ-104', 'ccna'], // ccna absent from the JD
      }),
      JD,
    )
    // must-haves and required certs drive the SCORE, so they are never filtered: dropping even one
    // (e.g. the absent cobol / ccna) could shrink the denominator and raise the score (F-B).
    expect(g.signals.mustHaveSkills).toEqual(['azure', 'terraform', 'cobol'])
    expect(g.signals.requiredCerts).toEqual(['AZ-104', 'ccna'])
    // preferred is display-only (never scored), so an absent one is still dropped and reported.
    expect(g.signals.preferredSkills).toEqual(['Kubernetes'])
    expect(g.droppedJd).toEqual(['fortran'])
  })

  // Finding 7: dropping EVERY must-have must not route skillsCoverage to coverage()'s empty-list
  // neutral (80), which would replace an honest low score. Grounding must never RAISE skillsCoverage.
  const noReqs = { title: 'x', company: 'y', mustHave: [], niceToHave: [] }
  const skillsCovScore = (s: FitSignals): number =>
    assessFit(assembleFitInput(s, undefined, noReqs)).dimensions.find((d) => d.key === 'skillsCoverage')!.score

  test('finding 7: a must-have list fully dropped by grounding does NOT jump to the neutral 80', () => {
    // 'kubernetes'/'terraform' are real requirements paraphrased in the JD text, so Tier 1 would drop
    // both; the candidate holds neither, so the honest score is 0.
    const jd = 'We need container orchestration and infrastructure automation experience.'
    const s = signals({ mustHaveSkills: ['kubernetes', 'terraform'], candidateSkills: [], requiredCerts: [], heldCerts: [] })
    const honest = skillsCovScore(s) // against the original (pre-drop) list -> 0
    const g = groundJobSignals(s, jd)
    // The guard keeps the originals rather than emptying, so they still count as unmet.
    expect(g.signals.mustHaveSkills).toEqual(['kubernetes', 'terraform'])
    expect(g.droppedJd).toEqual([]) // no must-have reported dropped, since none was removed
    expect(skillsCovScore(g.signals)).toBe(honest)
    expect(skillsCovScore(g.signals)).toBeLessThanOrEqual(honest) // never raised
    expect(skillsCovScore(g.signals)).not.toBe(80)
  })

  test('finding 7 regression: a JD that GENUINELY specified no must-haves still gets the neutral 80', () => {
    const g = groundJobSignals(signals({ mustHaveSkills: [], candidateSkills: [] }), JD)
    expect(g.signals.mustHaveSkills).toEqual([])
    expect(skillsCovScore(g.signals)).toBe(80) // legitimate empty-list neutral path, unchanged
  })

  // Finding F-A: requiredCerts drives certRequirementFit through the SAME coverage() empty-list
  // neutral, so it has finding 7's identical exposure. The same never-empty guard now applies.
  const certCovScore = (s: FitSignals): number =>
    assessFit(assembleFitInput(s, undefined, noReqs)).dimensions.find((d) => d.key === 'certRequirementFit')!.score

  test('F-A: a requiredCerts list fully dropped by grounding does NOT jump to the neutral 80', () => {
    // Both certs are real requirements paraphrased in the JD, so Tier 1 would drop both; the candidate
    // holds neither, so the honest certs score is 0.
    const jd = 'Requires an Azure administration certification and a networking certification.'
    const s = signals({ mustHaveSkills: [], requiredCerts: ['az-104', 'ccna'], heldCerts: [], adjacentCerts: [] })
    const honest = certCovScore(s) // against the original (pre-drop) list -> 0
    const g = groundJobSignals(s, jd)
    expect(g.signals.requiredCerts).toEqual(['az-104', 'ccna']) // originals kept, still counted unmet
    expect(g.droppedJd).toEqual([]) // no cert reported dropped, since none was removed
    expect(certCovScore(g.signals)).toBe(honest)
    expect(certCovScore(g.signals)).toBeLessThanOrEqual(honest) // never raised
    expect(certCovScore(g.signals)).not.toBe(80)
  })

  test('F-A regression: a JD that GENUINELY specified no required certs still gets the neutral 80', () => {
    const g = groundJobSignals(signals({ requiredCerts: [], heldCerts: [], adjacentCerts: [] }), JD)
    expect(g.signals.requiredCerts).toEqual([])
    expect(certCovScore(g.signals)).toBe(80) // legitimate empty-list neutral path, unchanged
  })

  test('F-B: a partial must-have drop does NOT raise skillsCoverage (one UNMET requirement paraphrased away)', () => {
    // JD requires kubernetes + terraform; candidate holds only kubernetes -> honest score 50. The JD
    // paraphrases "terraform" as "infrastructure automation", so the pre-F-B partial drop would have
    // shrunk the list to just kubernetes (1/1 = 100). F-B keeps terraform, so the score stays 50.
    const jd = 'We need Kubernetes and infrastructure automation experience.'
    const s = signals({ mustHaveSkills: ['kubernetes', 'terraform'], candidateSkills: ['kubernetes'], requiredCerts: [], heldCerts: [] })
    const honest = skillsCovScore(s) // full original list -> 50
    const g = groundJobSignals(s, jd)
    expect(g.signals.mustHaveSkills).toEqual(['kubernetes', 'terraform']) // terraform kept despite the paraphrase
    expect(skillsCovScore(g.signals)).toBe(honest)
    expect(skillsCovScore(g.signals)).toBeLessThanOrEqual(honest) // never raised
    expect(skillsCovScore(g.signals)).not.toBe(100)
  })

  test('F-B: a partial cert drop is NOT removed either (denominator preserved, certs score cannot rise)', () => {
    // 'az-104' is in the JD, 'ccna' is not; candidate holds only az-104 -> honest 50. Pre-F-B this
    // dropped ccna (1/1 = 100); now ccna is kept, so the score stays the honest 50.
    const jd = 'Requires AZ-104 and container orchestration experience.'
    const s = signals({ requiredCerts: ['az-104', 'ccna'], heldCerts: ['az-104'], adjacentCerts: [] })
    const honest = certCovScore(s)
    const g = groundJobSignals(s, jd)
    expect(g.signals.requiredCerts).toEqual(['az-104', 'ccna']) // ccna kept, not dropped
    expect(g.droppedJd).not.toContain('ccna')
    expect(certCovScore(g.signals)).toBe(honest)
    expect(certCovScore(g.signals)).not.toBe(100)
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
