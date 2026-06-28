// @ts-nocheck -- vendored job-board module (kept as delivered; integration code is strict)
// ─────────────────────────────────────────────────────────────────────────────
// ScoutLane — Remotive Provider
// Docs: https://remotive.com/remote-jobs/api
// Auth: None — fully public
// Rate limit: max ~4 requests/day recommended (2/min hard limit)
// Coverage: Remote tech roles globally, ~2,000 active listings
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Job,
  JobBoardProvider,
  JobSearchResult,
  SearchParams,
  ProviderConfig,
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
// Remotive API response types
// ---------------------------------------------------------------------------

interface RemotiveResponse {
  'job-count': number;
  jobs: RemotiveJob[];
}

interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  company_logo?: string;
  category: string;
  tags: string[];
  job_type: string;
  publication_date: string;   // ISO 8601
  candidate_required_location: string;
  salary: string;
  description: string;
}

// Remotive category mapping for IT roles
const IT_CATEGORIES = [
  'software-dev',
  'devops-sysadmin',
  'data',
  'qa',
  'cyber-security',
  'network',
];

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function mapJob(raw: RemotiveJob, source: string): Job {
  const location = raw.candidate_required_location || 'Worldwide';

  return {
    id: buildId(source, raw.id),
    source,
    title: raw.title,
    company: raw.company_name,
    companyLogo: raw.company_logo,
    location,
    remote: true,  // Remotive is remote-only
    type: normaliseJobType(raw.job_type),
    salary: parseSalaryString(raw.salary),
    description: stripHtml(raw.description),
    tags: raw.tags ?? [],
    url: raw.url,
    postedAt: new Date(raw.publication_date),
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class RemotiveProvider implements JobBoardProvider {
  readonly name = 'remotive';

  constructor(private readonly config: ProviderConfig = {}) {}

  async search(params: SearchParams): Promise<JobSearchResult> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;

    // Build one request per relevant IT category to get broad coverage,
    // or a targeted keyword search if query is provided.
    const qs = new URLSearchParams({
      limit: '100',  // Fetch a larger batch, then paginate client-side
    });

    if (params.query) qs.set('search', params.query);

    // If no query, use IT categories to stay focused
    const targetCategory =
      IT_CATEGORIES.find((c) =>
        params.tags?.some((t) => c.includes(t.toLowerCase())),
      ) ?? 'software-dev';

    if (!params.query) qs.set('category', targetCategory);

    const url = `https://remotive.com/api/remote-jobs?${qs}`;

    try {
      const data = await fetchJSON<RemotiveResponse>(url, {}, this.config.timeoutMs);

      let jobs = data.jobs.map((j) => mapJob(j, this.name));

      // Client-side filtering
      if (params.type) {
        jobs = jobs.filter((j) => j.type === params.type);
      }
      if (params.location) {
        const loc = params.location.toLowerCase();
        jobs = jobs.filter((j) => j.location.toLowerCase().includes(loc));
      }

      // Client-side pagination
      const start = (page - 1) * pageSize;
      const paginated = jobs.slice(start, start + pageSize);

      return {
        jobs: paginated,
        total: jobs.length,
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
