/**
 * "4 years 2 months" / "1 year" / "" — the one place the web spells a work
 * duration out.
 *
 * ── Why this exists rather than one ICU message ────────────────────────────
 * A single message cannot omit an empty part. `"{years} years {months} months"`
 * renders "3 years 0 months" for the very common case of a whole number of
 * years, and the alternative — nesting two plurals and a zero branch in one
 * string — is a message translators cannot safely edit. So the two units stay
 * as separate plural messages, and the JOINING rule lives here in code, once.
 *
 * ── Why the units are ICU plurals and not string concatenation ─────────────
 * English needs two forms; Hindi differs; Arabic has six plural categories.
 * next-intl picks the right one per locale from the same message, which a
 * `count === 1 ? …` in a component cannot do.
 *
 * Mirrors `durationLabel` in apps/api — the resume PDF and the screens that
 * preview it must not word the same fact differently.
 */

/** The two plural messages this needs, resolved by the caller's `useTranslations`. */
export interface DurationTranslator {
  (key: 'durationYears' | 'durationMonths', values: { count: number }): string;
}

export function formatDuration(
  t: DurationTranslator,
  years: number | null | undefined,
  months: number | null | undefined,
): string {
  const parts: string[] = [];
  // `> 0`, so a zero part is absent rather than printed — "3 years", never
  // "3 years 0 months". Null/undefined are treated as zero for the same reason.
  if ((years ?? 0) > 0) parts.push(t('durationYears', { count: years as number }));
  if ((months ?? 0) > 0) parts.push(t('durationMonths', { count: months as number }));
  return parts.join(' ');
}
