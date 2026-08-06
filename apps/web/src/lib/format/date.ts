/**
 * Single source of truth for date DISPLAY across the app. Every user-facing date
 * should render through one of these so the format is identical everywhere.
 *
 * India-first: the `en` app locale maps to `en-IN` so English dates read
 * day-first ("15 Jun 2026") — the convention the majority of the UI already used
 * — while `hi`/`ar` localise naturally. Only formatting lives here; no behaviour.
 */
type DateInput = string | number | Date;

const LOCALE_MAP: Record<string, string> = {
  en: 'en-IN',
  hi: 'hi-IN',
  ar: 'ar',
};

function resolveLocale(locale?: string): string {
  if (!locale) return 'en-IN';
  return LOCALE_MAP[locale] ?? locale;
}

/** Canonical full date — "15 Jun 2026". */
export function formatDate(input: DateInput, locale?: string): string {
  return new Intl.DateTimeFormat(resolveLocale(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(input));
}

/** Date + time — "15 Jun 2026, 02:30 pm" (audit log, timestamps). */
export function formatDateTime(input: DateInput, locale?: string): string {
  return new Intl.DateTimeFormat(resolveLocale(locale), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(input));
}

/** Month + year — "June 2026" (e.g. "member since"). */
export function formatMonthYear(input: DateInput, locale?: string): string {
  return new Intl.DateTimeFormat(resolveLocale(locale), {
    month: 'long',
    year: 'numeric',
  }).format(new Date(input));
}
