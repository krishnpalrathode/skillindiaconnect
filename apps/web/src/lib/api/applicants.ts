import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch, apiFetchRaw } from '@/lib/api/client';
import type { PaginatedResult } from '@/lib/api/pagination';

type ApplicantCard = components['schemas']['ApplicantCard'];
type ApplicantCounts = components['schemas']['ApplicantCounts'];
type Application = components['schemas']['Application'];
type ApplicationStatus = components['schemas']['ApplicationStatus'];

export type ApplicantSort = 'match' | 'recent';

export interface ApplicantsPage extends PaginatedResult<ApplicantCard> {
  counts: ApplicantCounts;
}

/**
 * A job's applicants (offset-paginated). `apiFetchRaw` because we need the
 * envelope's `meta` AND `counts` (the status-tab headers) alongside `data`.
 */
export function listApplicants(
  jobId: string,
  params?: { status?: ApplicationStatus; sort?: ApplicantSort; page?: number; pageSize?: number },
): Promise<ApplicantsPage> {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.sort) q.set('sort', params.sort);
  if (params?.page && params.page > 1) q.set('page', String(params.page));
  if (params?.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString();
  return apiFetchRaw<ApplicantsPage>(`/jobs/${jobId}/applicants${qs ? `?${qs}` : ''}`);
}

/**
 * Employer forward-only status change. Resolves to the updated Application (with
 * `selectedNotifiedAt` after a first SELECTED). Rejects with ApiRequestError —
 * notably 422 `ILLEGAL_TRANSITION` (meta.allowed[]) when the state is stale (a
 * concurrent admin move) → the caller rolls back + reconciles.
 */
export function transitionApplication(
  applicationId: string,
  body: { status: ApplicationStatus; rejectionFeedback?: string },
): Promise<Application> {
  return apiFetch<Application>(`/applications/${applicationId}/status`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}
