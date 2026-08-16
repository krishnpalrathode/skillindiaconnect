/**
 * The locale codes the platform accepts, mirroring `languagePref` in
 * `packages/contract/openapi.yaml`. The contract is the source of truth (it is
 * hand-written YAML and cannot import this file); this constant exists so the
 * DTOs validate against ONE list rather than repeating the codes inline, which
 * is how `register-company.dto.ts` and the contract drifted apart in the first
 * place.
 *
 * Adding a language: update the contract enum and this array together.
 */
export const SUPPORTED_LOCALES = [
  'en',
  'hi',
  'bn',
  'mr',
  'te',
  'ta',
  'gu',
  'kn',
  'ml',
  'pa',
  'or',
  'as',
  'ne',
  // The wider Gulf corridor — the non-Indian workforce GCC employers hire
  // alongside Indian candidates. See apps/web/src/i18n/locales.ts for the
  // reasoning and the display metadata.
  'tl',
  'id',
  'si',
  'am',
  'sw',
  'ur',
  'fa',
  'ps',
  'ar',
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
