// Adapter: turn a loose, LLM-produced role classification into a clean RecommendInput the
// recommender can trust. The classifier may emit nulls or out-of-vocab strings; this normalizes
// them to the recommender's exact unions (unknown → undefined, so recommend() falls back cleanly).
// Kept pure + dependency-light (no LLM here) so it's trivially testable; the LLM call lives in
// lib/services/recommendStyle.ts.
import type { RecommendInput, Seniority, RoleType } from './types'

const SENIORITIES: readonly Seniority[] = [
  'entry',
  'junior',
  'mid',
  'senior',
  'staff',
  'principal',
  'director',
  'executive',
]

const ROLE_TYPES: readonly RoleType[] = [
  'engineer',
  'engineering-manager',
  'devops',
  'cloud',
  'data',
  'security',
  'it-ops',
  'product',
  'design',
  'finance',
  'legal',
  'operations',
  'sales',
  'hr',
  'general',
]

/** Loose shape a classifier (or any caller) can hand us — fields optional/nullable/free-text. */
export interface StyleClassification {
  domain?: string | null
  seniority?: string | null
  roleType?: string | null
}

function asSeniority(v: string | null | undefined): Seniority | undefined {
  return v != null && (SENIORITIES as readonly string[]).includes(v) ? (v as Seniority) : undefined
}

function asRoleType(v: string | null | undefined): RoleType | undefined {
  return v != null && (ROLE_TYPES as readonly string[]).includes(v) ? (v as RoleType) : undefined
}

/** Normalize a classification into a RecommendInput. recommend() maps `domain`→industry itself. */
export function inferStyleInput(c: StyleClassification): RecommendInput {
  const domain = c.domain?.trim()
  return {
    domain: domain ? domain : undefined,
    seniority: asSeniority(c.seniority),
    roleType: asRoleType(c.roleType),
  }
}
