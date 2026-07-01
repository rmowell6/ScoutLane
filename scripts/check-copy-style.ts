// Copy-style gate: fail the build if any marketing/app copy source breaks the house style
// (no em dash, no repeated spaces), the same "must be green" bar as typecheck/lint/tests.
// Wired into `npm run lint:copy` and CI. See docs/VOICE_STYLE_GUIDE.md section 7.
//
// Scope is deliberate: user-facing copy lives in app/ + components/. We do NOT scan lib/ (guardrails.ts
// itself contains a literal em dash inside the rule it defines) or docs/ (the style guide quotes em
// dashes as examples of what to avoid).
import { readFileSync, globSync } from 'node:fs'
import { scanText } from './copyStyle'

const PATTERNS = ['app/**/*.tsx', 'components/**/*.tsx']

function main(): void {
  const files = PATTERNS.flatMap((p) => globSync(p)).sort()
  let violationCount = 0

  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const v of scanText(text)) {
      violationCount++
      console.error(`${file}:${v.line}: ${v.violations.join('; ')}`)
    }
  }

  if (violationCount > 0) {
    console.error(`\n[lint:copy] ${violationCount} style violation(s) in ${files.length} file(s). See docs/VOICE_STYLE_GUIDE.md.`)
    process.exit(1)
  }
  console.log(`[lint:copy] ok: no em dashes or repeated spaces in ${files.length} copy file(s).`)
}

main()
