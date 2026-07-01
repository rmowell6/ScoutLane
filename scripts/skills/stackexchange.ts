// Stack Exchange tag-synonym fetcher (Phase 1, RAW CANDIDATES ONLY). For a bounded seed list of tags
// (see seedTags.ts) we ask the Stack Overflow API for each tag's synonyms, e.g. "k8s" -> "kubernetes".
// Verified endpoint shape (api.stackexchange.com 2.3):
//   GET /2.3/tags/{tags}/synonyms?site=stackoverflow  -> items[{ from_tag, to_tag, applied_count }]
//   GET /2.3/tags/{tags}/info?site=stackoverflow       -> items[{ name, count }]   (count = # questions)
// {tags} is a semicolon-delimited vector (batched to stay well under the API's 100-tag limit and URL
// length). Responses can carry a `backoff` (seconds) we must honor, and `has_more` for paging.
//
// The HTTP call is injected (FetchLike) so tests mock it, no live network in CI.

const BASE = 'https://api.stackexchange.com/2.3'
const SITE = 'stackoverflow'
// The /synonyms endpoint rejects (HTTP 400) tag vectors larger than ~20 (stricter than /info's 100),
// verified empirically against the live API. 20 keeps every batch under that ceiling.
const BATCH_SIZE = 20
const PER_CALL_DELAY_MS = 250

/** Minimal shape of the fetch we need, so tests can pass a lightweight mock (global `fetch` satisfies it). */
export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

export interface SynonymCandidate {
  source: 'stackexchange'
  /** The synonym / alias tag (e.g. "k8s"). */
  fromTag: string
  /** The canonical tag it redirects to (e.g. "kubernetes"). */
  toTag: string
  /** How many times the synonym has been applied (popularity of the alias itself). */
  appliedCount: number
  /** Number of questions for the canonical tag, for reviewer context (null if not fetched). */
  questionCount: number | null
}

interface SynonymApiItem { from_tag: string; to_tag: string; applied_count: number }
interface SynonymsResponse { items?: SynonymApiItem[]; has_more?: boolean; backoff?: number }
interface TagInfoItem { name: string; count: number }
interface TagInfoResponse { items?: TagInfoItem[]; backoff?: number }

const sleepDefault = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function tagVector(tags: string[]): string {
  return tags.map(encodeURIComponent).join(';')
}

async function seGet<T>(path: string, params: Record<string, string>, fetchImpl: FetchLike): Promise<T> {
  const qs = new URLSearchParams({ site: SITE, ...params }).toString()
  const res = await fetchImpl(`${BASE}${path}?${qs}`)
  if (!res.ok) throw new Error(`Stack Exchange request failed: ${path} (HTTP ${res.status})`)
  return (await res.json()) as T
}

export interface CollectOptions {
  fetchImpl?: FetchLike
  sleep?: (ms: number) => Promise<void>
}

/** Question count per seed tag (canonical popularity), keyed by tag name. Best-effort context. */
async function fetchTagQuestionCounts(seed: string[], fetchImpl: FetchLike, sleep: (ms: number) => Promise<void>): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  for (const batch of chunk(seed, BATCH_SIZE)) {
    const json = await seGet<TagInfoResponse>(`/tags/${tagVector(batch)}/info`, {}, fetchImpl)
    for (const it of json.items ?? []) counts.set(it.name, it.count)
    if (json.backoff) await sleep(json.backoff * 1000)
    await sleep(PER_CALL_DELAY_MS)
  }
  return counts
}

/**
 * Fetch synonyms for the seed tags and return raw candidate pairs. Batches the tag vector, pages
 * through `has_more`, honors `backoff`, and attaches each canonical tag's question count for context.
 */
export async function collectStackExchangeCandidates(seed: string[], opts: CollectOptions = {}): Promise<SynonymCandidate[]> {
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike)
  const sleep = opts.sleep ?? sleepDefault

  const questionCounts = await fetchTagQuestionCounts(seed, fetchImpl, sleep)
  const candidates: SynonymCandidate[] = []

  for (const batch of chunk(seed, BATCH_SIZE)) {
    let page = 1
    let hasMore = true
    while (hasMore) {
      const json = await seGet<SynonymsResponse>(
        `/tags/${tagVector(batch)}/synonyms`,
        { pagesize: '100', page: String(page) },
        fetchImpl,
      )
      for (const it of json.items ?? []) {
        candidates.push({
          source: 'stackexchange',
          fromTag: it.from_tag,
          toTag: it.to_tag,
          appliedCount: it.applied_count,
          questionCount: questionCounts.get(it.to_tag) ?? null,
        })
      }
      if (json.backoff) await sleep(json.backoff * 1000)
      hasMore = Boolean(json.has_more)
      if (hasMore) {
        page++
        await sleep(PER_CALL_DELAY_MS)
      }
    }
    await sleep(PER_CALL_DELAY_MS)
  }
  return candidates
}
