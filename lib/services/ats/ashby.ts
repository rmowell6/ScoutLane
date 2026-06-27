// Ashby public board API (no auth): api.ashbyhq.com/posting-api/job-board/<token>
// Request plain-text descriptions so we don't have to strip HTML.
import * as z from 'zod'
import { fetchJson } from './fetchJson'
import { htmlToText } from './html'
import type { AtsSource, IngestedJob } from './types'

const AshbyJob = z.object({
  id: z.string(),
  title: z.string().optional(),
  location: z.string().optional(),
  jobUrl: z.string().optional(),
  descriptionPlain: z.string().optional(),
  descriptionHtml: z.string().optional(),
})
const AshbyResponse = z.object({ jobs: z.array(AshbyJob).optional() })

export function ashbyUrl(token: string): string {
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`
}

export async function fetchAshby(source: AtsSource): Promise<IngestedJob[]> {
  const raw = await fetchJson(ashbyUrl(source.token))
  const parsed = AshbyResponse.parse(raw)
  return (parsed.jobs ?? []).map((j) => ({
    provider: 'ashby' as const,
    externalId: j.id,
    title: j.title?.trim() || 'Untitled role',
    company: source.company,
    location: j.location?.trim() || null,
    url: j.jobUrl ?? '',
    jdText: j.descriptionPlain?.trim() || (j.descriptionHtml ? htmlToText(j.descriptionHtml) : ''),
  }))
}
