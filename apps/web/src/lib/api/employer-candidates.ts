import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch, apiFetchRaw } from '@/lib/api/client';
import { buildCandidateQuery, type CandidateBrowseFilters } from '@/lib/employer/candidateFilters';

export type CandidateBrowseCard = components['schemas']['CandidateBrowseCard'];
export type CandidateEmployerView = components['schemas']['CandidateEmployerView'];

export interface CandidateBrowseResult {
  data: CandidateBrowseCard[];
  nextCursor: string | null;
}

/**
 * Cursor-paginated candidate browse (GET /employers/candidates).
 * `profileVisible = false` candidates are excluded server-side and never appear.
 * Uses apiFetchRaw so the `{ data, nextCursor }` envelope is preserved.
 */
export function browseCandidates(
  filters: CandidateBrowseFilters,
  opts?: { cursor?: string | null; limit?: number },
): Promise<CandidateBrowseResult> {
  const qs = buildCandidateQuery(filters, opts);
  return apiFetchRaw<CandidateBrowseResult>(`/employers/candidates${qs ? `?${qs}` : ''}`);
}

/**
 * Employer-context view of a single candidate (GET /employers/candidates/{id}).
 *
 * The GET is the ONLY request this makes — the server records the profile view
 * as a side effect. The frontend adds no tracking call/beacon (that would
 * double-count and break the server's per-(company, candidate) dedup).
 *
 * A hidden (`profileVisible = false`) or nonexistent candidate returns an
 * identical 404 (`ApiRequestError`, status 404) — indistinguishable by design.
 */
export function getCandidate(id: string): Promise<CandidateEmployerView> {
  return apiFetch<CandidateEmployerView>(`/employers/candidates/${encodeURIComponent(id)}`);
}
