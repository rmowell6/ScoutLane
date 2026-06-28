import Anthropic from '@anthropic-ai/sdk'

// Reads ANTHROPIC_API_KEY from the environment (server-only — never expose to the browser).
export const anthropic = new Anthropic()

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
