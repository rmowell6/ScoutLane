// Hand-maintained seed of common technology / skill tags that show up in resumes and job descriptions.
// We fetch Stack Exchange synonyms for THESE tags only (not the whole site's tag list), so the
// candidate set stays bounded, relevant, and inside the unauthenticated rate limit. Names are Stack
// Overflow tag slugs (lowercase, hyphenated, with the exact punctuation SO uses, e.g. "node.js",
// "c#", "asp.net"). Extend freely; nothing here is trusted yet, it only scopes the synonym fetch.
export const SEED_TAGS: string[] = [
  // cloud / infra
  'kubernetes', 'docker', 'amazon-web-services', 'azure', 'google-cloud-platform', 'terraform',
  'ansible', 'nginx', 'apache', 'linux', 'vmware', 'hyper-v', 'active-directory', 'windows-server',
  // ci/cd + tooling
  'git', 'github', 'gitlab', 'jenkins', 'github-actions', 'prometheus', 'grafana',
  // languages
  'python', 'javascript', 'typescript', 'java', 'c#', 'c++', 'go', 'rust', 'ruby', 'php', 'kotlin',
  'swift', 'scala', 'bash', 'powershell', 'sql',
  // web frameworks / runtimes
  'node.js', 'reactjs', 'angular', 'vue.js', 'next.js', 'django', 'flask', 'spring', 'spring-boot',
  'asp.net', '.net', 'express', 'graphql',
  // data stores + streaming
  'postgresql', 'mysql', 'sql-server', 'oracle', 'mongodb', 'redis', 'elasticsearch',
  'apache-kafka', 'rabbitmq', 'snowflake',
  // data / ml
  'pandas', 'numpy', 'scikit-learn', 'tensorflow', 'pytorch', 'apache-spark', 'hadoop',
  // enterprise / bi
  'tableau', 'powerbi', 'salesforce', 'sap', 'servicenow', 'jira',
]
