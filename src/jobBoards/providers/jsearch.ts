// @ts-nocheck -- vendored job-board module (kept as delivered; integration code is strict)
// ─────────────────────────────────────────────────────────────────────────────
// ScoutLane — JSearch Provider (via RapidAPI)
// Docs: https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
// Auth: RapidAPI key — register at https://rapidapi.com
// Coverage: Real-time aggregation of Indeed, LinkedIn, Glassdoor, ZipRecruiter,
//           and 500+ other sources. Best for broad US market coverage.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Job,
  JobBoardProvider,
  JobSearchResult,
  SearchParams,
  JSearchConfig,
} from '../types';
import {
  fetchJSON,
  buildId,
  normaliseJobType,
  parseSalaryString,
  stripHtml,
  DEFAULT_PAGE_SIZE,
} from './base';

// ---------------------------------------------------------------------------
// JSearch API response types
// ---------------------------------------------------------------------------

interface JSearchResponse {
  status: string;
  request_id: string;
  parameters: Record<string, unknown>;
  data: JSearchJob[];
}

interface JSearchJob {
  job_id: string;
  employer_name: string;
  employer_logo?: string;
  employer_website?: string;
  job_publisher: string;
  job_employment_type: string;
  job_title: string;
  job_apply_link: string;
  job_apply_is_direct: boolean;
  job_apply_quality_score: number;
  job_description: string;
  job_is_remote: boolean;
  job_posted_at_datetime_utc: string;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_latitude?: number;
  job_longitude?: number;
  job_highlights?: {
    Qualifications?: string[];
    Responsibilities?: string[];
    Benefits?: string[];
  };
  job_required_skills?: string[];
  job_required_experience?: {
    no_experience_required: boolean;
    required_experience_in_months?: number;
  };
  job_min_salary?: number;
  job_max_salary?: number;
  job_salary_currency?: string;
  job_salary_period?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildLocation(job: JSearchJob): string {
  if (job.job_is_remote) return 'Remote';
  const parts = [job.job_city, job.job_state, job.job_country].filter(Boolean);
  return parts.join(', ') || 'Unknown';
}

function mapSalaryPeriod(
  raw?: string,
): 'hourly' | 'monthly' | 'annual' {
  if (!raw) return 'annual';
  const r = raw.toUpperCase();
  if (r === 'HOUR') return 'hourly';
  if (r === 'MONTH') return 'monthly';
  return 'annual';
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function mapJob(raw: JSearchJob, source: string): Job {
  const salary =
    raw.job_min_salary || raw.job_max_salary
      ? {
          min: raw.job_min_salary,
          max: raw.job_max_salary,
          currency: raw.job_salary_currency ?? 'USD',
          period: mapSalaryPeriod(raw.job_salary_period),
        }
      : undefined;

  const tags = [
    ...(raw.job_required_skills ?? []),
    raw.job_publisher,
  ].filter(Boolean);

  return {
    id: buildId(source, raw.job_id),
    source,
    title: raw.job_title,
    company: raw.employer_name,
    companyLogo: raw.employer_logo,
    location: buildLocation(raw),
    remote: raw.job_is_remote,
    type: normaliseJobType(raw.job_employment_type),
    salary,
    description: stripHtml(raw.job_description),
    tags,
    url: raw.job_apply_link,
    applyUrl: raw.job_apply_link,
    postedAt: new Date(raw.job_posted_at_datetime_utc),
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class JSearchProvider implements JobBoardProvider {
  readonly name = 'jsearch';

  constructor(private readonly config: JSearchConfig) {}

  async search(params: SearchParams): Promise<JobSearchResult> {
    const page = params.page ?? 1;
    const pageSize = Math.min(params.pageSize ?? DEFAULT_PAGE_SIZE, 50); // JSearch max is 50

    // Build query string: JSearch uses a single freetext query
    const queryParts: string[] = [];
    if (params.query) queryParts.push(params.query);
    if (params.type === 'contract') queryParts.push('contract');
    if (params.type === 'part-time') queryParts.push('part time');
    if (params.remote) queryParts.push('remote');
    if (params.tags?.length) queryParts.push(...params.tags);

    const query = queryParts.length > 0 ? queryParts.join(' ') : 'software engineer IT';

    const qs = new URLSearchParams({
      query,
      num_pages: '1',
      date_posted: 'all',
    });

    if (params.location) qs.set('location', params.location);
    if (params.remote) qs.set('remote_jobs_only', 'true');
    if (params.salaryMin) qs.set('job_min_salary', String(params.salaryMin));
    if (params.country) qs.set('country', params.country);

    // JSearch v5 renamed the search endpoint /search -> /search-v2 (the old path 404s).
    const url = `https://jsearch.p.rapidapi.com/search-v2?${qs}`;

    try {
      const data = await fetchJSON<JSearchResponse>(
        url,
        {
          headers: {
            'X-RapidAPI-Key': this.config.rapidApiKey,
            'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
          },
        },
        this.config.timeoutMs,
      );

      const jobs = data.data.map((j) => mapJob(j, this.name));

      return {
        jobs: jobs.slice(0, pageSize),
        total: jobs.length,  // JSearch doesn't return total count
        page,
        pageSize,
        source: this.name,
      };
    } catch (err) {
      return {
        jobs: [],
        total: 0,
        page,
        pageSize,
        source: this.name,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
