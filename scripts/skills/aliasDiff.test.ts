import { describe, expect, test } from 'vitest'
import { canonicalize, aliasForms, ALIAS_GROUPS } from '@/lib/skillAliases'
import { makeAliasIndex, matchStatus, grounded, diffCase, runDiff, type DiffCase } from './aliasDiff'

describe('makeAliasIndex faithfulness (re-derivation matches production)', () => {
  const index = makeAliasIndex(ALIAS_GROUPS)
  const sample = ['Kubernetes', 'k8s', 'React', 'reactjs', 'MSSQL', 'SQL Server', 'Some Bespoke Tool', 'vSphere / ESXi']

  test('canonicalize matches lib/skillAliases.canonicalize on the full table', () => {
    for (const t of sample) expect(index.canonicalize(t), t).toBe(canonicalize(t))
  })
  test('aliasForms matches lib/skillAliases.aliasForms on the full table', () => {
    for (const t of sample) expect(index.aliasForms(t).sort(), t).toEqual(aliasForms(t).sort())
  })
})

describe('consumer semantics', () => {
  const index = makeAliasIndex([
    ['kubernetes', 'k8s'],
    ['reactjs', 'react', 'react.js'],
  ])
  test('matchStatus: match / partial / gap via canonicalize', () => {
    expect(matchStatus('ReactJS', ['React'], [], index)).toBe('match')
    expect(matchStatus('ReactJS', [], ['react.js'], index)).toBe('partial')
    expect(matchStatus('ReactJS', ['Angular'], [], index)).toBe('gap')
  })
  test('grounded: alias-aware over facts', () => {
    expect(grounded(['Built UIs in React'], 'ReactJS', index)).toBe(true)
    expect(grounded(['Built UIs in Angular'], 'ReactJS', index)).toBe(false)
  })
})

describe('diffCase (core vs full)', () => {
  const CORE = [['kubernetes', 'k8s']]
  const FULL = [['kubernetes', 'k8s'], ['reactjs', 'react', 'react.js']]
  const IMPORTED = [['reactjs', 'react', 'react.js']]
  const core = makeAliasIndex(CORE)
  const full = makeAliasIndex(FULL)

  test('flags a coverage/skillCoverage move toward match, naming the imported pair', () => {
    const recs = diffCase(
      { name: 'react case', required: ['ReactJS'], held: ['React'] },
      core,
      full,
      IMPORTED,
    )
    const coverage = recs.find((r) => r.consumer === 'coverage')
    expect(coverage).toMatchObject({ term: 'ReactJS', against: 'React', core: 'gap', full: 'match', direction: 'toward-match' })
    expect(coverage?.causedBy).toBe('reactjs / react / react.js')
    // both coverage and skillCoverage report it (identical canonicalize semantics)
    expect(recs.filter((r) => r.consumer === 'skillCoverage')).toHaveLength(1)
  })

  test('flags a grounding move toward grounded (the higher-risk consumer)', () => {
    const recs = diffCase(
      { name: 'react grounding', facts: ['Built dashboards in React'], groundTerms: ['ReactJS'] },
      core,
      full,
      IMPORTED,
    )
    expect(recs).toHaveLength(1)
    expect(recs[0]).toMatchObject({ consumer: 'grounding', term: 'ReactJS', core: 'false', full: 'true', direction: 'toward-match' })
  })

  test('no diff when the term is unrelated or already covered by core', () => {
    expect(diffCase({ name: 'unrelated', required: ['Angular'], held: ['React'] }, core, full, IMPORTED)).toEqual([])
    // Kubernetes/k8s is in BOTH tables, so no change.
    expect(diffCase({ name: 'core pair', required: ['Kubernetes'], held: ['K8s'] }, core, full, IMPORTED)).toEqual([])
  })

  test('detects the RISKY away-from-match direction (regression guard)', () => {
    // Reverse the tables: a pair present in core but absent in "full" would DROP a match. The harness
    // must classify this as away-from-match so a real imported-pair regression is never hidden.
    const recs = diffCase(
      { name: 'regression', required: ['ReactJS'], held: ['React'] },
      makeAliasIndex(FULL), // has the pair
      makeAliasIndex(CORE), // lacks it
      IMPORTED,
    )
    expect(recs[0]).toMatchObject({ core: 'match', full: 'gap', direction: 'away-from-match' })
  })
})

describe('runDiff summary', () => {
  test('counts toward-match, toward-grounded, and away-from-match', () => {
    const cases: DiffCase[] = [
      { name: 'match', required: ['ReactJS'], held: ['React'] },
      { name: 'ground', facts: ['Built in React'], groundTerms: ['ReactJS'] },
      { name: 'control', required: ['Kubernetes'], held: ['K8s'] },
    ]
    const CORE = [['kubernetes', 'k8s']]
    const FULL = [['kubernetes', 'k8s'], ['reactjs', 'react']]
    const r = runDiff(cases, CORE, FULL, [['reactjs', 'react']])
    expect(r.awayFromMatch).toBe(0)
    expect(r.towardGrounded).toBe(1)
    // coverage + skillCoverage for the match case, plus one grounding = 3 total; control adds none.
    expect(r.totalDiffs).toBe(3)
    expect(r.towardMatch).toBe(3)
  })
})
