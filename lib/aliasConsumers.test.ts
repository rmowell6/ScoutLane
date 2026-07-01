import { describe, expect, test } from 'vitest'
import { coverage } from './fit/fitScore'
import { skillCoverage } from './fit/fitPresent'
import { mentionsAny, normalize } from './guardrails'

// The three consumers of the alias table must agree on match vs no-match, or the packet contradicts
// itself (a fit score that credits a skill while the ATS table beside it, and the no-fabrication
// grounding, call it missing). This is exactly the drift that kicked off the whole alias effort
// (fitPresent.skillCoverage was not alias-aware). Pin agreement across an imported (non-core) sample.
const IMPORTED_PAIRS: [canonical: string, alias: string][] = [
  ['reactjs', 'react'],
  ['sql server', 'mssql'],
  ['apache kafka', 'kafka'],
  ['scikit-learn', 'sklearn'],
  ['c++', 'cpp'],
  ['salesforce', 'salesforce.com'],
]

// coverage(): a single required skill met by one held skill scores a full match.
const coverageMatches = (required: string, held: string) => coverage([required], [held], [], 80).full === 1
// mentionsAny(): the required term is grounded by a profile fact spelled the other way.
const groundingMatches = (required: string, held: string) => mentionsAny(normalize(held), required)
// skillCoverage(): the on-screen ATS row reads as a match.
const tableMatches = (required: string, held: string) => skillCoverage([required], [held])[0]?.status === 'match'

describe('alias-table consumers agree on imported pairs', () => {
  test.each(IMPORTED_PAIRS)('all three consumers MATCH "%s" against "%s"', (canonical, alias) => {
    // Both directions, since the JD term and the resume term can be either spelling.
    for (const [required, held] of [
      [canonical, alias],
      [alias, canonical],
    ] as const) {
      expect(coverageMatches(required, held), `coverage ${required}/${held}`).toBe(true)
      expect(groundingMatches(required, held), `mentionsAny ${required}/${held}`).toBe(true)
      expect(tableMatches(required, held), `skillCoverage ${required}/${held}`).toBe(true)
    }
  })

  test('all three consumers agree on NO-match for a genuinely different skill', () => {
    const required = 'reactjs'
    const held = 'angular' // not an alias of react
    expect(coverage([required], [held], [], 80).full).toBe(0)
    expect(mentionsAny(normalize(held), required)).toBe(false)
    expect(skillCoverage([required], [held])[0]?.status).toBe('gap')
  })
})
