// Deterministic skill/cert synonym safety net (no fuzzy matching, no model call, no randomness).
// Skill comparison happens by EXACT token in two places, fitScore.coverage() and guardrails
// mentions()-based grounding, so a real, qualified candidate can be under-scored or wrongly blocked
// purely because the resume and the JD spell a skill differently ("K8s" vs "Kubernetes"). The
// extraction prompts already ask for canonical tokens; this is the code-level backstop for when that
// canonicalization is imperfect.
//
// Purely ADDITIVE: a term not in the curated table behaves exactly as before (normalize only). Only
// genuinely UNAMBIGUOUS pairs belong here, when in doubt leave a pair out rather than risk a false
// match (e.g. "TS" is deliberately excluded, it collides with TS/SCI clearances; "Go" and bare
// "Node" are excluded as everyday words / cluster-node collisions).
//
// Self-contained on purpose: normalizeTerm mirrors guardrails.normalize but is kept local so this
// stays a dependency-free leaf (guardrails imports THIS, so importing guardrails back would cycle).

/** Lowercase and fold whitespace + every hyphen/dash variant to a single space. Mirrors
 *  guardrails.normalize so the forms here compare consistently with mentions()/coverage(). */
function normalizeTerm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s‐-―−-]+/g, ' ') // whitespace + hyphen/dash variants (U+2010 to U+2015, minus sign, ASCII hyphen)
    .trim()
}

// Each group is one equivalence class: [canonical, ...synonyms]. Compared after normalizeTerm, so
// write forms in their natural spelling (dots/slashes are preserved by normalize, only dashes fold).
const ALIAS_GROUPS: string[][] = [
  ['kubernetes', 'k8s'],
  ['javascript', 'js'],
  ['amazon web services', 'aws'],
  ['google cloud platform', 'gcp'],
  ['microsoft azure', 'azure'],
  ['infrastructure as code', 'iac'],
  ['continuous integration and continuous deployment', 'ci/cd', 'cicd'],
  ['machine learning', 'ml'],
  ['artificial intelligence', 'ai'],
  ['.net', 'dotnet'],
  ['postgresql', 'postgres'],
  ['mongodb', 'mongo'],
  ['node.js', 'nodejs'],
  ['virtual machines', 'virtual machine', 'vms', 'vm'],
]

// normalizedForm -> canonical normalized form (self-contained, safe to build at module load).
const CANON = new Map<string, string>()
// canonical normalized form -> every normalized form in its group (for the grounding fallback).
const FORMS = new Map<string, string[]>()
for (const group of ALIAS_GROUPS) {
  const forms = group.map(normalizeTerm)
  const canon = forms[0] as string
  for (const form of forms) CANON.set(form, canon)
  FORMS.set(canon, forms)
}

/** Normalize `term`, then collapse it to its curated canonical form when one exists; otherwise
 *  return the normalized term unchanged. Two terms are equivalent iff their canonicals are equal,
 *  which is how coverage() compares the required and held/adjacent sets. */
export function canonicalize(term: string): string {
  const n = normalizeTerm(term)
  return CANON.get(n) ?? n
}

/** Every normalized surface form equivalent to `term` (including itself). A single-element array when
 *  the term is not in the table (so an alias-aware mentions() degrades to a plain mentions()). Used by
 *  the grounding fallback to try "k8s" when the term is "kubernetes" and vice versa. */
export function aliasForms(term: string): string[] {
  const n = normalizeTerm(term)
  const canon = CANON.get(n)
  if (!canon) return [n]
  return FORMS.get(canon) ?? [n]
}
