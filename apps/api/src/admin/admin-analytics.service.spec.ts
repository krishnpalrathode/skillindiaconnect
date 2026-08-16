import { buildFunnel, clampDays, dateRange, kpi, zeroFill } from './admin-analytics.service';

describe('clampDays', () => {
  it('defaults to 30 for a missing or unparseable value', () => {
    expect(clampDays(undefined)).toBe(30);
    expect(clampDays(Number.NaN)).toBe(30);
  });

  // An odd query string should render a dashboard, not 400 an admin out of their
  // own overview — so the range is clamped rather than rejected.
  it('clamps rather than rejecting an out-of-range window', () => {
    expect(clampDays(0)).toBe(1);
    expect(clampDays(-90)).toBe(1);
    expect(clampDays(100_000)).toBe(365);
  });
});

describe('dateRange', () => {
  it('emits one YYYY-MM-DD per day, in order', () => {
    const from = new Date(Date.UTC(2026, 7, 14));
    expect(dateRange(from, 3)).toEqual(['2026-08-14', '2026-08-15', '2026-08-16']);
  });

  it('crosses a month boundary correctly', () => {
    const from = new Date(Date.UTC(2026, 6, 31));
    expect(dateRange(from, 2)).toEqual(['2026-07-31', '2026-08-01']);
  });
});

describe('zeroFill', () => {
  /**
   * The point of the whole function: a day with no rows produces no row, and a
   * line drawn straight across the gap claims steady activity through a week
   * that was actually dead.
   */
  it('inserts explicit zeros for days the query returned nothing for', () => {
    const dates = ['2026-08-14', '2026-08-15', '2026-08-16'];
    const rows = [{ date: '2026-08-16', registered: 4 }];
    expect(zeroFill(dates, rows, ['registered'])).toEqual([
      { date: '2026-08-14', registered: 0 },
      { date: '2026-08-15', registered: 0 },
      { date: '2026-08-16', registered: 4 },
    ]);
  });

  it('keeps the axis even when the query returns nothing at all', () => {
    expect(zeroFill(['2026-08-16'], [], ['created', 'published'])).toEqual([
      { date: '2026-08-16', created: 0, published: 0 },
    ]);
  });
});

describe('kpi', () => {
  it('computes a signed percentage change against the previous window', () => {
    expect(kpi(150, 100, []).deltaPct).toBe(50);
    expect(kpi(50, 100, []).deltaPct).toBe(-50);
  });

  // Growth from nothing has no rate. Reporting 100% (or ∞) would be a number the
  // UI could not defend, so the tile is told there isn't one.
  it('reports NO rate when the previous window was zero', () => {
    expect(kpi(9, 0, []).deltaPct).toBeNull();
    expect(kpi(0, 0, []).deltaPct).toBeNull();
  });
});

describe('buildFunnel', () => {
  it('computes share-of-top and stage-to-stage conversion', () => {
    const out = buildFunnel([
      { stage: 'applied', count: 200 },
      { stage: 'shortlisted', count: 50 },
      { stage: 'selected', count: 25 },
    ]);
    expect(out.map((s) => s.pctOfTop)).toEqual([100, 25, 12.5]);
    expect(out.map((s) => s.conversionFromPrev)).toEqual([null, 25, 50]);
  });

  /**
   * The bug this pins down: counting each stage by CURRENT status made the funnel
   * non-monotonic (an application that reached SELECTED stopped counting as
   * SHORTLISTED), so `selected` exceeded `shortlisted` and the dashboard printed
   * a 109.4% conversion. The service now feeds cohort counts; this asserts the
   * shape those counts must have.
   */
  it('never reports a conversion above 100% for a monotonic cohort', () => {
    const out = buildFunnel([
      { stage: 'applied', count: 2575 },
      { stage: 'shortlisted', count: 223 },
      { stage: 'selected', count: 117 },
    ]);
    for (const s of out) {
      expect(s.pctOfTop).toBeLessThanOrEqual(100);
      if (s.conversionFromPrev !== null) expect(s.conversionFromPrev).toBeLessThanOrEqual(100);
    }
  });

  it('reports zeros rather than dividing by zero on an empty window', () => {
    const out = buildFunnel([
      { stage: 'applied', count: 0 },
      { stage: 'shortlisted', count: 0 },
    ]);
    expect(out[0]?.pctOfTop).toBe(0);
    expect(out[1]?.conversionFromPrev).toBe(0);
  });
});
