/**
 * Numeric bounds on tunable settings.
 *
 * Type-checking alone accepted `jobs.free_max_active_jobs = 0` and `-1`. Either
 * value stops EVERY Free employer publishing anything, platform-wide, from a
 * single typo on the settings screen — and nothing downstream would have
 * questioned it, because the publish gate faithfully enforces whatever cap it
 * is given. These tests pin the floor.
 */
import { describeBounds, isWithinBounds, NUMBER_BOUNDS } from './settings.keys';

describe('setting numeric bounds', () => {
  describe('jobs.free_max_active_jobs', () => {
    const KEY = 'jobs.free_max_active_jobs';

    it('rejects a cap that would block all Free publishing', () => {
      expect(isWithinBounds(KEY, 0)).toBe(false);
      expect(isWithinBounds(KEY, -1)).toBe(false);
    });

    it('accepts the shipped default and any sane raise', () => {
      expect(isWithinBounds(KEY, 1)).toBe(true);
      expect(isWithinBounds(KEY, 5)).toBe(true);
      expect(isWithinBounds(KEY, 50)).toBe(true);
    });

    it('rejects an absurd ceiling (a typo, not a business decision)', () => {
      expect(isWithinBounds(KEY, 1001)).toBe(false);
    });

    it('describes the range for the 422 detail', () => {
      expect(describeBounds(KEY)).toBe('between 1 and 1000');
    });
  });

  describe('percentage settings', () => {
    it.each(['candidates.min_completion_pct', 'candidates.match_alert_min_pct'])(
      '%s is clamped to 0..100',
      (key) => {
        expect(isWithinBounds(key, -1)).toBe(false);
        expect(isWithinBounds(key, 0)).toBe(true);
        expect(isWithinBounds(key, 100)).toBe(true);
        expect(isWithinBounds(key, 101)).toBe(false);
      },
    );
  });

  it('a key with no declared bounds always passes', () => {
    expect(isWithinBounds('jobs.allow_local', true)).toBe(true);
    expect(isWithinBounds('some.unbounded_key', -9999)).toBe(true);
  });

  it('non-numeric values are left to the type check, not the range check', () => {
    // isValidValue owns "is it a number at all"; this must not double-report.
    expect(isWithinBounds('jobs.free_max_active_jobs', 'five')).toBe(true);
  });

  it('every bounded key has a coherent min/max', () => {
    for (const [key, b] of Object.entries(NUMBER_BOUNDS)) {
      if (b.min !== undefined && b.max !== undefined) {
        expect(b.min).toBeLessThanOrEqual(b.max);
      }
      expect(describeBounds(key)).not.toBe('');
    }
  });
});
