import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch, apiFetchRaw } from '@/lib/api/client';
import type { PaginatedResult } from '@/lib/api/pagination';

type ApplicationCard = components['schemas']['ApplicationCard'];
type ApplicationDetail = components['schemas']['ApplicationDetail'];
type ApplicationStatus = components['schemas']['ApplicationStatus'];

export type ApplicationsPage = PaginatedResult<ApplicationCard>;

/**
 * Candidate's applications feed (offset-paginated, newest first). Uses
 * `apiFetchRaw` because we need the envelope's `meta` alongside `data`
 * (apiFetch unwraps to `data` only).
 */
export function listMyApplications(params?: {
  status?: ApplicationStatus;
  page?: number;
  pageSize?: number;
}): Promise<ApplicationsPage> {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.page && params.page > 1) q.set('page', String(params.page));
  if (params?.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString();
  return apiFetchRaw<ApplicationsPage>(`/candidates/me/applications${qs ? `?${qs}` : ''}`);
}

/** One application + the SHAPED timeline (no overrideReason, no actor identity). */
export function getMyApplication(id: string): Promise<ApplicationDetail> {
  return apiFetch<ApplicationDetail>(`/candidates/me/applications/${id}`);
}
