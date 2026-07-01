import { describe, expect, test } from 'vitest'
import {
  compareVersions,
  parseLatestVersion,
  detectLatestVersion,
  diffManifest,
  trimSoftwareSkills,
  parseTsv,
  runSync,
  type OnetManifest,
  type FetchLike,
} from './onetSync'
import type { OnetCandidate } from './onet'

const onet = (full: string, acronym: string, confidence: OnetCandidate['confidence'] = 'parenthetical'): OnetCandidate => ({
  source: 'onet',
  full,
  acronym,
  confidence,
  needsScrutiny: confidence === 'initials-substring',
  workplaceExample: `${full} (${acronym})`,
  elementName: 'Some software',
  hotTechnology: false,
  inDemand: false,
})

describe('compareVersions', () => {
  test('orders O*NET version strings numerically', () => {
    expect(compareVersions('30.3', '30.2')).toBe(1)
    expect(compareVersions('30.3', '30.3')).toBe(0)
    expect(compareVersions('29.3', '30.0')).toBe(-1)
    expect(compareVersions('30.10', '30.9')).toBe(1) // numeric, not lexical
  })
})

describe('parseLatestVersion', () => {
  test('picks the max version from db_<M>_<m>_ download links', () => {
    const html = 'a <a href="/dl_files/database/db_30_2_text/x">30.2</a> b <a href="/db_30_3_excel/y">30.3</a> <a href="db_29_3_text/z">'
    expect(parseLatestVersion(html)).toBe('30.3')
  })
  test('falls back to explicit version tokens when no download links are present', () => {
    expect(parseLatestVersion('Current release: Version 30.3 (May 2026)')).toBe('30.3')
  })
  test('returns null when no plausible version is found', () => {
    expect(parseLatestVersion('no versions here, just 3.1 unrelated')).toBeNull()
  })
})

describe('detectLatestVersion (mocked fetch)', () => {
  const releasesHtml = (v: string) => `<a href="/dl_files/database/db_${v.replace('.', '_')}_text/">${v}</a>`

  test('NO new release: detected equals the recorded version', async () => {
    const fetchImpl: FetchLike = async () => ({ ok: true, status: 200, text: async () => releasesHtml('30.3') })
    expect(await detectLatestVersion(fetchImpl)).toBe('30.3')
  })
  test('NEW release available: detects the newer version', async () => {
    const fetchImpl: FetchLike = async () => ({ ok: true, status: 200, text: async () => releasesHtml('30.4') })
    expect(await detectLatestVersion(fetchImpl)).toBe('30.4')
  })
  test('throws on a non-ok releases page', async () => {
    const fetchImpl: FetchLike = async () => ({ ok: false, status: 503, text: async () => '' })
    await expect(detectLatestVersion(fetchImpl)).rejects.toThrow(/HTTP 503/)
  })
})

describe('diffManifest', () => {
  const manifest: OnetManifest = {
    onetVersion: '30.3',
    entries: [
      { key: 'human resource information system|hris', full: 'Human resource information system', acronym: 'HRIS', confidence: 'parenthetical', firstSeenVersion: '30.3', lastConfirmedVersion: '30.3' },
      { key: 'old product|op', full: 'Old Product', acronym: 'OP', confidence: 'parenthetical', firstSeenVersion: '30.2', lastConfirmedVersion: '30.3' },
    ],
  }

  test('separates NEW candidates from STALE entries and advances the manifest', () => {
    const fresh = [onet('Human resource information system', 'HRIS'), onet('New Widget Platform', 'NWP')] // HRIS still present, OP gone, NWP new
    const { newCandidates, staleEntries, updatedManifest } = diffManifest(manifest, fresh, '30.4')

    expect(newCandidates.map((c) => c.acronym)).toEqual(['NWP'])
    expect(staleEntries.map((e) => e.acronym)).toEqual(['OP'])
    expect(updatedManifest.onetVersion).toBe('30.4')

    const hris = updatedManifest.entries.find((e) => e.acronym === 'HRIS')!
    expect(hris.lastConfirmedVersion).toBe('30.4') // still confirmed -> bumped
    const op = updatedManifest.entries.find((e) => e.acronym === 'OP')!
    expect(op.lastConfirmedVersion).toBe('30.3') // stale -> retained, NOT removed, NOT bumped
    const nwp = updatedManifest.entries.find((e) => e.acronym === 'NWP')!
    expect(nwp).toMatchObject({ firstSeenVersion: '30.4', lastConfirmedVersion: '30.4' })
  })
})

