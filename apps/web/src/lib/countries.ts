/**
 * Countries this platform recruits into, with their dial codes.
 *
 * Scope is deliberate: India plus the six GCC states, matching the
 * LOCAL / FOREIGN (Gulf) company split. Kept as one list so the Country select
 * and the phone dial-code select can never drift apart.
 *
 * `name` is the value persisted to Company.country — an English canonical name,
 * NOT the translated label, so the stored data stays queryable across locales.
 */
export interface CountryOption {
  /** Canonical value stored in the database. */
  name: string;
  /** Dial code stored in Company.phoneCode. */
  dialCode: string;
  /** i18n key suffix under `employer.onboarding.countries`. */
  key: string;
  /** ISO 3166-1 alpha-2 — the input to `flagEmoji`. */
  iso: string;
}

/** India is first and is the default selection. */
export const DEFAULT_COUNTRY: CountryOption = {
  key: 'india',
  name: 'India',
  dialCode: '+91',
  iso: 'IN',
};

export const COUNTRIES: readonly CountryOption[] = [
  DEFAULT_COUNTRY,
  { key: 'uae', name: 'United Arab Emirates', dialCode: '+971', iso: 'AE' },
  { key: 'saudiArabia', name: 'Saudi Arabia', dialCode: '+966', iso: 'SA' },
  { key: 'qatar', name: 'Qatar', dialCode: '+974', iso: 'QA' },
  { key: 'kuwait', name: 'Kuwait', dialCode: '+965', iso: 'KW' },
  { key: 'oman', name: 'Oman', dialCode: '+968', iso: 'OM' },
  { key: 'bahrain', name: 'Bahrain', dialCode: '+973', iso: 'BH' },
] as const;

/**
 * ISO alpha-2 → the flag emoji, built from Unicode regional indicators.
 *
 * Deliberately no image assets and no flag package. Candidates here are on
 * Android and iOS, where these render as real flags; desktop Chrome on Windows
 * has no flag glyphs and falls back to the two letters ("IN"), which still
 * identifies the country next to its dial code. Hand-drawing these instead
 * would mean approximating the Saudi shahada and the Ashoka Chakra, which is
 * worse than a letter pair.
 */
export function flagEmoji(iso: string): string {
  return iso
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .split('')
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join('');
}

/**
 * Splits an E.164 number into its dial code and the national part, picking the
 * LONGEST matching code so +971 is never mistaken for +97.
 * Returns null when nothing matches, so callers can fall back to a default.
 */
export function splitE164(e164: string): { country: CountryOption; national: string } | null {
  const match = [...COUNTRIES]
    .sort((a, b) => b.dialCode.length - a.dialCode.length)
    .find((c) => e164.startsWith(c.dialCode));
  return match ? { country: match, national: e164.slice(match.dialCode.length) } : null;
}

/** Gulf (GCC) states — every country except India. */
export const GULF_COUNTRIES: readonly CountryOption[] = COUNTRIES.filter((c) => c.name !== 'India');

/**
 * Countries a job may recruit into, by market: India for LOCAL, the six GCC
 * states for GULF. Mirrors the server's `countriesForMarket`
 * (apps/api/src/jobs/job-countries.ts).
 */
export function countriesForMarket(market: 'GULF' | 'LOCAL'): readonly CountryOption[] {
  return market === 'LOCAL' ? [DEFAULT_COUNTRY] : GULF_COUNTRIES;
}

/** Dial codes, de-duplicated, for the phone-code select. */
export const DIAL_CODES: readonly string[] = Array.from(new Set(COUNTRIES.map((c) => c.dialCode)));

export function dialCodeForCountry(countryName: string): string | undefined {
  return COUNTRIES.find((c) => c.name === countryName)?.dialCode;
}
