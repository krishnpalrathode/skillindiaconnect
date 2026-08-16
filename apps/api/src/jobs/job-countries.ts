import { JobMarket } from '@prisma/client';

/**
 * Recruiting countries a job may target, split by market. Canonical English
 * names — the exact strings stored in `Job.country` and mirrored by the web
 * `COUNTRIES` list (apps/web/src/lib/countries.ts). Keep the two in sync.
 *
 * The split is the server-side enforcement of the business rule (never trust the
 * UI): a LOCAL job is India; a GULF job is one of the six GCC states.
 */
export const LOCAL_JOB_COUNTRIES = ['India'] as const;

export const GULF_JOB_COUNTRIES = [
  'United Arab Emirates',
  'Saudi Arabia',
  'Qatar',
  'Kuwait',
  'Oman',
  'Bahrain',
] as const;

export const ALL_JOB_COUNTRIES: readonly string[] = [...LOCAL_JOB_COUNTRIES, ...GULF_JOB_COUNTRIES];

export function countriesForMarket(market: JobMarket): readonly string[] {
  return market === JobMarket.LOCAL ? LOCAL_JOB_COUNTRIES : GULF_JOB_COUNTRIES;
}

export function isCountryValidForMarket(country: string, market: JobMarket): boolean {
  return countriesForMarket(market).includes(country);
}
