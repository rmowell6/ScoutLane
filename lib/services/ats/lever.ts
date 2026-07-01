// Lever public postings API (no auth): api.lever.co/v0/postings/<company>?mode=json
// returns a flat array. JD text is assembled from descriptionPlain + list sections + additional.
import * as z from 'zod'
import { fetchJson } from './fetchJson'
import { htmlToText } from './html'
import type { AtsSource, IngestedJob } from './types'

const LeverList = z.object({ text: z.string().optional(), content: z.string().optional() })
const LeverPosting = z.object({
  id: z.string(),
  text: z.string().optional(), // the role title
  hostedUrl: z.string().optional(),
  categories: z
    .object({ location: z.string().optional(), team: z.string().optional() })
    .nullish(),
  descriptionPlain: z.string().optional(),
  description: z.string().optional(), // HTML fallback
  lists: z.array(LeverList).optional(),
  additionalPlain: z.string().optional(),
  additional: z.string().optional(), // HTML fallback
})
const LeverResponse = z.array(LeverPosting)

export function leverUrl(company: string): string {
  return `https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`
}

function assembleJd(p: z.infer<typeof LeverPosting>): string {
  const parts: string[] = []
  parts.push(p.descriptionPlain ?? (p.description ? htmlToText(p.description) : ''))
  for (const list of p.lists ?? []) {
    if (list.text) parts.push(`\n${list.text}:`)
    if (list.content) parts.push(htmlToText(list.content))
  }
  parts.push(p.additionalPlain ?? (p.additional ? htmlToText(p.additional) : ''))
  return parts.filter((s) => s.trim().length > 0).join('\n').trim()
}

/** Parse a Lever postings payload into normalized jobs. Split out from the fetch so the orchestrator
 *  can reuse it on the conditional-GET (200) path without a second network call. */
export function parseLever(raw: unknown, source: AtsSource): IngestedJob[] {
  const postings = LeverResponse.parse(raw)
  return postings.map((p) => ({
    provider: 'lever' as const,
    externalId: p.id,
    title: p.text?.trim() || 'Untitled role',
    company: source.company,
    location: p.categories?.location?.trim() || null,
    url: p.hostedUrl ?? '',
    jdText: assembleJd(p),
  }))
}

export async function fetchLever(source: AtsSource): Promise<IngestedJob[]> {
  return parseLever(await fetchJson(leverUrl(source.token)), source)
}
