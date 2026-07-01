// Phase 5 entry: run the alias-table differential safety check and write a reviewable report.
//   npm run skills:aliasdiff   (tsx scripts/skills/runAliasDiff.ts)
//
// Runs the three consumers (coverage, skillCoverage, grounding) under the CORE-only table and the full
// CORE+IMPORTED table over a synthetic input set that deliberately exercises the newly imported terms
// (plus controls that should NOT change). Every disagreement is reported with the imported pair that
// caused it and the direction. A diff moving TOWARD grounded/match is the higher-risk direction.
import { writeFileSync } from 'node:fs'
import { CORE_ALIAS_GROUPS, IMPORTED_ALIAS_GROUPS, ALIAS_GROUPS } from '@/lib/skillAliases'
import { runDiff, type DiffCase } from './aliasDiff'

const OUT_PATH = 'scripts/skills/alias-diff-report.json'

// Synthetic inputs. The imported-term cases SHOULD diff (that is the intended, approved effect); the
// control cases (core pairs, unrelated skills, no imported terms) must NOT diff, which confirms the
// harness isolates the imported table's effect rather than flagging noise.
const CASES: DiffCase[] = [
  // --- imported-term cases (expected to move toward match / grounded) ---
  { name: 'React: JD "ReactJS" vs resume "React"', required: ['ReactJS'], held: ['React'], facts: ['Built customer dashboards in React'], groundTerms: ['ReactJS'] },
  { name: 'SQL Server: JD "SQL Server" vs resume "MSSQL"', required: ['SQL Server'], held: ['MSSQL'], facts: ['Tuned MSSQL stored procedures'], groundTerms: ['SQL Server'] },
  { name: 'Kafka: JD "Apache Kafka" vs resume "Kafka"', required: ['Apache Kafka'], held: ['Kafka'], facts: ['Ran Kafka clusters in production'], groundTerms: ['Apache Kafka'] },
  { name: 'scikit-learn: JD "scikit-learn" vs resume "sklearn"', required: ['scikit-learn'], held: ['sklearn'], facts: ['Trained models with sklearn'], groundTerms: ['scikit-learn'] },
  { name: 'C++: JD "C++" vs resume "CPP"', required: ['C++'], held: ['CPP'], facts: [], groundTerms: [] },
  { name: 'Next.js: JD "Next.js" vs resume "nextjs"', required: ['Next.js'], held: ['nextjs'], facts: [], groundTerms: [] },
  { name: 'Hadoop: JD "Apache Hadoop" vs resume "Hadoop"', required: ['Apache Hadoop'], held: ['Hadoop'], facts: [], groundTerms: [] },
  { name: 'Salesforce: grounding "Salesforce" vs fact "salesforce.com"', facts: ['Administered salesforce.com for 200 users'], groundTerms: ['Salesforce'] },
  { name: 'PowerShell: JD "PowerShell" vs resume "Windows PowerShell"', required: ['PowerShell'], held: ['Windows PowerShell'], facts: [], groundTerms: [] },
  { name: 'Vue.js partial: JD "Vue.js" vs adjacent "vuejs"', required: ['Vue.js'], held: [], adjacent: ['vuejs'], facts: [], groundTerms: [] },

  // --- controls (must NOT diff) ---
  { name: 'CONTROL core pair: JD "Kubernetes" vs resume "K8s" (already in core)', required: ['Kubernetes'], held: ['K8s'], facts: ['Operated K8s clusters'], groundTerms: ['Kubernetes'] },
  { name: 'CONTROL unrelated: JD "Angular" vs resume "React"', required: ['Angular'], held: ['React'], facts: ['Built dashboards in React'], groundTerms: ['Angular'] },
  { name: 'CONTROL no imported terms: JD "Terraform" vs resume "Terraform"', required: ['Terraform', 'Ansible'], held: ['Terraform'], facts: ['Wrote Terraform modules'], groundTerms: ['Terraform'] },
]

const report = runDiff(CASES, CORE_ALIAS_GROUPS, ALIAS_GROUPS, IMPORTED_ALIAS_GROUPS)
const output = {
  note: 'Alias-table differential safety report (Phase 5). CORE-only vs CORE+IMPORTED, over synthetic inputs. Review, do not auto-merge.',
  summary: {
    totalDiffs: report.totalDiffs,
    towardMatch: report.towardMatch,
    awayFromMatch: report.awayFromMatch,
    towardGrounded: report.towardGrounded,
  },
  records: report.records,
}
writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`)

console.log(`[skills] alias diff: ${report.totalDiffs} changes ` + `(toward-match ${report.towardMatch}, toward-grounded ${report.towardGrounded}, away-from-match ${report.awayFromMatch})`)
if (report.awayFromMatch > 0) {
  console.log('[skills] WARNING: away-from-match changes found, an imported pair may have broken a core match. Review immediately.')
}
console.log(`[skills] wrote ${OUT_PATH}`)
