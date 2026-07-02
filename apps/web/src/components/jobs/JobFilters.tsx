'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { JOB_CATEGORIES } from '@/lib/jobs/categories';
import { nextJobSearchUrl, type JobSearchFilters } from '@/lib/jobs/searchParams';

interface JobFiltersProps {
  filters: JobSearchFilters;
  locale: string;
}

// No currency-enumeration endpoint exists (same gap as categories) — these
// are the currencies present across the mock job fixtures.
const CURRENCIES = ['AED', 'SAR', 'QAR', 'BHD', 'INR'];

const SALARY_MIN_BOUND = 0;
const SALARY_MAX_BOUND = 50000;
const SALARY_STEP = 500;

export function JobFilters({ filters, locale }: JobFiltersProps) {
  const t = useTranslations('jobs');
  const router = useRouter();
  const pathname = usePathname();

  // Local draft state for the salary range so dragging doesn't refetch on
  // every pixel — the URL (and SSR refetch) only updates on pointer release.
  const [draftMin, setDraftMin] = useState(filters.salaryMin ?? SALARY_MIN_BOUND);
  const [draftMax, setDraftMax] = useState(filters.salaryMax ?? SALARY_MAX_BOUND);

  function go(patch: Partial<JobSearchFilters>) {
    router.push(nextJobSearchUrl(pathname, filters, patch));
  }

  function commitSalary() {
    go({
      salaryMin: draftMin > SALARY_MIN_BOUND ? draftMin : null,
      salaryMax: draftMax < SALARY_MAX_BOUND ? draftMax : null,
    });
  }

  const hasActiveFilters =
    filters.market ||
    filters.category ||
    filters.salaryMin != null ||
    filters.salaryMax != null ||
    filters.currency ||
    filters.q;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">{t('filters.category')}</h2>
        <div role="group" aria-label={t('filters.category')} className="flex flex-wrap gap-2">
          {JOB_CATEGORIES.map((cat) => {
            const selected = filters.category === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                aria-pressed={selected}
                onClick={() => go({ category: selected ? null : cat.id })}
                className={cn(
                  'min-h-9 rounded-full border px-3 text-sm font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
                  selected
                    ? 'border-primary-600 bg-primary-50 text-primary-700'
                    : 'border-border text-neutral-600 hover:bg-neutral-50',
                )}
              >
                {t(`categories.${cat.labelKey}`)}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">{t('filters.currency')}</h2>
        <select
          aria-label={t('filters.currency')}
          value={filters.currency ?? ''}
          onChange={(e) => go({ currency: e.target.value || null })}
          className={cn(
            'h-11 w-full rounded-md border border-input bg-background ps-3 pe-3 text-sm text-foreground',
            'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 focus-visible:border-primary-600',
          )}
        >
          <option value="">{t('filters.allCurrencies')}</option>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">{t('filters.salaryRange')}</h2>
        <div className="flex flex-col gap-2">
          <p className="text-sm text-neutral-600" aria-live="polite">
            {new Intl.NumberFormat(locale).format(draftMin)} –{' '}
            {new Intl.NumberFormat(locale).format(draftMax)}
          </p>
          <label htmlFor="salary-min" className="sr-only">
            {t('filters.salaryMin')}
          </label>
          <input
            id="salary-min"
            type="range"
            min={SALARY_MIN_BOUND}
            max={SALARY_MAX_BOUND}
            step={SALARY_STEP}
            value={draftMin}
            aria-valuemin={SALARY_MIN_BOUND}
            aria-valuemax={SALARY_MAX_BOUND}
            aria-valuenow={draftMin}
            onChange={(e) => setDraftMin(Math.min(Number(e.target.value), draftMax))}
            onMouseUp={commitSalary}
            onTouchEnd={commitSalary}
            onKeyUp={commitSalary}
            className="w-full accent-primary-600"
          />
          <label htmlFor="salary-max" className="sr-only">
            {t('filters.salaryMax')}
          </label>
          <input
            id="salary-max"
            type="range"
            min={SALARY_MIN_BOUND}
            max={SALARY_MAX_BOUND}
            step={SALARY_STEP}
            value={draftMax}
            aria-valuemin={SALARY_MIN_BOUND}
            aria-valuemax={SALARY_MAX_BOUND}
            aria-valuenow={draftMax}
            onChange={(e) => setDraftMax(Math.max(Number(e.target.value), draftMin))}
            onMouseUp={commitSalary}
            onTouchEnd={commitSalary}
            onKeyUp={commitSalary}
            className="w-full accent-primary-600"
          />
        </div>
      </div>

      {hasActiveFilters && (
        <Button type="button" variant="ghost" size="sm" onClick={() => router.push(pathname)}>
          {t('filters.clear')}
        </Button>
      )}
    </div>
  );
}
