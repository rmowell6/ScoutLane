// Largest ATS response we'll buffer. A big board page is a few MB; 25 MB is a generous ceiling
// that still stops a hostile or misbehaving endpoint from exhausting memory on the ingest worker.
const MAX_BYTES = 25 * 1024 * 1024

/** The stored HTTP validators for a feed, sent back as conditional-GET request headers. */
export interface ConditionalHeaders {
  etag?: string | null
  lastModified?: string | null
}

/** A 304 (board unchanged, no body) or a 200 with the parsed body plus the fresh validators to store
 *  for next time. Lets a caller skip parse/upsert entirely when nothing changed. */
export type ConditionalFetchResult =
  | { status: 'not-modified' }
  | { status: 'ok'; data: unknown; etag: string | null; lastModified: string | null }

// Shared JSON fetch for ATS public APIs: bounded by a timeout AND a response-size cap, with a
// clear error on non-2xx so a blocked domain or a bad board token surfaces as a readable message
// (not a silent empty). The body is streamed and aborted the moment it exceeds the byte cap, so a
// bogus Content-Length can't sneak an oversized payload past us.
export async function fetchJson(url: string, timeoutMs = 10_000, maxBytes = MAX_BYTES): Promise<unknown> {
  // No conditional headers, so a well-behaved server cannot answer 304; treat one as an error.
  const result = await fetchJsonConditional(url, {}, timeoutMs, maxBytes)
  if (result.status === 'not-modified') throw new Error(`unexpected 304 from ${url}`)
  return result.data
}

/**
 * Conditional variant of fetchJson: sends If-None-Match / If-Modified-Since from the stored
 * validators so an unchanged board answers 304 and we skip the whole download+parse. On a 200 it
 * returns the parsed body plus the response's ETag / Last-Modified to persist for next run. Same
 * timeout, redirect:'error' (SSRF), and streamed byte-cap protections as fetchJson.
 */
export async function fetchJsonConditional(
  url: string,
  conditional: ConditionalHeaders = {},
  timeoutMs = 10_000,
  maxBytes = MAX_BYTES,
): Promise<ConditionalFetchResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    // A descriptive UA is good practice for public APIs (some reject the default fetch agent).
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': 'ScoutLane/1.0 (+job-pool ingest)',
    }
    // Only send validators we actually hold; an absent one just means an unconditional GET.
    if (conditional.etag) headers['if-none-match'] = conditional.etag
    if (conditional.lastModified) headers['if-modified-since'] = conditional.lastModified

    const res = await fetch(url, {
      signal: controller.signal,
      // Fail on a redirect rather than following it: the URL is provider config, but an open redirect
      // on a board host could otherwise bounce this server-side fetch at an internal/metadata address
      // (SSRF). We only call documented ATS JSON endpoints, which don't legitimately 3xx.
      redirect: 'error',
      headers,
    })

    // 304 Not Modified: the board is byte-identical since our stored validator. No body to read.
    if (res.status === 304) return { status: 'not-modified' }
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)

    // Reject early on an advertised oversize body; then enforce the cap as we read in case the
    // header lies or is absent.
    const declared = Number(res.headers?.get?.('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`response too large (${declared} bytes > ${maxBytes}) from ${url}`)
    }

    const data = await readCapped(res, maxBytes, url)
    return {
      status: 'ok',
      data,
      etag: res.headers?.get?.('etag') ?? null,
      lastModified: res.headers?.get?.('last-modified') ?? null,
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`timeout after ${timeoutMs}ms fetching ${url}`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** Read and parse a response body as JSON, aborting if it exceeds maxBytes. Streams when the body
 *  is a readable stream; falls back to res.text()/res.json() for runtime or test shims that don't
 *  expose one. */
async function readCapped(res: Response, maxBytes: number, url: string): Promise<unknown> {
  const body = res.body
  if (!body || typeof body.getReader !== 'function') {
    if (typeof res.text === 'function') {
      const text = await res.text()
      if (text.length > maxBytes) throw new Error(`response too large (>${maxBytes} bytes) from ${url}`)
      return JSON.parse(text)
    }
    return res.json()
  }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error(`response too large (>${maxBytes} bytes) from ${url}`)
    }
    out += decoder.decode(value, { stream: true })
  }
  out += decoder.decode()
  return JSON.parse(out)
}
