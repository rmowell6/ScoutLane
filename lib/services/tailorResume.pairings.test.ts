import { describe, expect, test } from 'vitest'
import { allowedAliasPairings } from './tailorResume'
import type { JobReqs, Profile } from '@/lib/schemas'

// Finding 5: the tailor prompt used to ask the model to recognize "well-known equivalent" spellings
// itself, but the model cannot see the curated alias table, so it sometimes attempted a pairing the
// table rejects (e.g. "TypeScript (TS)", where "TS" is deliberately excluded, it collides with TS/SCI
// clearances). The guardrail correctly rejected it (fail-closed), but the SAME input was then blocked
// or not depending on whether the model happened to try the pairing on a given run. The fix computes
// the exact closed set of pairings the guardrail accepts for this packet and hands ONLY that to the
// model, so a disallowed pairing is never offered (deterministic), not merely "usually" rejected.

const mkProfile = (over: Partial<Profile> = {}): Profile => ({
  name: 'Ada Lovelace',
  summary: 'Infrastructure engineer.',
  skills: ['Azure'],
  roles: [{ company: 'Analytical Engines', title: 'Platform Engineer', startDate: '2020', endDate: null, bullets: ['Migrated 40 VMs to Azure'] }],
  certs: [],
  education: [],
  ...over,
})

const mkJob = (over: Partial<JobReqs> = {}): JobReqs => ({
  title: 'Platform Engineer',
  company: 'Acme',
  mustHave: [],
  niceToHave: [],
  ...over,
})

describe('allowedAliasPairings (finding 5: closed, table-derived pairing set)', () => {
  test('DETERMINISM: a famous-but-uncurated pairing (TypeScript/TS) is never offered, across repeated calls', () => {
    const profile = mkProfile({ skills: ['TypeScript'] })
    // The JD phrases the same skill both ways; only the curated table decides what is pairable, and TS
    // is not in it. Running the exact same input many times must ALWAYS yield the same empty result,
    // standing in for repeated model attempts (the model can only ever choose from this list).
    const job = mkJob({ mustHave: ['TypeScript', 'TS'], niceToHave: ['TS'] })
    for (let i = 0; i < 25; i++) {
      expect(allowedAliasPairings(profile, job)).toEqual([])
    }
  })

  test('REGRESSION: a legitimate, table-backed pairing (Kubernetes/K8s) is still surfaced', () => {
    const profile = mkProfile({ skills: ['K8s'] })
    const job = mkJob({ mustHave: ['Kubernetes'] })
    expect(allowedAliasPairings(profile, job)).toEqual(['Kubernetes (K8s)'])
  })

  test('surfaces the pairing regardless of which side is nice-to-have vs must-have', () => {
    const profile = mkProfile({ skills: ['K8s', 'Azure'] })
    const job = mkJob({ mustHave: ['Amazon Web Services'], niceToHave: ['Kubernetes'] })
    // No AWS held, so no AWS pairing; K8s held and Kubernetes wanted, so exactly one pairing.
    expect(allowedAliasPairings(profile, job)).toEqual(['Kubernetes (K8s)'])
  })

  test('offers no pairing when the JD term matches the fact spelling exactly (none needed)', () => {
    const profile = mkProfile({ skills: ['Kubernetes'] })
    const job = mkJob({ mustHave: ['Kubernetes'] })
    expect(allowedAliasPairings(profile, job)).toEqual([])
  })

  test('offers no pairing for a skill the candidate does not hold', () => {
    const profile = mkProfile({ skills: ['Azure'] })
    const job = mkJob({ mustHave: ['Kubernetes'] })
    expect(allowedAliasPairings(profile, job)).toEqual([])
  })

  test('does not pair different technologies (Kubernetes vs Docker are not curated aliases)', () => {
    const profile = mkProfile({ skills: ['Docker'] })
    const job = mkJob({ mustHave: ['Kubernetes'] })
    expect(allowedAliasPairings(profile, job)).toEqual([])
  })
})
