import { apiFetch, apiFetchRaw } from '@/lib/api/client';
import type { PaginatedResult } from '@/lib/api/pagination';
import type { CandidateBrowseCard } from '@/lib/api/employer-candidates';

/** A browse card plus this employer's outreach state for that candidate. */
export interface InterestedCandidate extends CandidateBrowseCard {
  interestedAt: string;
  notifiedAt: string | null;
}

export type InterestedResult = PaginatedResult<InterestedCandidate>;

/** POST /employers/candidates/{id}/interest — idempotent. */
export function markInterest(candidateId: string): Promise<{ interestedAt: string }> {
  return apiFetch(`/employers/candidates/${candidateId}/interest`, { method: 'POST' });
}

/** DELETE /employers/candidates/{id}/interest — idempotent (never 404s). */
export async function removeInterest(candidateId: string): Promise<void> {
  await apiFetch(`/employers/candidates/${candidateId}/interest`, { method: 'DELETE' });
}

/**
 * GET /employers/interested-candidates
 *
 * NOT `/employers/candidates/interested` — that path is swallowed by the
 * `candidates/:id` route and 400s as a malformed UUID.
 */
export function listInterested(params?: {
  page?: number;
  pageSize?: number;
  notified?: boolean;
}): Promise<InterestedResult> {
  const q = new URLSearchParams();
  if (params?.page && params.page > 1) q.set('page', String(params.page));
  if (params?.pageSize) q.set('pageSize', String(params.pageSize));
  if (params?.notified !== undefined) q.set('notified', String(params.notified));
  const qs = q.toString();
  return apiFetchRaw<InterestedResult>(`/employers/interested-candidates${qs ? `?${qs}` : ''}`);
}

/**
 * POST /employers/interested-candidates/notify
 *
 * `skipped` counts candidates this company has ALREADY contacted — the server
 * refuses to message the same person twice, and reports it rather than
 * pretending the send happened.
 */
export function notifyInterested(
  candidateIds: string[],
): Promise<{ queued: number; skipped: number }> {
  return apiFetch('/employers/interested-candidates/notify', {
    method: 'POST',
    body: JSON.stringify({ candidateIds }),
  });
}
