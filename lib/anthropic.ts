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
