// Live-job validation: confirm a user-supplied job URL is reachable and not expired
// (Engineering Plan §5 step 2). This only checks liveness of a URL the user provided, 
// it does NOT scrape gated sites or log into accounts (product invariant).
//
// The fetch implementation is injectable so the status logic is unit-testable without network.

export type JobStatus = 'live' | 'expired' | 'unverified'

export interface JobValidation {
  status: JobStatus
  url: string
  finalUrl?: string
  httpStatus?: number
}

/** Pure mapping from an HTTP status code to our liveness verdict. */
export function classifyJobStatus(httpStatus: number): JobStatus {
  if (httpStatus >= 200 && httpStatus < 300) return 'live'
  if (httpStatus === 404 || httpStatus === 410) return 'expired'
  return 'unverified'
}

/** Accept only well-formed http(s) URLs. */
export function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface ValidateJobOptions {
  timeoutMs?: number
  fetchImpl?: FetchLike
}

export async function validateJobUrl(
  url: string,
  options: ValidateJobOptions = {},
): Promise<JobValidation> {
  if (!isValidHttpUrl(url)) return { status: 'unverified', url }

  const doFetch = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000)

  try {
    const res = await doFetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal })
    return {
      status: classifyJobStatus(res.status),
      url,
      finalUrl: res.url,
      httpStatus: res.status,
    }
  } catch {
    // network error, timeout, DNS failure -> we couldn't confirm; treat as unverified.
    return { status: 'unverified', url }
  } finally {
    clearTimeout(timer)
  }
}