describe('trimSoftwareSkills + parseTsv', () => {
  test('parses tab-delimited rows and trims to the committed 4-column shape, deduped', () => {
    const tsv = [
      'O*NET-SOC Code\tTitle\tExample\tCommodity Code\tCommodity Title\tHot Technology\tIn Demand',
      '15-1252.00\tSoftware Devs\tHuman resource information system (HRIS)\t43232408\tHuman resources software\tN\tN',
      '11-3021.00\tManagers\tHuman resource information system (HRIS)\t43232408\tHuman resources software\tN\tN', // dup Example -> collapsed
      '15-1252.00\tSoftware Devs\tWidget Manager (WM)\t43232000\tProject management software\tY\tN',
    ].join('\n')
    const trimmed = trimSoftwareSkills(parseTsv(tsv))
    expect(trimmed).toEqual([
      { 'Workplace Example': 'Human resource information system (HRIS)', 'Element Name': 'Human resources software', 'Hot Technology': 'N', 'In Demand': 'N' },
      { 'Workplace Example': 'Widget Manager (WM)', 'Element Name': 'Project management software', 'Hot Technology': 'Y', 'In Demand': 'N' },
    ])
  })
})

describe('runSync (mocked fetch, end to end)', () => {
  const manifest: OnetManifest = {
    onetVersion: '30.3',
    entries: [{ key: 'human resource information system|hris', full: 'Human resource information system', acronym: 'HRIS', confidence: 'parenthetical', firstSeenVersion: '30.3', lastConfirmedVersion: '30.3' }],
  }
  const softwareTsv = [
    'O*NET-SOC Code\tTitle\tExample\tCommodity Code\tCommodity Title\tHot Technology\tIn Demand',
    '15-1252.00\tSoftware Devs\tHuman resource information system (HRIS)\t43232408\tHuman resources software\tN\tN',
    '15-1252.00\tSoftware Devs\tWidget Manager Platform (WMP)\t43232000\tProject management software\tN\tN', // NEW parenthetical candidate
  ].join('\n')

  const mockFetch = (version: string): FetchLike => async (url) => {
    if (url.includes('db_releases')) return { ok: true, status: 200, text: async () => `<a href="/dl_files/database/db_${version.replace('.', '_')}_text/">${version}</a>` }
    return { ok: true, status: 200, text: async () => softwareTsv } // the Software Skills file
  }

  test('NO new release: reports no change and never fetches the skills file', async () => {
    let skillsFetched = false
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes('Software')) skillsFetched = true
      return { ok: true, status: 200, text: async () => '<a href="/db_30_3_text/">30.3</a>' }
    }
    const r = await runSync(manifest, fetchImpl)
    expect(r.changed).toBe(false)
    expect(r.detectedVersion).toBe('30.3')
    expect(skillsFetched).toBe(false)
  })

  test('NEW release: re-extracts, diffs, and produces the PR body content', async () => {
    const r = await runSync(manifest, mockFetch('30.4'))
    expect(r.changed).toBe(true)
    expect(r.detectedVersion).toBe('30.4')
    expect(r.newCandidates.map((c) => c.acronym)).toEqual(['WMP'])
    expect(r.updatedManifest?.onetVersion).toBe('30.4')
    // HRIS still present -> confirmed at 30.4; WMP added.
    expect(r.updatedManifest?.entries.find((e) => e.acronym === 'HRIS')?.lastConfirmedVersion).toBe('30.4')
    // PR body states the bump and the do-not-auto-merge rule.
    expect(r.prBody).toContain('O*NET 30.3 to 30.4')
    expect(r.prBody).toContain('Do not auto-merge')
    expect(r.prBody).toContain('lib/skillAliases.ts')
  })
})
