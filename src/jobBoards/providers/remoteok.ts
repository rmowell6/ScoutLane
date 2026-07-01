// @ts-nocheck -- vendored job-board module (kept as delivered; integration code is strict)
// ─────────────────────────────────────────────────────────────────────────────
// ScoutLane, RemoteOK Provider
// Docs: https://remoteok.com/api (unofficial but stable public JSON endpoint)
// Auth: None, public JSON feed
// Rate limit: Reasonable use; CORS enabled
// ToS note: Must link back to RemoteOK job URL with no redirects
// Coverage: Remote tech roles globally, salary data, skill tags
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
  stripHtml,
  DEFAULT_PAGE_SIZE,
} from './base';

// ---------------------------------------------------------------------------
// RemoteOK API response types
// ---------------------------------------------------------------------------

// First element is a metadata object, rest are jobs
type RemoteOKResponse = [RemoteOKMeta, ...RemoteOKJob[]];

interface RemoteOKMeta {
  legal: string;
}

interface RemoteOKJob {
  id: string;
  epoch: number;        // Unix timestamp
  date: string;
  url: string;
  apply_url?: string;
  company: string;
  company_logo?: string;
  position: string;     // Job title
  tags: string[];
  location: string;
  salary_min?: number;
  salary_max?: number;
  description?: string;
  type?: string;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function mapJob(raw: RemoteOKJob, source: string): Job {
  const salary =
    raw.salary_min || raw.salary_max
      ? {
          min: raw.salary_min,
          max: raw.salary_max,
          currency: 'USD',
          period: 'annual' as const,
        }
      : undefined;

  return {
    id: buildId(source, raw.id),
    source,
    title: raw.position,
    company: raw.company,
    companyLogo: raw.company_logo
      ? `https://remoteok.com${raw.company_logo}`
      : undefined,
    location: raw.location || 'Remote',
    remote: true,  // RemoteOK is remote-only
    type: normaliseJobType(raw.type),
    salary,
    description: raw.description ? stripHtml(raw.description) : '',
    tags: raw.tags ?? [],
    url: raw.url,
    applyUrl: raw.apply_url,
    postedAt: new Date(raw.epoch * 1000),
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class RemoteOKProvider implements JobBoardProvider {
  readonly name = 'remoteok';

  constructor(private readonly config: ProviderConfig = {}) {}

  async search(params: SearchParams): Promise<JobSearchResult> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;

    // RemoteOK's API returns all jobs; filter/tag-search via URL path
    // e.g. /api?tag=typescript
    const qs = new URLSearchParams();
    if (params.tags?.length) qs.set('tag', params.tags[0]);  // Primary tag

    const url = `https://remoteok.com/api${qs.toString() ? '?' + qs : ''}`;

    try {
      const raw = await fetchJSON<RemoteOKResponse>(
        url,
        {
          headers: {
            // RemoteOK requires a User-Agent
            'User-Agent': 'ScoutLane Job Aggregator (https://scoutlane.app)',
          },
        },
        this.config.timeoutMs,
      );

      // Skip first element (metadata object)
      const jobItems = raw.slice(1) as RemoteOKJob[];

      let jobs = jobItems.map((j) => mapJob(j, this.name));

      // Client-side keyword filter
      if (params.query) {
        const q = params.query.toLowerCase();
        jobs = jobs.filter(
          (j) =>
            j.title.toLowerCase().includes(q) ||
            j.company.toLowerCase().includes(q) ||
            j.tags.some((t) => t.toLowerCase().includes(q)),
        );
      }

      // Client-side type filter
      if (params.type) {
        jobs = jobs.filter((j) => j.type === params.type);
      }

      // Client-side salary filter
      if (params.salaryMin) {
        jobs = jobs.filter(
          (j) => !j.salary || (j.salary.min ?? 0) >= (params.salaryMin ?? 0),
        );
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
