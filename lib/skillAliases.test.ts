import { describe, expect, test } from 'vitest'
import { ALIAS_GROUPS, ALIAS_TABLE_VERSION, aliasForms, canonicalize, computeAliasTableVersion } from './skillAliases'

describe('canonicalize', () => {
  test('collapses curated synonyms to a shared canonical form', () => {
    expect(canonicalize('K8s')).toBe(canonicalize('Kubernetes'))
    expect(canonicalize('AWS')).toBe(canonicalize('Amazon Web Services'))
    expect(canonicalize('IaC')).toBe(canonicalize('infrastructure as code'))
    expect(canonicalize('Postgres')).toBe(canonicalize('PostgreSQL'))
  })

  test('is case- and dash-insensitive for the same term (via normalize)', () => {
    expect(canonicalize('AZ-104')).toBe(canonicalize('az 104'))
  })

  test('does NOT collide genuinely different skills (no false canonical merge)', () => {
    expect(canonicalize('Kubernetes')).not.toBe(canonicalize('Docker'))
    expect(canonicalize('AWS')).not.toBe(canonicalize('GCP'))
  })

  test('is purely additive: an unknown term returns its normalized self unchanged', () => {
    expect(canonicalize('Some Bespoke Tool')).toBe('some bespoke tool')
    expect(canonicalize('Docker Swarm')).toBe('docker swarm')
  })

  test('unifies VMware vSphere / ESXi spellings (a JD "VMware ESXi" matches a "vSphere / ESXi" resume)', () => {
    expect(canonicalize('VMware ESXi')).toBe(canonicalize('vSphere / ESXi'))
    expect(canonicalize('ESXi')).toBe(canonicalize('vSphere'))
    expect(canonicalize('VMware vSphere/ESXi')).toBe(canonicalize('vmware esxi'))
    // Deliberately left ambiguous: generic "virtualization" and bare "VMware" are NOT merged in.
    expect(canonicalize('virtualization')).not.toBe(canonicalize('VMware ESXi'))
    expect(canonicalize('VMware')).not.toBe(canonicalize('VMware ESXi'))
  })
})

describe('aliasForms', () => {
  test('returns every equivalent surface form for a known term', () => {
    expect(aliasForms('Kubernetes').sort()).toEqual(['k8s', 'kubernetes'])
    expect(aliasForms('k8s').sort()).toEqual(['k8s', 'kubernetes'])
  })

  test('returns a single normalized element for an unknown term', () => {
    expect(aliasForms('Docker')).toEqual(['docker'])
  })

  test('exposes an imported spelling group (React)', () => {
    expect(aliasForms('reactjs').sort()).toEqual(['react', 'react.js', 'reactjs'])
  })
})

describe('imported alias groups (O*NET / Stack Exchange, Phase 3)', () => {
  test('collapses a representative sample of the approved import spellings', () => {
    expect(canonicalize('React')).toBe(canonicalize('reactjs'))
    expect(canonicalize('react.js')).toBe(canonicalize('React'))
    expect(canonicalize('Vue.js')).toBe(canonicalize('vuejs'))
    expect(canonicalize('nextjs')).toBe(canonicalize('Next.js'))
    expect(canonicalize('MSSQL')).toBe(canonicalize('SQL Server'))
    expect(canonicalize('sklearn')).toBe(canonicalize('scikit-learn'))
    expect(canonicalize('Kafka')).toBe(canonicalize('Apache Kafka'))
    expect(canonicalize('salesforce.com')).toBe(canonicalize('Salesforce'))
    expect(canonicalize('cpp')).toBe(canonicalize('C++'))
  })

  test('imported groups stay distinct from each other and from core (no false merges)', () => {
    expect(canonicalize('React')).not.toBe(canonicalize('Vue.js'))
    expect(canonicalize('Kafka')).not.toBe(canonicalize('Hadoop'))
    expect(canonicalize('React')).not.toBe(canonicalize('Kubernetes')) // vs a core group
  })
})

// Finding 6: the fit score reads the alias table through canonicalize(), so the "identical input ->
// identical output" contract is only true for a fixed table. ALIAS_TABLE_VERSION is a content-addressed
// marker (auto-derived, can't be forgotten) that changes whenever ALIAS_GROUPS' contents change, so a
// score's basis is attributable across a future table update.
describe('ALIAS_TABLE_VERSION (content-addressed table identity)', () => {
  test('is exported as a non-empty string equal to the hash of the live table', () => {
    expect(typeof ALIAS_TABLE_VERSION).toBe('string')
    expect(ALIAS_TABLE_VERSION.length).toBeGreaterThan(0)
    expect(ALIAS_TABLE_VERSION).toBe(computeAliasTableVersion(ALIAS_GROUPS))
  })

  test('is stable: hashing the same contents always yields the same version', () => {
    expect(computeAliasTableVersion(ALIAS_GROUPS)).toBe(computeAliasTableVersion(ALIAS_GROUPS))
    expect(computeAliasTableVersion([['a', 'b']])).toBe(computeAliasTableVersion([['a', 'b']]))
  })

  test('CHANGES when the table contents change (a member, a group, or its order)', () => {
    const base = [['kubernetes', 'k8s'], ['aws', 'amazon web services']]
    // A changed member form.
    expect(computeAliasTableVersion(base)).not.toBe(computeAliasTableVersion([['kubernetes', 'k8s'], ['aws', 'amzn']]))
    // An added group (what the refresh pipeline does).
    expect(computeAliasTableVersion(base)).not.toBe(computeAliasTableVersion([...base, ['typescript', 'ts']]))
    // A reordered group (canonical is the first element, so order is significant).
    expect(computeAliasTableVersion([['k8s', 'kubernetes']])).not.toBe(computeAliasTableVersion([['kubernetes', 'k8s']]))
  })
})

describe('alias table integrity', () => {
  test('no term maps to two different canonical forms (groups consistent + mutually exclusive)', () => {
    const canonOf = ALIAS_GROUPS.map((g) => canonicalize(g[0] as string))
    // Every member of a group canonicalizes to that group's canonical.
    ALIAS_GROUPS.forEach((g, i) => g.forEach((form) => expect(canonicalize(form)).toBe(canonOf[i])))
    // Distinct groups have distinct canonicals (no two groups collapse to the same form).
    expect(new Set(canonOf).size).toBe(canonOf.length)
  })
})
