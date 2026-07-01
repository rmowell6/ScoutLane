// @ts-nocheck -- vendored job-board module (kept as delivered; integration code is strict)
// ─────────────────────────────────────────────────────────────────────────────
// ScoutLane, Apify Provider (Dice + Wellfound)
//
// Uses the official Apify JavaScript client, which handles smart polling,
// exponential back-off, and automatic dataset retrieval.
//
// Install:  npm install apify-client
// Ref:      https://docs.apify.com/api/client/js/docs
//           https://docs.apify.com/academy/api/run-actor-and-retrieve-data-via-api
//
// Free tier: $5/month platform credit (no credit card required).
//            At ~$0.20/CU and ~0.1 CU/typical run that's ≈50 runs/month free.
//            Pay-per-result actors cost extra, see Pricing tab of each actor.
//
// Default actors used (configurable):
//   Dice    → worldunboxer/dice-jobs-scraper
//             (4.4★, 2,274 users, ~$0.004/result, lowest cost rated actor)
//             Ref: https://apify.com/worldunboxer/dice-jobs-scraper
//   Wellfound → memo23/wellfound-jobs-scraper
//             ($0.99 flat per run, not pay-per-result, best value for free tier)
//             Ref: https://apify.com/memo23/wellfound-jobs-scraper
// ─────────────────────────────────────────────────────────────────────────────

