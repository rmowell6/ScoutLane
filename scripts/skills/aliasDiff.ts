// Phase 5: differential safety check for the Phase 3 imported alias table. The table feeds NOT just
// display but lib/guardrails.ts's no-fabrication GROUNDING, so a bad imported pair could let a claim
// ship as "grounded" that shouldn't. This runs the three alias-table consumers under the CORE-only
// table and under the full CORE+IMPORTED table and diffs every case where they disagree, flagging the
// higher-risk direction (moving TOWARD grounded/match).
//
// This produces a REPORT for human review. It does not gate, modify, or auto-approve anything.
//
// Faithfulness: makeAliasIndex() re-derives canonicalize/aliasForms from an arbitrary groups table
// using the SAME algorithm as lib/skillAliases.ts (built on the exported guardrails.normalize, which
// skillAliases.normalizeTerm mirrors). aliasDiff.test.ts asserts this re-derivation matches the real
// canonicalize/aliasForms on the full table, so the CORE-only computation is trustworthy. Grounding
// reuses the REAL, table-independent guardrails.mentions().
import { mentions, normalize } from '@/lib/guardrails'

export type MatchStatus = 'match' | 'partial' | 'gap'

export interface AliasIndex {
  canonicalize: (term: string) => string
  aliasForms: (term: string) => string[]
}

/** Build canonicalize/aliasForms for an arbitrary alias table, mirroring lib/skillAliases.ts exactly. */
export function makeAliasIndex(groups: string[][]): AliasIndex {
  const canon = new Map<string, string>()
  const forms = new Map<string, string[]>()
  for (const group of groups) {
    const normed = group.map(normalize)
    const head = normed[0]
    if (!head) continue
    for (const form of normed) canon.set(form, head)
    forms.set(head, normed)
  }
  return {
    canonicalize: (term) => {
      const n = normalize(term)
      return canon.get(n) ?? n
    },
    aliasForms: (term) => {
      const n = normalize(term)
      const c = canon.get(n)
      return c ? (forms.get(c) ?? [n]) : [n]
    },
  }
}

/** coverage() (fitScore) and skillCoverage() (fitPresent) share this canonicalize-based per-skill rule. */
export function matchStatus(required: string, held: string[], adjacent: string[], index: AliasIndex): MatchStatus {
  const k = index.canonicalize(required)
  if (held.some((h) => index.canonicalize(h) === k)) return 'match'
  if (adjacent.some((a) => index.canonicalize(a) === k)) return 'partial'
  return 'gap'
}

/** groundedInFacts() (guardrails) semantics: the term is grounded if any fact mentions any alias form.
 *  Negation is intentionally omitted, it is table-independent so it cannot create a CORE-vs-full diff. */
export function grounded(facts: string[], term: string, index: AliasIndex): boolean {
  return index.aliasForms(term).some((form) => facts.some((fact) => mentions(normalize(fact), form)))
}

// ---- diff ------------------------------------------------------------------------

export interface DiffCase {
  name: string
  /** JD must-have skills, each checked as a coverage/skillCoverage row. */
  required?: string[]
  /** Candidate/held skills. */
  held?: string[]
  /** Adjacent (partial-credit) skills. */
  adjacent?: string[]
  /** Profile fact strings, for grounding. */
  facts?: string[]
  /** Terms to ground against `facts` (e.g. a tailored skill / claim term). */
  groundTerms?: string[]
}

export type Consumer = 'coverage' | 'skillCoverage' | 'grounding'
export type Direction = 'toward-match' | 'away-from-match'

export interface DiffRecord {
  case: string
  consumer: Consumer
  term: string
  /** The held skill or fact that now matches/grounds (context for the reviewer). */
  against: string
  core: string
  full: string
  direction: Direction
  /** The imported alias group that produced the change, for one-pass review. */
  causedBy: string | null
}

const STATUS_RANK: Record<string, number> = { gap: 0, false: 0, partial: 1, match: 2, true: 2 }

function directionOf(core: string, full: string): Direction {
  return (STATUS_RANK[full] ?? 0) > (STATUS_RANK[core] ?? 0) ? 'toward-match' : 'away-from-match'
}

/** Which imported group made `a` and `b` equivalent (or covers `a`)? For reviewer context. */
function causedBy(a: string, b: string, importedGroups: string[][]): string | null {
  const na = normalize(a)
  const nb = normalize(b)
  const g = importedGroups.find((grp) => {
    const forms = grp.map(normalize)
    return forms.includes(na) && (forms.includes(nb) || b === '')
  })
  return g ? g.join(' / ') : null
}

/** Diff one case's three-consumer results between the CORE-only and full tables. */
export function diffCase(
  c: DiffCase,
  core: AliasIndex,
  full: AliasIndex,
  importedGroups: string[][],
): DiffRecord[] {
  const out: DiffRecord[] = []
  const held = c.held ?? []
  const adjacent = c.adjacent ?? []

  for (const required of c.required ?? []) {
    const coreStatus = matchStatus(required, held, adjacent, core)
    const fullStatus = matchStatus(required, held, adjacent, full)
    if (coreStatus !== fullStatus) {
      // Name the held/adjacent term that newly matches, for context + causedBy.
      const against =
        [...held, ...adjacent].find((h) => full.canonicalize(h) === full.canonicalize(required)) ?? ''
      const cb = causedBy(required, against, importedGroups)
      for (const consumer of ['coverage', 'skillCoverage'] as const) {
        out.push({ case: c.name, consumer, term: required, against, core: coreStatus, full: fullStatus, direction: directionOf(coreStatus, fullStatus), causedBy: cb })
      }
    }
  }

  for (const term of c.groundTerms ?? []) {
    const facts = c.facts ?? []
    const coreG = grounded(facts, term, core)
    const fullG = grounded(facts, term, full)
    if (coreG !== fullG) {
      const against = facts.find((f) => full.aliasForms(term).some((form) => mentions(normalize(f), form))) ?? ''
      const cb = causedBy(term, against, importedGroups) ?? importedGroups.find((grp) => grp.map(normalize).includes(normalize(term)))?.join(' / ') ?? null
      out.push({ case: c.name, consumer: 'grounding', term, against, core: String(coreG), full: String(fullG), direction: directionOf(String(coreG), String(fullG)), causedBy: cb })
    }
  }
  return out
}

export interface DiffReport {
  totalDiffs: number
  towardMatch: number
  awayFromMatch: number
  towardGrounded: number
  records: DiffRecord[]
}

/** Run every case through both tables and summarize. */
export function runDiff(cases: DiffCase[], coreGroups: string[][], fullGroups: string[][], importedGroups: string[][]): DiffReport {
  const core = makeAliasIndex(coreGroups)
  const full = makeAliasIndex(fullGroups)
  const records = cases.flatMap((c) => diffCase(c, core, full, importedGroups))
  return {
    totalDiffs: records.length,
    towardMatch: records.filter((r) => r.direction === 'toward-match').length,
    awayFromMatch: records.filter((r) => r.direction === 'away-from-match').length,
    towardGrounded: records.filter((r) => r.consumer === 'grounding' && r.direction === 'toward-match').length,
    records,
  }
}
