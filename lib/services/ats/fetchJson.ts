// Largest ATS response we'll buffer. A big board page is a few MB; 25 MB is a generous ceiling
// that still stops a hostile or misbehaving endpoint from exhausting memory on the ingest worker.
const MAX_BYTES = 25 * 1024 * 1024

// Shared JSON fetch for ATS public APIs: bounded by a timeout AND a response-size cap, with a
// clear error on non-2xx so a blocked domain or a bad board token surfaces as a readable message
// (not a silent empty). The body is streamed and aborted the moment it exceeds the byte cap, so a
// bogus Content-Length can't sneak an oversized payload past us.
export async function fetchJson(url: string, timeoutMs = 10_000, maxBytes = MAX_BYTES): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      // Fail on a redirect rather than following it: the URL is provider config, but an open redirect
      // on a board host could otherwise bounce this server-side fetch at an internal/metadata address
      // (SSRF). We only call documented ATS JSON endpoints, which don't legitimately 3xx.
      redirect: 'error',
      // A descriptive UA is good practice for public APIs (some reject the default fetch agent).
      headers: { accept: 'application/json', 'user-agent': 'ScoutLane/1.0 (+job-pool ingest)' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)

    // Reject early on an advertised oversize body; then enforce the cap as we read in case the
    // header lies or is absent.
    const declared = Number(res.headers?.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`response too large (${declared} bytes > ${maxBytes}) from ${url}`)
    }

    return await readCapped(res, maxBytes, url)
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
