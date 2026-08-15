import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  DIAL_CODE_OPTIONS,
  DEFAULT_DIAL_OPTION,
  optionForDialCode,
  optionForIso,
  splitDialCode,
} from '../dial-codes';

const FLAG_DIR = join(__dirname, '..', '..', '..', 'public', 'flags');

describe('dial code dataset', () => {
  it('has a flag SVG on disk for every country', () => {
    /*
      The one failure nobody notices in review: adding a country to the array and
      not to `public/flags`, which renders as a broken-image icon in the picker
      rather than an error anyone would see in CI.
    */
    const missing = DIAL_CODE_OPTIONS.filter(
      (o) => !existsSync(join(FLAG_DIR, `${o.iso.toLowerCase()}.svg`)),
    ).map((o) => `${o.iso} (${o.name})`);
    expect(missing, 'countries with no flag asset').toEqual([]);
  });

  it('uses unique ISO codes — they are the option values', () => {
    const seen = new Set(DIAL_CODE_OPTIONS.map((o) => o.iso));
    expect(seen.size).toBe(DIAL_CODE_OPTIONS.length);
  });

  it('formats every dial code as + followed by digits', () => {
    const bad = DIAL_CODE_OPTIONS.filter((o) => !/^\+\d{1,4}$/.test(o.dialCode));
    expect(bad).toEqual([]);
  });

  it('puts the recruit corridor first, so the common case needs no scrolling', () => {
    expect(DIAL_CODE_OPTIONS.slice(0, 7).map((o) => o.iso)).toEqual([
      'IN',
      'AE',
      'SA',
      'QA',
      'KW',
      'OM',
      'BH',
    ]);
    expect(DEFAULT_DIAL_OPTION.iso).toBe('IN');
  });

  it('holds no dial code that is a strict prefix of another', () => {
    /*
      What makes `splitDialCode` unambiguous. If both "+1" and "+1242" were
      listed, "+1242…" could split two ways and a Bahamian number would resolve
      to whichever sorted first. Every NANP country is listed as plain "+1"
      precisely to keep this true.
    */
    const codes = [...new Set(DIAL_CODE_OPTIONS.map((o) => o.dialCode))];
    const conflicts = codes.filter((a) => codes.some((b) => b !== a && b.startsWith(a)));
    expect(conflicts, 'codes that prefix another code').toEqual([]);
  });
});

describe('lookups', () => {
  it('resolves an ISO to its option', () => {
    expect(optionForIso('PH')?.dialCode).toBe('+63');
    expect(optionForIso('ZZ')).toBeUndefined();
  });

  it('resolves a dial code to the first country holding it', () => {
    expect(optionForDialCode('+91')?.iso).toBe('IN');
    // Shared code: documented to pick the first match, never to throw.
    expect(optionForDialCode('+1')).toBeDefined();
  });
});

describe('splitDialCode', () => {
  it.each([
    ['+919876543210', 'IN', '9876543210'],
    ['+971501234567', 'AE', '501234567'],
    ['+639171234567', 'PH', '9171234567'],
    ['+447700900123', 'GB', '7700900123'],
  ])('splits %s into %s + national part', (e164, iso, national) => {
    const parsed = splitDialCode(e164);
    expect(parsed?.country.iso).toBe(iso);
    expect(parsed?.national).toBe(national);
  });

  it('prefers the LONGEST code so +971 is never read as +97', () => {
    // +97 belongs to no country here; the guard is that a longer code wins.
    expect(splitDialCode('+971501234567')?.country.iso).toBe('AE');
  });

  it('returns null for a number with no known code, so callers can default', () => {
    expect(splitDialCode('0123456789')).toBeNull();
  });
});
