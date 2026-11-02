import type { paths } from '@skillindiaconnect/shared-types';
import { serverFetch } from './server-fetch';

/** Raw, measured counts from GET /stats. */
export type PublicStats =
  paths['/stats']['get']['responses']['200']['content']['application/json']['data'];

/** What the landing stats bar renders: baseline + live count. */
export interface LandingStats {
  workers: number;
  employers: number;
  countries: number;
}

/**
 * ⚠️ EDITORIAL BASELINE — set by the product owner, NOT measured. ⚠️
 *
 * The landing figures are this baseline PLUS the live count from the API, so
 * every candidate, approved company or new job country moves the number up
 * from here. The API itself only ever reports what it measured; the padding
 * lives in this one place so it stays obvious and is a one-line edit.
 */
export const LANDING_STATS_BASELINE: LandingStats = {
  workers: 2000,
  employers: 10,
  countries: 50,
};

/** How long the landing page's copy of the counts may be stale, in seconds. */
const LANDING_STATS_REVALIDATE = 60;

/** Baseline + live counts. A missing live figure contributes nothing. */
export function toLandingStats(live: PublicStats | null): LandingStats {
  return {
    workers: LANDING_STATS_BASELINE.workers + (live?.candidates ?? 0),
    employers: LANDING_STATS_BASELINE.employers + (live?.companies ?? 0),
    countries: LANDING_STATS_BASELINE.countries + (live?.countries ?? 0),
  };
}

/**
 * SSR-only: the landing stats bar figures.
 *
 * Never throws — like the landing job list, the front door must render with
 * the API down. On failure it falls back to the baseline alone.
 */
export async function getLandingStatsServer(): Promise<LandingStats> {
  try {
    const result = await serverFetch<{ data: PublicStats }>('/stats', {
      revalidate: LANDING_STATS_REVALIDATE,
    });
    return toLandingStats(result.data ?? null);
  } catch {
    return toLandingStats(null);
  }
}
