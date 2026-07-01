// O*NET Software Skills alias extraction (Phase 1, RAW CANDIDATES ONLY, nothing here is trusted or
// wired into lib/skillAliases.ts). O*NET's 30.3 "Workplace Example" column often embeds both a full
// product name and its abbreviation in one string. Two patterns, both verified on the real 8,753-row
// deduped export:
//   1. Parenthetical `Full Name (ACRONYM)` at the END of the string. High precision (~17 hits).
//   2. Trailing acronym `Full Name ACRONYM`. Noisy alone (749 raw hits, false parses like
//      "Cisco Systems WAN Manager" are avoided because that does not END in the caps token), so we
//      apply an initials-consistency check: the trailing token must be derivable from the initials of
//      the preceding words. Exact match is high confidence; a loose substring match (e.g. "Exact
//      Software Macola" -> initials "ESM", trailing "ES" is a substring) is flagged for scrutiny.
//
// Category-based grouping is deliberately NOT implemented: O*NET's 133 categories average 65.8 distinct
// products each (some over 1,000), so same-category products are sibling competitors, not synonyms.
import { parseCsvObjects } from './csv'

export type OnetConfidence = 'parenthetical' | 'initials-exact' | 'initials-substring'

export interface OnetCandidate {
  source: 'onet'
  /** The long form (the words preceding the acronym). */
  full: string
  /** The short form / acronym. */
  acronym: string
  confidence: OnetConfidence
  /** True for the loose initials-substring tier (the "ES"/"ESM" loophole): review before trusting. */
  needsScrutiny: boolean
  // Reviewer context, straight from the source row.
  workplaceExample: string
  elementName: string
  hotTechnology: boolean
  inDemand: boolean
}

// Connector words excluded when computing initials. EXACTLY the set from the spec: note "a"/"an" are
// intentionally NOT here, so "A programming language" -> initials "APL" (matching the acronym) works.
const CONNECTORS = new Set(['of', 'the', 'and', 'for', 'to', 'in', 'on'])

// End-anchored: the acronym must be the last thing in the string (the high-precision case).
const PARENTHETICAL_RE = /^(.+?)\s*\(([A-Z]{2,6})\)$/
// End-anchored trailing all-caps token (2-6 letters) preceded by at least one word.
const TRAILING_RE = /^(.+?)\s+([A-Z]{2,6})$/

/** `Full Name (ACRONYM)` where the parenthetical is at the end. Returns null otherwise. */
export function extractParenthetical(name: string): { full: string; acronym: string } | null {
  const m = name.trim().match(PARENTHETICAL_RE)
  if (!m) return null
  const full = (m[1] ?? '').trim()
  const acronym = m[2] ?? ''
  if (!full || !acronym) return null
  return { full, acronym }
}

/** `Full Name ACRONYM` where a 2-6 char all-caps token ends the string. Structure only, the caller
 *  applies the initials check to decide confidence / rejection. */
export function extractTrailingAcronym(name: string): { full: string; acronym: string } | null {
  const m = name.trim().match(TRAILING_RE)
  if (!m) return null
  const full = (m[1] ?? '').trim()
  const acronym = m[2] ?? ''
  if (!full || !acronym) return null
  return { full, acronym }
}

/** Initials of `full`, uppercased, dropping connector words. First alphanumeric char of each word. */
export function computeInitials(full: string): string {
  return full
    .split(/\s+/)
    .filter((w) => w.length > 0 && !CONNECTORS.has(w.toLowerCase()))
    .map((w) => {
      const ch = w.match(/[A-Za-z0-9]/)
      return ch ? ch[0].toUpperCase() : ''
    })
    .join('')
}

/**
 * Is `acronym` a plausible derivation of `full`'s initials?
 *   - 'exact'     : the acronym equals the initials ("A mathematical programming language" -> "AMPL").
 *   - 'substring' : the acronym is a substring of the initials but not equal ("Exact Software Macola"
 *                   -> initials "ESM", acronym "ES"). Weaker, flagged for review.
 *   - null        : not derivable, reject ("ADP Enterprise" -> initials "AE", acronym "HR").
 */
export function initialsConsistency(full: string, acronym: string): 'exact' | 'substring' | null {
  const initials = computeInitials(full)
  const a = acronym.toUpperCase()
  if (!initials || !a) return null
  if (initials === a) return 'exact'
  if (initials.includes(a)) return 'substring'
  return null
}

/** Extract every O*NET alias candidate from the CSV text. One candidate per row at most; a
 *  parenthetical match takes precedence over a trailing-acronym match. */
export function extractOnetCandidates(csvText: string): OnetCandidate[] {
  const out: OnetCandidate[] = []
  for (const r of parseCsvObjects(csvText)) {
    const name = (r['Workplace Example'] ?? '').trim()
    if (!name) continue
    const ctx = {
      workplaceExample: name,
      elementName: (r['Element Name'] ?? '').trim(),
      hotTechnology: (r['Hot Technology'] ?? '').trim().toUpperCase() === 'Y',
      inDemand: (r['In Demand'] ?? '').trim().toUpperCase() === 'Y',
    }

    const paren = extractParenthetical(name)
    if (paren) {
      out.push({ source: 'onet', ...paren, confidence: 'parenthetical', needsScrutiny: false, ...ctx })
      continue
    }

    const trailing = extractTrailingAcronym(name)
    if (trailing) {
      const cons = initialsConsistency(trailing.full, trailing.acronym)
      if (!cons) continue // acronym not derivable from the initials, reject
      out.push({
        source: 'onet',
        ...trailing,
        confidence: cons === 'exact' ? 'initials-exact' : 'initials-substring',
        needsScrutiny: cons === 'substring',
        ...ctx,
      })
    }
  }
  return out
}
