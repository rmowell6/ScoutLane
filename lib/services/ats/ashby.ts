// Ashby public board API (no auth): api.ashbyhq.com/posting-api/job-board/<token>
// Request plain-text descriptions and listed-only postings.
import * as z from 'zod'
import { fetchJson } from './fetchJson'
import { htmlToText } from './html'
import type { AtsSource, IngestedJob } from './types'

// `id` is optional on purpose: a top-level string `id` is NOT guaranteed by the public posting-api
// (verified June 2026). If it were required, one id-less posting would throw on parse and drop the
// whole board — so we tolerate its absence and fall back to jobUrl for the unique key.
const AshbyJob = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  location: z.string().optional(),
  jobUrl: z.string().optional(),
  descriptionPlain: z.string().optional(),
  descriptionHtml: z.string().optional(),
  isListed: z.boolean().optional(),
})
const AshbyResponse = z.object({ jobs: z.array(AshbyJob).optional() })

export function ashbyUrl(token: string): string {
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true&listedOnly=true`
}

export async function fetchAshby(source: AtsSource): Promise<IngestedJob[]> {
  const raw = await fetchJson(ashbyUrl(source.token))
  const parsed = AshbyResponse.parse(raw)

  const jobs: IngestedJob[] = []
  for (const j of parsed.jobs ?? []) {
    if (j.isListed === false) continue // belt-and-suspenders with listedOnly=true on the query
    // jobUrl embeds the posting id, so it's a stable unique key when `id` is absent.
    const externalId = j.id ?? j.jobUrl
    if (!externalId) continue // no stable key -> skip rather than collide on an empty string
    jobs.push({
      provider: 'ashby',
      externalId,
      title: j.title?.trim() || 'Untitled role',
      company: source.company,
      location: j.location?.trim() || null,
      url: j.jobUrl ?? '',
      jdText: j.descriptionPlain?.trim() || (j.descriptionHtml ? htmlToText(j.descriptionHtml) : ''),
    })
  }
  return jobs
}
