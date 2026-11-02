import { describe, it, expect, vi, beforeEach } from 'vitest';

const serverFetch = vi.fn();
vi.mock('../server-fetch', () => ({ serverFetch: (...args: unknown[]) => serverFetch(...args) }));

import { getLandingStatsServer, LANDING_STATS_BASELINE, toLandingStats } from '../stats';

/**
 * The landing figures are baseline + live count. The API never pads; this
 * module is the one place the baseline is added, so its arithmetic and its
 * fallback are what the test pins.
 */
describe('landing stats', () => {
  beforeEach(() => {
    serverFetch.mockReset();
  });

  it('starts from 2000+ workers, 10+ employers and 50+ countries', () => {
    expect(LANDING_STATS_BASELINE).toEqual({ workers: 2000, employers: 10, countries: 50 });
  });

  it('adds the live counts on top of the baseline', () => {
    expect(toLandingStats({ candidates: 34, companies: 3, countries: 2 })).toEqual({
      workers: 2034,
      employers: 13,
      countries: 52,
    });
  });

  it('fetches GET /stats and composes the figures', async () => {
    serverFetch.mockResolvedValue({ data: { candidates: 5, companies: 1, countries: 4 } });
    await expect(getLandingStatsServer()).resolves.toEqual({
      workers: 2005,
      employers: 11,
      countries: 54,
    });
    expect(serverFetch).toHaveBeenCalledWith('/stats', expect.anything());
  });

  it('falls back to the baseline alone when the API is down — never throws', async () => {
    serverFetch.mockImplementation(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(getLandingStatsServer()).resolves.toEqual(LANDING_STATS_BASELINE);
  });
});
