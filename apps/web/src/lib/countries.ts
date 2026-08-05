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
}

/** India is first and is the default selection. */
export const DEFAULT_COUNTRY: CountryOption = { key: 'india', name: 'India', dialCode: '+91' };

export const COUNTRIES: readonly CountryOption[] = [
  DEFAULT_COUNTRY,
  { key: 'uae', name: 'United Arab Emirates', dialCode: '+971' },
  { key: 'saudiArabia', name: 'Saudi Arabia', dialCode: '+966' },
  { key: 'qatar', name: 'Qatar', dialCode: '+974' },
  { key: 'kuwait', name: 'Kuwait', dialCode: '+965' },
  { key: 'oman', name: 'Oman', dialCode: '+968' },
  { key: 'bahrain', name: 'Bahrain', dialCode: '+973' },
] as const;

/** Dial codes, de-duplicated, for the phone-code select. */
export const DIAL_CODES: readonly string[] = Array.from(new Set(COUNTRIES.map((c) => c.dialCode)));

export function dialCodeForCountry(countryName: string): string | undefined {
  return COUNTRIES.find((c) => c.name === countryName)?.dialCode;
}
