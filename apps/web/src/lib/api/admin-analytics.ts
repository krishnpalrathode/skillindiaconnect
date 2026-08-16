import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch } from './client';

export type AdminAnalytics = components['schemas']['AdminAnalytics'];
export type AnalyticsKpi = components['schemas']['AnalyticsKpi'];
export type AnalyticsSeriesPoint = components['schemas']['AnalyticsSeriesPoint'];
export type AnalyticsFunnelStage = components['schemas']['AnalyticsFunnelStage'];
export type AnalyticsBucket = components['schemas']['AnalyticsBucket'];

/** The windows the dashboard's range control offers. */
export const ANALYTICS_RANGES = [7, 30, 90, 365] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

/**
 * Dashboard analytics for a trailing window (RBAC: reports.view).
 *
 * The server clamps `days`, so an out-of-range value from a hand-edited URL
 * still renders a dashboard.
 */
export function getAdminAnalytics(days: number): Promise<AdminAnalytics> {
  return apiFetch<AdminAnalytics>(`/admin/analytics?days=${days}`);
}
