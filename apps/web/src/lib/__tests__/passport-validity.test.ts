import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  assessPassportValidity,
  earliestAcceptableExpiry,
  PASSPORT_MIN_VALIDITY_DAYS,
  PASSPORT_WARNING_DAYS,
} from '../passport-validity';

const NOW = new Date(2026, 0, 1);
const iso = (days: number) => {
  const d = new Date(2026, 0, 1 + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

describe('passport validity — client mirror', () => {
  it('is silent on an empty field — an untouched input is not yet a mistake', () => {
    expect(assessPassportValidity('', NOW).status).toBe('missing');
    expect(assessPassportValidity(null, NOW).status).toBe('missing');
  });

  it.each([
    [-1, 'expired'],
    [0, 'expired'],
    [1, 'below_minimum'],
    [PASSPORT_MIN_VALIDITY_DAYS - 1, 'below_minimum'],
    [PASSPORT_MIN_VALIDITY_DAYS, 'expiring_soon'],
    [PASSPORT_WARNING_DAYS - 1, 'expiring_soon'],
    [PASSPORT_WARNING_DAYS, 'ok'],
    [900, 'ok'],
  ])('%i days out → %s', (days, status) => {
    expect(assessPassportValidity(iso(days), NOW).status).toBe(status);
  });

  it('blocks exactly the two states the server refuses', () => {
    for (const d of [-10, 0, 1, 179]) expect(assessPassportValidity(iso(d), NOW).blocks).toBe(true);
    for (const d of [180, 364, 365, 800])
      expect(assessPassportValidity(iso(d), NOW).blocks).toBe(false);
  });

  it('earliestAcceptableExpiry is the first date that passes', () => {
    const min = earliestAcceptableExpiry(NOW);
    expect(min).toBe(iso(PASSPORT_MIN_VALIDITY_DAYS));
    expect(assessPassportValidity(min, NOW).blocks).toBe(false);
  });
});

/**
 * The mirror is the risk. Two copies of a rule that decides whether someone can
 * work abroad WILL drift unless something fails when they do — a client that
 * accepts what the server refuses shows a green field and then a 422 nobody can
 * act on.
 */
describe('client and server thresholds agree', () => {
  it('reads the same two numbers out of the API source', () => {
    const apiSrc = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'api', 'src', 'candidate', 'passport-validity.ts'),
      'utf8',
    );
    const read = (name: string) => {
      const m = apiSrc.match(new RegExp(`export const ${name} = (\\d+)`));
      return m ? Number(m[1]) : null;
    };
    expect(read('PASSPORT_MIN_VALIDITY_DAYS')).toBe(PASSPORT_MIN_VALIDITY_DAYS);
    expect(read('PASSPORT_WARNING_DAYS')).toBe(PASSPORT_WARNING_DAYS);
  });
});
