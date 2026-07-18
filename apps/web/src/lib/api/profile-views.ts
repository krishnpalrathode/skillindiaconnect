import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch } from './client';

export type ProfileViewsSummary = components['schemas']['ProfileViewsSummary'];

/**
 * Candidate profile-view analytics (GET /candidates/me/profile-views).
 *
 * Frozen S3 shape: `{ total, last30Days, recentViews[] }`. `recentViews` carries
 * only `{ companyName, viewedAt }` — the company NAME is the entire viewer
 * identity surfaced to candidates (no ids, logos, or employer-profile links).
 */
export function getProfileViews(): Promise<ProfileViewsSummary> {
  return apiFetch<ProfileViewsSummary>('/candidates/me/profile-views');
}
