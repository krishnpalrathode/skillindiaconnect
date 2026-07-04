'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { JOB_CATEGORIES } from '@/lib/jobs/categories';
import {
  nextCandidateUrl,
  hasActiveCandidateFilters,
  MIN_EXPERIENCE_OPTIONS,
  type CandidateBrowseFilters,
} from '@/lib/employer/candidateFilters';

interface CandidateFiltersProps {
  filters: CandidateBrowseFilters;
  locale: string;
}

/** Accessible on/off switch backed by a real button (keyboard + SR complete). */
function FilterSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex min-h-[44px] w-full items-center justify-between gap-3 rounded-md border px-3 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
        checked
          ? 'border-primary-500 bg-primary-50 text-primary-700'
          : 'border-border text-neutral-600 hover:bg-neutral-50',
      )}
    >
      <span>{label}</span>
      <span
        aria-hidden="true"
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-primary-600' : 'bg-neutral-300',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-4 rounded-full bg-white transition-all',
            checked ? 'start-[18px]' : 'start-0.5',
          )}
        />
      </span>
    </button>
  );
}

/**
 * Candidate browse filters — the whitelisted params only (category, minimum
 * experience, foreign-experience toggle, availability toggle, keyword). Every
 * change is written to the URL so the filtered view is shareable and the
 * back/forward buttons behave.
 */
export function CandidateFilters({ filters, locale }: CandidateFiltersProps) {
  const t = useTranslations('employer.candidates.filters');
  const tc = useTranslations('jobs.categories');
  const router = useRouter();
  const pathname = usePathname();

  const [q, setQ] = useState(filters.q ?? '');

  // Keep the input in sync when the URL changes externally (e.g. clear).
  useEffect(() => {
    setQ(filters.q ?? '');
  }, [filters.q]);

  const go = (patch: Partial<CandidateBrowseFilters>) => {
    router.push(nextCandidateUrl(pathname, filters, patch));
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    go({ q: q.trim() || null });
  };

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={submitSearch}>
        <label htmlFor="candidate-q" className="mb-2 block text-sm font-semibold text-neutral-700">
          {t('search')}
        </label>
        <div className="flex gap-2">
          <Input
            id="candidate-q"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('searchPlaceholder')}
          />
          <Button type="submit" variant="outline" aria-label={t('search')} className="shrink-0">
            <Search className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </form>

      <div>
        <label
          htmlFor="candidate-category"
          className="mb-2 block text-sm font-semibold text-neutral-700"
        >
          {t('category')}
        </label>
        <select
          id="candidate-category"
          value={filters.category ?? ''}
          onChange={(e) => go({ category: e.target.value || null })}
          className={cn(
            'h-11 w-full rounded-md border border-input bg-background ps-3 pe-3 text-sm text-foreground',
            'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 focus-visible:border-primary-600',
          )}
        >
          <option value="">{t('allCategories')}</option>
          {JOB_CATEGORIES.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {tc(cat.labelKey)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="candidate-min-exp"
          className="mb-2 block text-sm font-semibold text-neutral-700"
        >
          {t('minExperience')}
        </label>
        <select
          id="candidate-min-exp"
          value={filters.minExperienceYears ?? ''}
          onChange={(e) =>
            go({ minExperienceYears: e.target.value ? Number(e.target.value) : null })
          }
          className={cn(
            'h-11 w-full rounded-md border border-input bg-background ps-3 pe-3 text-sm text-foreground',
            'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 focus-visible:border-primary-600',
          )}
        >
          <option value="">{t('anyExperience')}</option>
          {MIN_EXPERIENCE_OPTIONS.map((yrs) => (
            <option key={yrs} value={yrs}>
              {t('yearsPlus', { years: yrs })}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <FilterSwitch
          checked={filters.foreignOnly}
          onChange={(next) => go({ foreignOnly: next })}
          label={t('foreignExperience')}
        />
        <FilterSwitch
          checked={filters.availableOnly}
          onChange={(next) => go({ availableOnly: next })}
          label={t('availableNow')}
        />
      </div>

      {hasActiveCandidateFilters(filters) && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/${locale}/employer/candidates`)}
        >
          {t('clear')}
        </Button>
      )}
    </div>
  );
}
