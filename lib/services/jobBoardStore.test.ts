import { describe, expect, test } from 'vitest'
import { toJobBoardRow, dedupeRows, type JobBoardRow } from './jobBoardStore'
import type { Job } from '@/src/jobBoards/types'

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'jsearch:abc123',
    source: 'jsearch',
    title: 'Cloud Engineer',
    company: 'Acme',
    location: 'Austin, TX',
    remote: false,
    type: 'full-time',
    description: 'Build cloud things.',
    tags: ['azure'],
    url: 'https://x/jobs/1',
    postedAt: new Date('2026-06-01T00:00:00Z'),
    ...overrides,
  }
}

const NOW = '2026-06-28T00:00:00Z'

describe('toJobBoardRow', () => {
  test('maps a Job to the shared row shape, splitting id into source + external_id', () => {
    const row = toJobBoardRow(job(), NOW)
    expect(row).toEqual<JobBoardRow>({
      source: 'jsearch',
      external_id: 'abc123',
      title: 'Cloud Engineer',
      company: 'Acme',
      location: 'Austin, TX',
      url: 'https://x/jobs/1',
      jd_raw: 'Build cloud things.',
      status: 'live',
      validated_at: NOW,
    })
  })

  test('keeps everything after the FIRST colon as external_id (ids can contain colons)', () => {
    const row = toJobBoardRow(job({ id: 'remoteok:https://r.ok/jobs/9:42' }), NOW)
    expect(row.external_id).toBe('https://r.ok/jobs/9:42')
  })

  test('falls back to the whole id when there is no colon', () => {
    expect(toJobBoardRow(job({ id: 'plainid' }), NOW).external_id).toBe('plainid')
  })

  test('coerces blank/whitespace location to null', () => {
    expect(toJobBoardRow(job({ location: '   ' }), NOW).location).toBeNull()
    expect(toJobBoardRow(job({ location: ' Remote ' }), NOW).location).toBe('Remote')
  })

  test('caps an oversized description', () => {
    const row = toJobBoardRow(job({ description: 'x'.repeat(80_000) }), NOW)
    expect(row.jd_raw.length).toBe(60_000)
  })
})

describe('dedupeRows', () => {
  test('collapses rows sharing (source, external_id), keeping the last', () => {
    const a = toJobBoardRow(job({ id: 'jsearch:1', title: 'First' }), NOW)
    const b = toJobBoardRow(job({ id: 'jsearch:1', title: 'Second' }), NOW)
    const c = toJobBoardRow(job({ id: 'adzuna:1', source: 'adzuna' }), NOW)
    const out = dedupeRows([a, b, c])
    expect(out).toHaveLength(2)
    expect(out.find((r) => r.source === 'jsearch' && r.external_id === '1')?.title).toBe('Second')
  })
})
