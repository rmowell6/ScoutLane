import { describe, expect, test } from 'vitest'
import { aliasForms, canonicalize } from './skillAliases'

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
    expect(canonicalize('vsphere/esxi')).toBe('vsphere/esxi')
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
})
