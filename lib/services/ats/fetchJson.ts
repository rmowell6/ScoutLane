// Shared JSON fetch for ATS public APIs: bounded by a timeout, with a clear error on non-2xx
// so a blocked domain or a bad board token surfaces as a readable message (not a silent empty).
export async function fetchJson(url: string, timeoutMs = 10_000): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      // A descriptive UA is good practice for public APIs (some reject the default fetch agent).
      headers: { accept: 'application/json', 'user-agent': 'ScoutLane/1.0 (+job-pool ingest)' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
    return await res.json()
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`timeout after ${timeoutMs}ms fetching ${url}`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