import { ApifyClient } from 'apify-client';
import type {
  Job,
  JobBoardProvider,
  JobSearchResult,
  SearchParams,
  ProviderConfig,
} from '../types';
import {
  buildId,
  normaliseJobType,
  parseSalaryString,
  stripHtml,
  DEFAULT_PAGE_SIZE,
} from './base';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ApifyProviderConfig extends ProviderConfig {
  /** Apify API token, https://console.apify.com/settings/integrations */
  apiToken: string;
  /**
   * Dice.com actor ID on Apify Store.
   * Default: 'worldunboxer~dice-jobs-scraper' (highest-rated, low cost)
   * Ref: https://apify.com/worldunboxer/dice-jobs-scraper
   */
  diceActorId?: string;
  /**
   * Wellfound actor ID on Apify Store.
   * Default: 'memo23~wellfound-jobs-scraper' ($0.99/run flat, free-tier friendly)
   * Ref: https://apify.com/memo23/wellfound-jobs-scraper
   */
  wellfoundActorId?: string;
  /**
   * Max ms to wait for an actor run. Apify sync endpoint caps at 300s.
   * Default: 120_000 (2 minutes)
   */
  actorTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Dice.com output schema
// (worldunboxer/dice-jobs-scraper)
// ---------------------------------------------------------------------------

interface DiceJob {
  jobId?: string;
  id?: string;
  jobTitle?: string;
  title?: string;
  companyName?: string;
  company?: string;
  employmentType?: string;
  employerType?: string;
  workplaceTypes?: string[];
  location?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  postedDate?: string;
  date?: string;
  salary?: string;
  compensationModel?: string;
  skills?: string[];
  shortDescription?: string;
  description?: string;
  jobDetailUrl?: string;
  applyUrl?: string;
  url?: string;
}

function mapDiceJob(raw: DiceJob): Job {
  const id = raw.jobId ?? raw.id ?? String(Date.now());
  const title = raw.jobTitle ?? raw.title ?? 'Unknown';
  const company = raw.companyName ?? raw.company ?? 'Unknown';

  const workplaceTypes = (raw.workplaceTypes ?? []).map((s) => s.toLowerCase());
  const isRemote =
    workplaceTypes.includes('remote') ||
    workplaceTypes.includes('fully remote') ||
    (raw.location ?? '').toLowerCase().includes('remote');

  const locationParts = [raw.location ?? raw.city, raw.state]
    .filter(Boolean)
    .join(', ');

  const salary = parseSalaryString(raw.salary ?? raw.compensationModel);

  const url = raw.jobDetailUrl ?? raw.applyUrl ?? raw.url ?? `https://www.dice.com/jobs/${id}`;

  return {
    id: buildId('dice', id),
    source: 'dice',
    title,
    company,
    location: locationParts || (isRemote ? 'Remote' : 'United States'),
    remote: isRemote,
    type: normaliseJobType(raw.employmentType ?? raw.employerType),
    salary,
    description: stripHtml(raw.shortDescription ?? raw.description ?? ''),
    tags: raw.skills ?? [],
    url,
    applyUrl: raw.applyUrl,
    postedAt: new Date(raw.postedDate ?? raw.date ?? Date.now()),
  };
}

// ---------------------------------------------------------------------------
// Wellfound output schema
// (memo23/wellfound-jobs-scraper)
// ---------------------------------------------------------------------------

interface WellfoundJob {
  id?: string | number;
  title?: string;
  jobTitle?: string;
  company?: string;
  companyName?: string;
  location?: string;
  locationName?: string;
  remote?: boolean;
  remoteOk?: boolean;
  jobType?: string;
  employmentType?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryRange?: string;
  equity?: string;
  tags?: string[];
  skills?: string[];
  description?: string;
  url?: string;
  jobUrl?: string;
  postedAt?: string;
  createdAt?: string;
}

function mapWellfoundJob(raw: WellfoundJob): Job {
  const id = String(raw.id ?? Date.now());
  const title = raw.title ?? raw.jobTitle ?? 'Unknown';
  const company = raw.company ?? raw.companyName ?? 'Unknown';
  const isRemote = raw.remote ?? raw.remoteOk ?? false;
  const location = raw.location ?? raw.locationName ?? (isRemote ? 'Remote' : 'Unknown');

  const salary =
    raw.salaryMin || raw.salaryMax
      ? {
          min: raw.salaryMin,
          max: raw.salaryMax,
          currency: 'USD',
          period: 'annual' as const,
        }
      : parseSalaryString(raw.salaryRange);

  const url = raw.url ?? raw.jobUrl ?? `https://wellfound.com/jobs/${id}`;

  return {
    id: buildId('wellfound', id),
    source: 'wellfound',
    title,
    company,
    location,
    remote: isRemote,
    type: normaliseJobType(raw.jobType ?? raw.employmentType),
    salary,
    description: stripHtml(raw.description ?? ''),
    tags: [...(raw.tags ?? []), ...(raw.skills ?? [])],
    url,
    postedAt: new Date(raw.postedAt ?? raw.createdAt ?? Date.now()),
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class ApifyProvider implements JobBoardProvider {
  readonly name = 'apify';

  private readonly client: ApifyClient;
  private readonly diceActorId: string;
  private readonly wellfoundActorId: string;
  private readonly actorTimeoutMs: number;

  constructor(config: ApifyProviderConfig) {
    this.client = new ApifyClient({ token: config.apiToken });
    this.diceActorId = config.diceActorId ?? 'worldunboxer~dice-jobs-scraper';
    this.wellfoundActorId = config.wellfoundActorId ?? 'memo23~wellfound-jobs-scraper';
    this.actorTimeoutMs = config.actorTimeoutMs ?? 120_000;
  }

  async search(params: SearchParams): Promise<JobSearchResult> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;

    // Run both actors in parallel for speed
    const [diceResult, wellfoundResult] = await Promise.allSettled([
      this.searchDice(params),
      this.searchWellfound(params),
    ]);

    const jobs: Job[] = [];
    const errors: string[] = [];

    if (diceResult.status === 'fulfilled') {
      jobs.push(...diceResult.value);
    } else {
      errors.push(`Dice: ${diceResult.reason instanceof Error ? diceResult.reason.message : String(diceResult.reason)}`);
    }

    if (wellfoundResult.status === 'fulfilled') {
      jobs.push(...wellfoundResult.value);
    } else {
      errors.push(`Wellfound: ${wellfoundResult.reason instanceof Error ? wellfoundResult.reason.message : String(wellfoundResult.reason)}`);
    }

    // Sort newest first, paginate
    jobs.sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());
    const start = (page - 1) * pageSize;
    const paginated = jobs.slice(start, start + pageSize);

    return {
      jobs: paginated,
      total: jobs.length,
      page,
      pageSize,
      source: this.name,
      error: errors.length > 0 ? errors.join(' | ') : undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // Dice
  // Ref: https://apify.com/worldunboxer/dice-jobs-scraper
  // ---------------------------------------------------------------------------

  private async searchDice(params: SearchParams): Promise<Job[]> {
    // worldunboxer/dice-jobs-scraper input schema (keyword is required).
    const input: Record<string, unknown> = {
      keyword: params.query ?? 'software engineer',
      job_entries: Math.min(params.pageSize ?? DEFAULT_PAGE_SIZE, 100),
      posted_date: 'ANY',
      easy_apply: false,
      willing_to_sponsor: false,
    };
    // location + radius only make sense together; omit for a national search.
    if (params.location) {
      input.location = params.location;
      input.radius = 50;
      input.unit = 'mi';
    }
    if (params.remote) input.work_settings = ['Remote'];
    if (params.type === 'contract') input.employment_type = ['CONTRACTS'];
    else if (params.type === 'part-time') input.employment_type = ['PARTTIME'];

    const run = await this.client
      .actor(this.diceActorId)
      .call(input, { timeout: Math.floor(this.actorTimeoutMs / 1000), waitSecs: Math.floor(this.actorTimeoutMs / 1000) });

    const { items } = await this.client
      .dataset(run.defaultDatasetId)
      .listItems();

    return (items as DiceJob[]).map(mapDiceJob);
  }

  // ---------------------------------------------------------------------------
  // Wellfound
  // Ref: https://apify.com/memo23/wellfound-jobs-scraper
  // ---------------------------------------------------------------------------

  private async searchWellfound(params: SearchParams): Promise<Job[]> {
    // memo23/wellfound-jobs-scraper input schema: it scrapes from startUrls (Wellfound job pages),
    // with a US residential proxy. Wellfound is startup/tech-dense, so the base /jobs feed is on-target.
    const input: Record<string, unknown> = {
      startUrls: ['https://wellfound.com/jobs'],
      enrichCompanyProfile: false,
      enrichEmails: false,
      enrichJobDetail: false,
      proxy: {
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL'],
        apifyProxyCountry: 'US',
      },
    };

    const run = await this.client
      .actor(this.wellfoundActorId)
      .call(input, { timeout: Math.floor(this.actorTimeoutMs / 1000), waitSecs: Math.floor(this.actorTimeoutMs / 1000) });

    const { items } = await this.client
      .dataset(run.defaultDatasetId)
      .listItems();

    return (items as WellfoundJob[]).map(mapWellfoundJob);
  }
}
