import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch, apiFetchRaw } from '@/lib/api/client';

type ApplicationCard = components['schemas']['ApplicationCard'];
type ApplicationDetail = components['schemas']['ApplicationDetail'];
type ApplicationStatus = components['schemas']['ApplicationStatus'];

export interface ApplicationsPage {
  data: ApplicationCard[];
  nextCursor: string | null;
}

/**
 * Candidate's applications feed (cursor-paginated, newest first). Uses
 * `apiFetchRaw` because we need the envelope's `nextCursor` alongside `data`
 * (apiFetch unwraps to `data` only).
 */
export function listMyApplications(params?: {
  status?: ApplicationStatus;
  cursor?: string;
  limit?: number;
}): Promise<ApplicationsPage> {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.cursor) q.set('cursor', params.cursor);
  if (params?.limit) q.set('limit', String(params.limit));
  const qs = q.toString();
  return apiFetchRaw<ApplicationsPage>(`/candidates/me/applications${qs ? `?${qs}` : ''}`);
}

/** One application + the SHAPED timeline (no overrideReason, no actor identity). */
export function getMyApplication(id: string): Promise<ApplicationDetail> {
  return apiFetch<ApplicationDetail>(`/candidates/me/applications/${id}`);
}
