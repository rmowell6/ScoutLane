// @ts-nocheck -- vendored job-board module (kept as delivered; integration code is strict)
// ─────────────────────────────────────────────────────────────────────────────
// ScoutLane, Job Board Types
// ─────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// Core Job model (normalized across all providers)
// ---------------------------------------------------------------------------

export type JobType =
  | 'full-time'
  | 'part-time'
  | 'contract'
  | 'internship'
  | 'freelance';

export interface Salary {
  min?: number;
  max?: number;
  currency: string;          // ISO 4217, e.g. "USD"
  period: 'hourly' | 'monthly' | 'annual';
}

export interface Job {
  /** Globally unique ID: "<source>:<external_id>" */
  id: string;
  /** Provider name, e.g. "adzuna", "himalayas" */
  source: string;
  title: string;
  company: string;
  companyLogo?: string;
  location: string;
  remote: boolean;
  type: JobType;
  salary?: Salary;
  /** Full job description (may be HTML) */
  description: string;
  tags: string[];
  /** Canonical URL to the job listing */
  url: string;
  /** Direct application URL (if different from url) */
  applyUrl?: string;
  postedAt: Date;
  expiresAt?: Date;
}

// ---------------------------------------------------------------------------
// Search parameters (provider-agnostic)
// ---------------------------------------------------------------------------

export interface SearchParams {
  /** Keyword / job title query */
  query?: string;
  /** City, state, or region */
  location?: string;
  /** Filter to remote-only postings */
  remote?: boolean;
  type?: JobType;
  /** 1-based page number */
  page?: number;
  /** Results per page (provider may cap this) */
  pageSize?: number;
  /** Tech skill tags, e.g. ["typescript", "aws"] */
  tags?: string[];
  /** Minimum annual salary in USD */
  salaryMin?: number;
  /** ISO 3166-1 alpha-2 country code, e.g. "us", "gb" */
  country?: string;
}

// ---------------------------------------------------------------------------
// Provider result
// ---------------------------------------------------------------------------

export interface JobSearchResult {
  jobs: Job[];
  /** Total matching jobs known to the provider (may be estimated) */
  total: number;
  page: number;
  pageSize: number;
  source: string;
  /** Non-fatal error message (provider still returned partial results) */
  error?: string;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface JobBoardProvider {
  readonly name: string;
  search(params: SearchParams): Promise<JobSearchResult>;
}

// ---------------------------------------------------------------------------
// Provider configs
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  /** Set false to disable this provider without removing config */
  enabled?: boolean;
  /** Per-request timeout in ms (default: 10_000) */
  timeoutMs?: number;
}

export interface AdzunaConfig extends ProviderConfig {
  appId: string;
  appKey: string;
  /** Default country code (default: "us") */
  country?: string;
}

export interface USAJobsConfig extends ProviderConfig {
  apiKey: string;
  /** Required by USAJobs TOS, your app name or email */
  userAgent: string;
}

export interface JSearchConfig extends ProviderConfig {
  /** RapidAPI key, https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch */
  rapidApiKey: string;
}

export interface AggregatorConfig {
  providers?: {
    adzuna?: AdzunaConfig;
    himalayas?: ProviderConfig;
    arbeitnow?: ProviderConfig;
    remotive?: ProviderConfig;
    remoteok?: ProviderConfig;
    usajobs?: USAJobsConfig;
    jsearch?: JSearchConfig;
  };
  /** Remove duplicate postings across providers (default: true) */
  deduplicate?: boolean;
  /** Global timeout for the full aggregation in ms (default: 15_000) */
  timeoutMs?: number;
}
