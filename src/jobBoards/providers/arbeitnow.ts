// @ts-nocheck -- vendored job-board module (kept as delivered; integration code is strict)
// ─────────────────────────────────────────────────────────────────────────────
// ScoutLane, Arbeitnow Provider
// Docs: https://www.arbeitnow.com/blog/job-board-api
// Auth: None, fully public
// Coverage: Europe + Remote, heavily IT-focused
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
// Arbeitnow API response types
// ---------------------------------------------------------------------------

interface ArbeitnowResponse {
  data: ArbeitnowJob[];
  links: { next?: string };
  meta: { current_page: number; total: number };
}

interface ArbeitnowJob {
  slug: string;
  company_name: string;
  title: string;
  description: string;
  remote: boolean;
  url: string;
  tags: string[];
  job_types: string[];
  location: string;
  created_at: number;   // Unix timestamp
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function mapJob(raw: ArbeitnowJob, source: string): Job {
  return {
    id: buildId(source, raw.slug),
    source,
    title: raw.title,
    company: raw.company_name,
    location: raw.location || (raw.remote ? 'Remote' : 'Unknown'),
    remote: raw.remote,
    type: normaliseJobType(raw.job_types?.[0]),
    description: stripHtml(raw.description),
    tags: raw.tags ?? [],
    url: raw.url,
    postedAt: new Date(raw.created_at * 1000),
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class ArbeitnowProvider implements JobBoardProvider {
  readonly name = 'arbeitnow';

  constructor(private readonly config: ProviderConfig = {}) {}

  async search(params: SearchParams): Promise<JobSearchResult> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;

    const qs = new URLSearchParams({ page: String(page) });
    if (params.remote) qs.set('remote', 'true');
    if (params.query) qs.set('q', params.query);
    if (params.tags?.length) qs.set('tags', params.tags.join(','));

    const url = `https://www.arbeitnow.com/api/job-board-api?${qs}`;

    try {
      const data = await fetchJSON<ArbeitnowResponse>(url, {}, this.config.timeoutMs);

      // Arbeitnow returns 20 jobs/page by default; filter client-side if needed
      let jobs = data.data.map((j) => mapJob(j, this.name));

      // Client-side keyword filter (API doesn't support keyword search natively)
      if (params.query) {
        const q = params.query.toLowerCase();
        jobs = jobs.filter(
          (j) =>
            j.title.toLowerCase().includes(q) ||
            j.description.toLowerCase().includes(q) ||
            j.tags.some((t) => t.toLowerCase().includes(q)),
        );
      }

      return {
        jobs: jobs.slice(0, pageSize),
        total: data.meta.total,
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
