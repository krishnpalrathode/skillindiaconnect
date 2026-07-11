import { CompanyType } from '@prisma/client';
import { computeTotals } from './money';

describe('money.computeTotals (pure)', () => {
  // ── LOCAL: GST applies ────────────────────────────────────────────────────

  it('the canonical case: 299900 × 18% → gst 53982, total 353882', () => {
    const t = computeTotals(299_900, CompanyType.LOCAL, 18);
    expect(t).toEqual({ amountSubunits: 299_900, gstSubunits: 53_982, totalSubunits: 353_882 });
  });

  it('yearly plan: 2499900 × 18% → gst 449982, total 2949882', () => {
    const t = computeTotals(2_499_900, CompanyType.LOCAL, 18);
    expect(t).toEqual({
      amountSubunits: 2_499_900,
      gstSubunits: 449_982,
      totalSubunits: 2_949_882,
    });
  });

  it('rounds HALF-UP on the .5 boundary (integer arithmetic, no float rounding)', () => {
    // 150 × 15% = 22.5 → 23 (half-up); float Math.round(22.5) also gives 23,
    // but 0.5-representability bugs (e.g. 2.675) never arise — the math is
    // (price*rate + 50) / 100 floored, all integers.
    expect(computeTotals(150, CompanyType.LOCAL, 15).gstSubunits).toBe(23);
    // 149 × 15% = 22.35 → 22
    expect(computeTotals(149, CompanyType.LOCAL, 15).gstSubunits).toBe(22);
  });

  it('0% GST rate → gst 0, total = price', () => {
    const t = computeTotals(299_900, CompanyType.LOCAL, 0);
    expect(t.gstSubunits).toBe(0);
    expect(t.totalSubunits).toBe(299_900);
  });

  // ── FOREIGN: zero-rated export ────────────────────────────────────────────

  it('FOREIGN is ZERO-RATED: gst explicitly 0 (present, not absent), total = price', () => {
    const t = computeTotals(299_900, CompanyType.FOREIGN, 18);
    // Zero-rated ≠ exempt: the field carries 0 — assert the key EXISTS.
    expect(Object.prototype.hasOwnProperty.call(t, 'gstSubunits')).toBe(true);
    expect(t.gstSubunits).toBe(0);
    expect(t.totalSubunits).toBe(299_900);
  });

  // ── Subunit integrity: never a float ─────────────────────────────────────

  it('every output is a safe integer across a sweep of prices and rates', () => {
    for (const price of [1, 99, 149, 299_900, 2_499_900, 999_999_999]) {
      for (const rate of [0, 5, 12, 18, 28]) {
        const t = computeTotals(price, CompanyType.LOCAL, rate);
        expect(Number.isSafeInteger(t.amountSubunits)).toBe(true);
        expect(Number.isSafeInteger(t.gstSubunits)).toBe(true);
        expect(Number.isSafeInteger(t.totalSubunits)).toBe(true);
        expect(t.totalSubunits).toBe(t.amountSubunits + t.gstSubunits);
      }
    }
  });

  it('rejects float / negative / unsafe inputs — floats never transit', () => {
    expect(() => computeTotals(2999.5, CompanyType.LOCAL, 18)).toThrow(/integer/);
    expect(() => computeTotals(-1, CompanyType.LOCAL, 18)).toThrow(/integer/);
    expect(() => computeTotals(299_900, CompanyType.LOCAL, 18.5)).toThrow(/integer/);
    expect(() => computeTotals(299_900, CompanyType.LOCAL, -1)).toThrow(/integer/);
    expect(() => computeTotals(299_900, CompanyType.LOCAL, 101)).toThrow(/integer/);
  });
});
