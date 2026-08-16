import { describe, expect, it } from 'vitest';
import { fmtCompact, fmtDay, niceTicks } from '../viz';

describe('niceTicks', () => {
  /**
   * The regression this exists for: a quiet week peaking at ONE registration
   * drew an axis of 0, 0.25, 0.5, 0.75, 1. Every series on this dashboard counts
   * rows, and a quarter of a candidate does not exist — a fractional tick on
   * integer data reads as a broken number, not as a scaling choice.
   */
  it('never emits a fractional tick', () => {
    for (const max of [1, 2, 3, 4, 7, 9, 13, 47, 199, 20009]) {
      for (const t of niceTicks(max)) {
        expect(Number.isInteger(t), `max=${max} produced ${t}`).toBe(true);
      }
    }
  });

  it('gives one tick per integer when the peak is tiny', () => {
    expect(niceTicks(1)).toEqual([0, 1]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
  });

  it('starts at zero and covers the peak', () => {
    for (const max of [5, 37, 480, 12345]) {
      const ticks = niceTicks(max);
      expect(ticks[0]).toBe(0);
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max);
    }
  });

  it('survives an empty series without dividing by zero', () => {
    expect(niceTicks(0)).toEqual([0, 1]);
  });
});

describe('fmtCompact', () => {
  it('keeps small counts exact and compacts large ones', () => {
    expect(fmtCompact(0)).toBe('0');
    expect(fmtCompact(1284)).toBe('1,284');
    expect(fmtCompact(20009)).toBe('20K');
  });
});

describe('fmtDay', () => {
  it('formats a UTC day without shifting it into the previous one', () => {
    expect(fmtDay('2026-08-16')).toBe('16 Aug');
  });

  it('returns the input rather than throwing on a bad date', () => {
    expect(fmtDay('not-a-date')).toBe('not-a-date');
  });
});
