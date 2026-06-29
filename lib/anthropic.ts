import Anthropic from '@anthropic-ai/sdk'

// Reads ANTHROPIC_API_KEY from the environment (server-only — never expose to the browser).
// maxRetries is raised from the SDK default (2) to 4: the model API returns transient 429/529
// (overloaded) bursts that occasionally outlast two retries, surfacing to the user as an opaque
// 500. The SDK retries these with exponential backoff + jitter and honors Retry-After, so more
// retries trade a little latency on a struggling call for far fewer user-visible failures.
export const anthropic = new Anthropic({ maxRetries: 4 })

/**
 * True when an error (or its wrapped cause) is a TRANSIENT upstream model failure — an overload /
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
// Haiku screens/scores cheaply; Sonnet tailors; Opus is available for harder reasoning.
export const MODELS = {
  screen: 'claude-haiku-4-5',
  score: 'claude-sonnet-4-6',
  tailor: 'claude-sonnet-4-6',
  reason: 'claude-opus-4-8',
} as const

export type ModelKey = keyof typeof MODELS

/**
 * Read the validated structured output from an `anthropic.messages.parse(...)` result, turning the
 * two silent failure modes into clear, debuggable errors:
 *  - `stop_reason === 'max_tokens'`: the model ran out of output budget mid-JSON, so `parsed_output`
 *    is partial/invalid. This must surface as an explicit truncation error (raise max_tokens), NOT
 *    an opaque "no structured output" — the two need different fixes.
 *  - `parsed_output` null for any other reason: the model returned nothing parseable.
 * Centralized here so every model call site handles truncation consistently.
 */
export function readParsed<T>(
  message: { stop_reason: string | null; parsed_output: T | null },
  label: string,
  maxTokens: number,
): T {
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
