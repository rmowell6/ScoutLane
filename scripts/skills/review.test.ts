import { describe, expect, test } from 'vitest'
import {
  isCollisionTerm,
  isCommonEnglishWord,
  isTooShort,
  reviewCandidate,
  reviewAll,
  type Candidate,
} from './review'
import type { OnetCandidate } from './onet'
import type { SynonymCandidate } from './stackexchange'

// Builders so each case states only the fields the heuristic reads.
const se = (fromTag: string, toTag: string): SynonymCandidate => ({
  source: 'stackexchange',
  fromTag,
  toTag,
  appliedCount: 10,
  questionCount: 1000,
})
const onet = (full: string, acronym: string, confidence: OnetCandidate['confidence']): OnetCandidate => ({
  source: 'onet',
  full,
  acronym,
  confidence,
  needsScrutiny: confidence === 'initials-substring',
  workplaceExample: `${full} ${acronym}`,
  elementName: 'Some software',
  hotTechnology: false,
  inDemand: false,
})

describe('isCollisionTerm', () => {
  test('flags the skillAliases exclusions and analogues, case-insensitively', () => {
    for (const t of ['ts', 'Go', 'NODE', 'golang', 'r', 'es']) expect(isCollisionTerm(t), t).toBe(true)
  })
  test('does not flag genuine multi-char skills', () => {
    for (const t of ['kubernetes', 'terraform', 'postgresql']) expect(isCollisionTerm(t), t).toBe(false)
  })
})

describe('isCommonEnglishWord', () => {
  test('flags everyday words (incl. tech-colliding ones) but not real product names', () => {
    for (const t of ['for', 'the', 'go', 'node', 'data']) expect(isCommonEnglishWord(t), t).toBe(true)
    // Real names that happen to be words are intentionally NOT auto-rejected here.
    for (const t of ['spark', 'rust', 'swift', 'spring', 'kubernetes']) expect(isCommonEnglishWord(t), t).toBe(false)
  })
})

describe('isTooShort', () => {
  test('true under 3 chars', () => {
    expect(isTooShort('go')).toBe(true)
    expect(isTooShort('HR')).toBe(true)
    expect(isTooShort('aws')).toBe(false)
  })
})

describe('reviewCandidate', () => {
  test('REGRESSION: a legitimately mod-curated "golang" -> "go" pair still rejects on collision grounds', () => {
    const r = reviewCandidate(se('golang', 'go'))
    expect(r.recommendation).toBe('reject')
    expect(r.reason).toMatch(/collision-prone/i)
    expect(r.reason).toMatch(/go/i)
  })

  test('a clean Stack Exchange pair is approved (mod-curated + passes collision checks)', () => {
    const r = reviewCandidate(se('k8s', 'kubernetes'))
    expect(r.recommendation).toBe('approve')
  })

  test('a Stack Exchange pair with a sub-3-char term rejects on length', () => {
    const r = reviewCandidate(se('reactjs', 'rx')) // "rx" is 2 chars
    expect(r.recommendation).toBe('reject')
    expect(r.reason).toMatch(/under 3 characters/i)
  })

  test('O*NET parenthetical / initials-exact are auto-approved (near-identical to one product name)', () => {
    expect(reviewCandidate(onet('Human resource information system', 'HRIS', 'parenthetical')).recommendation).toBe('approve')
    expect(reviewCandidate(onet('A mathematical programming language', 'AMPL', 'initials-exact')).recommendation).toBe('approve')
  })

  test('O*NET initials-substring defaults to needs-human-judgment, never auto-approve', () => {
    const r = reviewCandidate(onet('Some Product Xyz', 'SPX', 'initials-substring'))
    expect(r.recommendation).toBe('needs-human-judgment')
    expect(r.reason).toMatch(/same product/i)
  })

  test('collision check beats the source default (O*NET acronym on the collision list rejects)', () => {
    // Even a parenthetical O*NET pair rejects if a term collides.
    const r = reviewCandidate(onet('Some Elasticsearch Thing', 'ES', 'parenthetical'))
    expect(r.recommendation).toBe('reject')
  })
})

describe('reviewAll (sorting)', () => {
  test('needs-human-judgment and reject sort ahead of approve', () => {
    const candidates: Candidate[] = [
      se('k8s', 'kubernetes'), // approve
      se('golang', 'go'), // reject
      onet('Some Product Xyz', 'SPX', 'initials-substring'), // needs-human-judgment
    ]
    const order = reviewAll(candidates).map((r) => r.recommendation)
    expect(order[0]).toBe('needs-human-judgment')
    expect(order[1]).toBe('reject')
    expect(order[2]).toBe('approve')
  })
})
