// Copy-style scanner core (pure + testable). Extends the SAME house-style rule the product enforces
// on generated documents (lib/guardrails.ts checkStyle: no em dash, no repeated spaces) to static
// marketing/app copy. Kept separate from the runnable script so it can be unit-tested without doing
// filesystem or process work. See docs/VOICE_STYLE_GUIDE.md section 7.
import { checkStyle } from '@/lib/guardrails'

export interface CopyViolation {
  /** 1-indexed line number within the scanned text. */
  line: number
  /** Human-readable violation(s) on that line (reused verbatim from checkStyle). */
  violations: string[]
}

/**
 * Strip `//` line comments and `/* *\/` block comments from source, string-aware so a `//` inside a
 * URL or string literal is preserved. Returns one entry per input line (a block comment spanning
 * lines yields '' for its commented spans). Used ONLY for the repeated-space check: code-comment
 * alignment ("1. Foo  (bar)") is not user-facing copy, so it must not trip the rule. Em-dash
 * detection deliberately does NOT use this, it runs on the raw line so nothing can hide behind a
 * comment or a string.
 */
export function stripComments(text: string): string[] {
  const out: string[] = []
  let inBlock = false
  for (const line of text.split('\n')) {
    let res = ''
    let quote: string | null = null // active string delimiter (' " or `), else null
    let i = 0
    while (i < line.length) {
      const c = line[i]
      const c2 = line[i + 1]
      if (inBlock) {
        if (c === '*' && c2 === '/') {
          inBlock = false
          i += 2
        } else {
          i++
        }
        continue
      }
      if (quote) {
        res += c
        if (c === '\\') {
          res += c2 ?? ''
          i += 2
          continue
        }
        if (c === quote) quote = null
        i++
        continue
      }
      if (c === '/' && c2 === '/') break // line comment: drop the rest of the line
      if (c === '/' && c2 === '*') {
        inBlock = true
        i += 2
        continue
      }
      if (c === '"' || c === "'" || c === '`') {
        quote = c
        res += c
        i++
        continue
      }
      res += c
      i++
    }
    out.push(res)
  }
  return out
}

/**
 * Scan a block of source text line by line and return every line that breaks the house style.
 * Reuses checkStyle() so the rule can never drift from the one applied to generated documents.
 *
 * - Em dash: checked on the RAW line, so an em dash anywhere (copy, string, even a comment, which the
 *   house style also forbids) is caught.
 * - Repeated spaces: checked on the comment-stripped line with LEADING indentation removed. Source
 *   files are indented and code comments are often column-aligned with runs of spaces; neither is copy,
 *   so we look only at repeated spaces inside the remaining code/copy text.
 */
export function scanText(text: string): CopyViolation[] {
  const rawLines = text.split('\n')
  const codeLines = stripComments(text)
  const out: CopyViolation[] = []
  for (let i = 0; i < rawLines.length; i++) {
    const emDash = checkStyle(rawLines[i] ?? '').violations.filter((v) => v.includes('em dash'))
    const spaces = checkStyle((codeLines[i] ?? '').replace(/^[ \t]+/, '')).violations.filter((v) =>
      v.includes('repeated spaces'),
    )
    const violations = [...emDash, ...spaces]
    if (violations.length > 0) out.push({ line: i + 1, violations })
  }
  return out
}
