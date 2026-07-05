const NEW_JOB_WINDOW_DAYS = 3;

/** Locale-correct "posted 3 days ago" / "نُشر منذ 3 أيام" via Intl, no per-string translation needed. */
export function formatPostedAgo(dateStr: string, locale: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (diffDays < 1) return rtf.format(0, 'day');
  if (diffDays < 30) return rtf.format(-diffDays, 'day');
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return rtf.format(-diffMonths, 'month');
  return rtf.format(-Math.floor(diffMonths / 12), 'year');
}

export function isNewJob(dateStr: string): boolean {
  const diffDays = (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
  return diffDays <= NEW_JOB_WINDOW_DAYS;
}

/** Locale + currency-aware salary range, e.g. "AED 1,200–1,800" / RTL-safe in ar. */
export function formatSalaryRange(
  salaryMin: number | null | undefined,
  salaryMax: number | null | undefined,
  currency: string,
  locale: string,
): string | null {
  if (salaryMin == null && salaryMax == null) return null;

  const fmt = (n: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
      currencyDisplay: 'code',
    }).format(n);

  if (salaryMin != null && salaryMax != null && salaryMin !== salaryMax) {
    return `${fmt(salaryMin)}–${fmt(salaryMax)}`;
  }
  return fmt(salaryMin ?? salaryMax!);
}
