// Greenhouse public board API (no auth): boards-api.greenhouse.io/v1/boards/<token>/jobs
// ?content=true returns each posting's HTML content inline.
import * as z from 'zod'
import { fetchJson } from './fetchJson'
import { htmlToText } from './html'
import type { AtsSource, IngestedJob } from './types'

// Lenient: only the fields we use, everything optional so a payload tweak doesn't break ingest.
const GreenhouseJob = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string().optional(),
  absolute_url: z.string().optional(),
  location: z.object({ name: z.string().optional() }).nullish(),
  content: z.string().optional(),
})
const GreenhouseResponse = z.object({ jobs: z.array(GreenhouseJob).optional() })

export function greenhouseUrl(token: string): string {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`
}

/** Parse a Greenhouse board payload into normalized jobs. Split out from the fetch so the orchestrator
 *  can reuse it on the conditional-GET (200) path without a second network call. */
export function parseGreenhouse(raw: unknown, source: AtsSource): IngestedJob[] {
  const parsed = GreenhouseResponse.parse(raw)
  return (parsed.jobs ?? []).map((j) => ({
    provider: 'greenhouse' as const,
    externalId: String(j.id),
    title: j.title?.trim() || 'Untitled role',
    company: source.company,
    location: j.location?.name?.trim() || null,
    url: j.absolute_url ?? '',
    jdText: j.content ? htmlToText(j.content) : '',
  }))
}

export async function fetchGreenhouse(source: AtsSource): Promise<IngestedJob[]> {
  return parseGreenhouse(await fetchJson(greenhouseUrl(source.token)), source)
}
