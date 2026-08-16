import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch, apiFetchRaw } from './client';
import { serverFetch } from './server-fetch';
import { buildJobSearchQuery, type JobSearchFilters } from '@/lib/jobs/searchParams';
import type { PaginatedResult } from './pagination';

export type JobCard = components['schemas']['JobCard'];
export type JobDetail = components['schemas']['JobDetail'];

export type JobSearchResult = PaginatedResult<JobCard>;

/** SSR-only: first page of search results, fetched during Server Component render. */
export async function searchJobsServer(
  filters: JobSearchFilters,
  opts?: { page?: number; pageSize?: number },
): Promise<JobSearchResult> {
  const qs = buildJobSearchQuery(filters, { page: opts?.page, pageSize: opts?.pageSize });
  return serverFetch<JobSearchResult>(`/jobs${qs ? `?${qs}` : ''}`);
}

/** How many jobs the landing page shows. Cited by the fetch and by its test. */
export const LANDING_JOBS_COUNT = 10;

/** How long the landing page's copy of that list may be stale, in seconds. */
const LANDING_JOBS_REVALIDATE = 60;

/**
 * SSR-only: the newest ACTIVE jobs, for the PUBLIC landing page.
 *
 * Never throws. The landing page is the front door — for most visitors it is
 * the only page they will ever see — so it must render with the API down. A
 * failure here yields an empty list and the section removes itself; it must
 * never turn a marketing page into a 500.
 *
 * Unauthenticated by design: `GET /jobs` is `@Public()`, so this is the same
 * data a search-engine crawler sees. That matters commercially — server-rendered
 * job titles and salaries are what makes these listings indexable, and organic
 * search is how a job board actually acquires candidates.
 */
export async function getLandingJobsServer(): Promise<JobCard[]> {
  try {
    const result = await serverFetch<JobSearchResult>(
      `/jobs?sort=recent&pageSize=${LANDING_JOBS_COUNT}`,
      { revalidate: LANDING_JOBS_REVALIDATE },
    );
    return result.data ?? [];
  } catch {
    return [];
  }
}

export interface JobCountryFacet {
  country: string;
  count: number;
}

/**
 * SSR-only: the countries that currently have ACTIVE jobs.
 *
 * Drives the search's country filter. Fetched server-side alongside the first
 * page so the filter renders with the list already populated rather than
 * appearing a moment later.
 */
export async function getJobCountriesServer(): Promise<JobCountryFacet[]> {
  const result = await serverFetch<{ data: JobCountryFacet[] }>('/jobs/countries');
  return result.data;
}

/** SSR-only: single job detail. Throws ServerApiError (status 404) for unknown/inactive ids. */
export async function getJobServer(id: string): Promise<JobDetail> {
  const result = await serverFetch<{ data: JobDetail }>(`/jobs/${encodeURIComponent(id)}`);
  return result.data;
}

/**
 * Client-side single job detail (public GET /jobs/:id). Used by the employer
 * applicants page for the job title + market (the popover's foreign-on-LOCAL note).
 */
export async function getJobClient(id: string): Promise<JobDetail> {
  return apiFetch<JobDetail>(`/jobs/${encodeURIComponent(id)}`);
}

/** Client-side: a page of search results for JobList's pager. */
export async function searchJobsClient(
  filters: JobSearchFilters,
  opts: { page?: number; pageSize?: number },
): Promise<JobSearchResult> {
  const qs = buildJobSearchQuery(filters, opts);
  return apiFetchRaw<JobSearchResult>(`/jobs${qs ? `?${qs}` : ''}`);
}

export async function saveJob(id: string): Promise<{ saved: boolean }> {
  return apiFetch<{ saved: boolean }>(`/jobs/${encodeURIComponent(id)}/save`, { method: 'POST' });
}

export async function unsaveJob(id: string): Promise<void> {
  await apiFetch<undefined>(`/jobs/${encodeURIComponent(id)}/save`, { method: 'DELETE' });
}
