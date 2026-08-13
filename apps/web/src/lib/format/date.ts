/**
 * Single source of truth for date DISPLAY across the app. Every user-facing date
 * should render through one of these so the format is identical everywhere.
 *
 * India-first: the `en` app locale maps to `en-IN` so English dates read
 * day-first ("15 Jun 2026") — the convention the majority of the UI already used
 * — while `hi`/`ar` localise naturally. Only formatting lives here; no behaviour.
 */
import { getIntlLocale } from '@/i18n/locales';

type DateInput = string | number | Date;

function resolveLocale(locale?: string): string {
  // The app-locale → BCP-47 mapping lives in the locale registry (`intlLocale`),
  // so a new language gets correct date formatting from its registry entry
  // alone. This file used to keep its own three-entry map, which meant any
  // language added elsewhere silently formatted through the raw code.
  return getIntlLocale(locale);
}

/** Rendered in place of a date that cannot be parsed. */
export const INVALID_DATE_PLACEHOLDER = '—';

/**
 * Parse, or return null.
 *
 * `Intl.DateTimeFormat.format` throws a RangeError on an Invalid Date, and these
 * formatters run during render — so one bad or missing timestamp anywhere takes
 * down the whole page with an unhandled error. That is exactly what a
 * contract/API field-name drift caused on the employer's candidate view: the
 * value was `undefined`, `new Date(undefined)` is Invalid Date, and every
 * employer opening any candidate hit a runtime error screen.
 *
 * A DISPLAY date is never worth a blank page, so a bad value degrades to a dash.
 * Note the deliberate trade-off: this makes such drift quieter, so it is a
 * backstop rather than a substitute for the field being right. It also logs in
 * development, where a silent dash would otherwise hide a real bug.
 */
function parseOrNull(input: DateInput): Date | null {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[format/date] unparseable date input: ${JSON.stringify(input)}`);
    }
    return null;
  }
  return date;
}

/** Canonical full date — "15 Jun 2026". */
export function formatDate(input: DateInput, locale?: string): string {
  const date = parseOrNull(input);
  if (!date) return INVALID_DATE_PLACEHOLDER;
  return new Intl.DateTimeFormat(resolveLocale(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** Date + time — "15 Jun 2026, 02:30 pm" (audit log, timestamps). */
export function formatDateTime(input: DateInput, locale?: string): string {
  const date = parseOrNull(input);
  if (!date) return INVALID_DATE_PLACEHOLDER;
  return new Intl.DateTimeFormat(resolveLocale(locale), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Month + year — "June 2026" (e.g. "member since"). */
export function formatMonthYear(input: DateInput, locale?: string): string {
  const date = parseOrNull(input);
  if (!date) return INVALID_DATE_PLACEHOLDER;
  return new Intl.DateTimeFormat(resolveLocale(locale), {
    month: 'long',
    year: 'numeric',
  }).format(date);
}
