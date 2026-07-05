import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch, apiFetchRaw } from './client';
import { serverFetch } from './server-fetch';
import { buildJobSearchQuery, type JobSearchFilters } from '@/lib/jobs/searchParams';

export type JobCard = components['schemas']['JobCard'];
export type JobDetail = components['schemas']['JobDetail'];

export interface JobSearchResult {
  data: JobCard[];
  nextCursor: string | null;
}

/** SSR-only: first page of search results, fetched during Server Component render. */
export async function searchJobsServer(
  filters: JobSearchFilters,
  opts?: { limit?: number },
): Promise<JobSearchResult> {
  const qs = buildJobSearchQuery(filters, { limit: opts?.limit });
  return serverFetch<JobSearchResult>(`/jobs${qs ? `?${qs}` : ''}`);
}

/** SSR-only: single job detail. Throws ServerApiError (status 404) for unknown/inactive ids. */
export async function getJobServer(id: string): Promise<JobDetail> {
  const result = await serverFetch<{ data: JobDetail }>(`/jobs/${encodeURIComponent(id)}`);
  return result.data;
}

/** Client-side: subsequent pages for JobList's "Load more". */
export async function searchJobsClient(
  filters: JobSearchFilters,
  opts: { cursor?: string | null; limit?: number },
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
