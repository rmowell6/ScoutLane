import Anthropic from '@anthropic-ai/sdk'

// Reads ANTHROPIC_API_KEY from the environment (server-only, never expose to the browser).
//
// timeout (P2/R-1): the SDK default request timeout is 10 MINUTES and request timeouts are themselves
// retried, so a single hung model call could wait far longer than the /api/packet 120s budget, the
// function got killed by the platform (opaque 504, full token spend, the isTransientAnthropicError→503
// mapping never reached). A 45s per-attempt timeout bounds a hung call to ~45s (it then errors and
// maps cleanly), while still covering legitimate Sonnet latency (tailoring is typically <30s).
//
// maxRetries 2 (was 4): the timeout changes the trade-off, timeout×(retries+1) must stay near the
// budget, so retries are capped at 2 (≈135s worst case for a persistently-failing single call). Two
// retries with exponential backoff + Retry-After still absorb the common brief 429/529 overload; the
// org-level spend cap remains the non-bypassable backstop.
export const anthropic = new Anthropic({ maxRetries: 2, timeout: 45_000 })

/**
 * True when an error (or its wrapped cause) is a TRANSIENT upstream model failure, an overload /
 * rate-limit / 5xx / connection error that a retry can clear. Lets route handlers return a 503
 * "busy, try again" (honest + retryable) instead of a generic 500 that reads like a crash.
 * Unwraps a few levels of `.cause` since services wrap the SDK error (e.g. DiscoverError/PacketError).
 */
export function isTransientAnthropicError(err: unknown): boolean {
  let e: unknown = err
  for (let depth = 0; depth < 5 && e != null; depth++) {
    // APIConnectionTimeoutError extends APIConnectionError, so this covers timeouts too.
    if (e instanceof Anthropic.APIConnectionError) return true
    if (e instanceof Anthropic.APIError) {
      const status = e.status
      if (typeof status === 'number') return status === 408 || status === 409 || status === 429 || status >= 500
    }
    e = (e as { cause?: unknown }).cause
  }
  return false
}

// Model constants per docs/ScoutLane_Engineering_Plan.md §4.5.
// Haiku screens cheaply; Sonnet 5 scores + tailors. Sonnet 5 lists at the same sticker price as 4.6
// but follows instructions more reliably, which matters most for the no-fabrication-sensitive tailor
// step. (Opus is intentionally NOT wired in: nothing here needs Opus-tier reasoning and it costs ~67%
// more per token; the old unused `reason: claude-opus-4-8` key was removed.)
export const MODELS = {
  screen: 'claude-haiku-4-5',
  score: 'claude-sonnet-5',
  tailor: 'claude-sonnet-5',
} as const

export type ModelKey = keyof typeof MODELS

/**
 * Read the validated structured output from an `anthropic.messages.parse(...)` result, turning the
 * two silent failure modes into clear, debuggable errors:
 *  - `stop_reason === 'refusal'`: a streaming safety classifier declined the request. This is a
 *    successful HTTP 200 (NOT an APIError), so it would otherwise fall through to the generic
 *    "no structured output" path and read like a bug. It is a policy decision, not a glitch, and is
 *    NON-RETRYABLE, identical input refuses again, so it must be a distinct error that
 *    `isTransientAnthropicError` never classifies as transient (it isn't an APIError, so it won't).
 *    Sonnet 5 is the first Sonnet-tier model with real-time safeguards, making this reachable here.
 *  - `stop_reason === 'max_tokens'`: the model ran out of output budget mid-JSON, so `parsed_output`
 *    is partial/invalid. This must surface as an explicit truncation error (raise max_tokens), NOT
 *    an opaque "no structured output", the two need different fixes.
 *  - `parsed_output` null for any other reason: the model returned nothing parseable.
 * Centralized here so every model call site handles these consistently. The refusal and truncation
 * checks come BEFORE the null check so they win even when a partial `parsed_output` is present.
 */
export function readParsed<T>(
  message: { stop_reason: string | null; parsed_output: T | null },
  label: string,
  maxTokens: number,
): T {
  if (message.stop_reason === 'refusal') {
    throw new Error(
      `${label}: the model declined this request (stop_reason=refusal), a content-policy refusal, ` +
        `not a transient error. Retrying the same input will not help.`,
    )
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error(
      `${label}: response hit the ${maxTokens}-token output cap and was truncated (partial JSON). Increase max_tokens.`,
    )
  }
  if (message.parsed_output == null) {
    throw new Error(`${label}: no structured output returned`)
  }
  return message.parsed_output
}

/**
 * Log per-call token spend: input, output, the thinking tokens Sonnet 5 bills as output (adaptive
 * thinking is on by default), and the two prompt-cache counters. Call right after `messages.parse(...)`
 * and BEFORE `readParsed`, so usage is logged even when the call truncates or is refused. Best-effort
 * and total-safe: missing usage fields log as 0.
 *
 * The cache counters are the direct hit/miss signal for the ephemeral system-prompt cache (the
 * spaced-out-manual-testing latency question): `cacheRead > 0` means the cache HIT (system prompt
 * served from cache, cheap + fast first token); `cacheCreate > 0` with `cacheRead = 0` means a MISS
 * that just repopulated the cache, i.e. the ~5-minute TTL lapsed since the previous call.
 */
export function logModelUsage(
  label: string,
  message: {
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_creation_input_tokens?: number | null
      cache_read_input_tokens?: number | null
      output_tokens_details?: { thinking_tokens?: number } | null
    } | null
  },
): void {
  const usage = message.usage
  const input = usage?.input_tokens ?? 0
  const output = usage?.output_tokens ?? 0
  const thinking = usage?.output_tokens_details?.thinking_tokens ?? 0
  const cacheRead = usage?.cache_read_input_tokens ?? 0
  const cacheCreate = usage?.cache_creation_input_tokens ?? 0
  console.log(
    `[anthropic] usage ${label}: input=${input} output=${output} thinking=${thinking} ` +
      `cacheRead=${cacheRead} cacheCreate=${cacheCreate}`,
  )
}
