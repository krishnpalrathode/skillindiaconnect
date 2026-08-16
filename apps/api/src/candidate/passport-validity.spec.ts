import {
  assessPassportValidity,
  daysUntil,
  PASSPORT_MIN_VALIDITY_DAYS,
  PASSPORT_WARNING_DAYS,
} from './passport-validity';

/**
 * The boundaries are the whole test. This rule decides whether someone can take
 * a job abroad, and every interesting bug lives exactly one day either side of a
 * threshold.
 */
const NOW = new Date(2026, 0, 1); // 1 Jan 2026, local midnight
const plusDays = (n: number) => new Date(2026, 0, 1 + n);

describe('assessPassportValidity', () => {
  it('treats a missing date as blocking', () => {
    expect(assessPassportValidity(null, NOW)).toMatchObject({ status: 'missing', blocks: true });
    expect(assessPassportValidity(undefined, NOW).blocks).toBe(true);
  });

  it('treats TODAY as expired — a passport expiring today is unusable for travel', () => {
    expect(assessPassportValidity(plusDays(0), NOW)).toMatchObject({
      status: 'expired',
      blocks: true,
    });
  });

  it('treats a past date as expired', () => {
    expect(assessPassportValidity(plusDays(-1), NOW).status).toBe('expired');
  });

  describe(`the ${PASSPORT_MIN_VALIDITY_DAYS}-day blocking floor`, () => {
    it('blocks one day BELOW the floor', () => {
      const r = assessPassportValidity(plusDays(PASSPORT_MIN_VALIDITY_DAYS - 1), NOW);
      expect(r).toMatchObject({ status: 'below_minimum', blocks: true });
      expect(r.daysRemaining).toBe(PASSPORT_MIN_VALIDITY_DAYS - 1);
    });

    it('ALLOWS exactly the floor — 180 days is six months, which is the rule', () => {
      const r = assessPassportValidity(plusDays(PASSPORT_MIN_VALIDITY_DAYS), NOW);
      expect(r.blocks).toBe(false);
      expect(r.status).toBe('expiring_soon');
    });
  });

  describe(`the ${PASSPORT_WARNING_DAYS}-day warning band`, () => {
    it('warns one day below a year, without blocking', () => {
      const r = assessPassportValidity(plusDays(PASSPORT_WARNING_DAYS - 1), NOW);
      expect(r).toMatchObject({ status: 'expiring_soon', blocks: false });
    });

    it('is silent at exactly a year', () => {
      expect(assessPassportValidity(plusDays(PASSPORT_WARNING_DAYS), NOW).status).toBe('ok');
    });

    it('is silent well beyond a year', () => {
      expect(assessPassportValidity(plusDays(3000), NOW).status).toBe('ok');
    });
  });

  it('never reports a blocking status as non-blocking', () => {
    // The invariant the callers rely on: `blocks` and `status` cannot disagree.
    for (const d of [-500, -1, 0, 1, 179, 180, 364, 365, 5000]) {
      const r = assessPassportValidity(plusDays(d), NOW);
      const shouldBlock = r.status === 'expired' || r.status === 'below_minimum';
      expect(r.blocks).toBe(shouldBlock);
    }
  });
});

describe('daysUntil', () => {
  it('compares at DATE granularity, so a time-of-day difference is not a day', () => {
    // 23:59 today is still "0 days", not -1 from a fractional subtraction.
    const lateToday = new Date(2026, 0, 1, 23, 59);
    expect(daysUntil(lateToday, new Date(2026, 0, 1, 0, 1))).toBe(0);
  });

  it('counts calendar days across a month boundary', () => {
    expect(daysUntil(new Date(2026, 1, 1), new Date(2026, 0, 1))).toBe(31);
  });
});
