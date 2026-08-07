'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { JobCountryFacet } from '@/lib/api/jobs';
import { cn } from '@/lib/utils';
import { nextJobSearchUrl, type JobSearchFilters, type JobSort } from '@/lib/jobs/searchParams';

interface JobSearchControlsProps {
  filters: JobSearchFilters;
  /** Countries with ACTIVE jobs, from GET /jobs/countries. */
  countries: JobCountryFacet[];
}

const SORT_OPTIONS: JobSort[] = ['recent', 'relevance', 'salary'];

function CountryTab({
  label,
  count,
  selected,
  onClick,
}: {
  label: string;
  count?: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
        selected
          ? 'bg-primary-600 text-white shadow-sm'
          : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200',
      )}
    >
      {label}
      {count !== undefined && (
        <span className={cn('text-xs', selected ? 'text-white/80' : 'text-neutral-600')}>
          {count}
        </span>
      )}
    </button>
  );
}

export function JobSearchControls({ filters, countries }: JobSearchControlsProps) {
  const t = useTranslations('jobs');
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(filters.q ?? '');

  function go(patch: Partial<JobSearchFilters>) {
    router.push(nextJobSearchUrl(pathname, filters, patch));
  }

  // Dynamic search: debounce the typed query into the URL. `replace` (not push)
  // so typing doesn't stack a history entry per keystroke; discrete filters
  // (market/sort) still `push`. The guard makes this a no-op once the query and
  // the URL are in sync, so the navigation it triggers doesn't loop.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === (filters.q ?? '')) return;
    const id = setTimeout(() => {
      router.replace(nextJobSearchUrl(pathname, filters, { q: trimmed || null }));
    }, 300);
    return () => clearTimeout(id);
  }, [query, filters, pathname, router]);

  return (
    <div className="flex flex-col gap-3">
      <form
        role="search"
        onSubmit={(e) => {
          // Enter searches immediately (push), bypassing the debounce.
          e.preventDefault();
          go({ q: query.trim() || null });
        }}
        className="flex gap-2"
      >
        <label htmlFor="job-search-q" className="sr-only">
          {t('searchLabel')}
        </label>
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-neutral-600"
            aria-hidden="true"
          />
          <Input
            id="job-search-q"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="ps-9"
          />
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {/*
          Country tabs, built from the live job set (GET /jobs/countries) rather
          than a hard-coded India/Gulf pair. A country appears the moment an
          employer publishes a job there and drops off when the last one is
          archived, so recruiting can open anywhere with no code change.

          `countries` is empty only when nothing is published at all — then the
          whole strip is hidden rather than showing a lone "All" that filters
          nothing.
        */}
        {countries.length > 0 && (
          <div
            role="tablist"
            aria-label={t('countryTabsLabel')}
            className="flex flex-wrap items-center gap-1.5 text-sm"
          >
            <CountryTab
              label={t('tabs.all')}
              selected={filters.country === null}
              onClick={() => go({ country: null })}
            />
            {countries.map(({ country, count }) => (
              <CountryTab
                key={country}
                label={country}
                count={count}
                selected={filters.country === country}
                onClick={() => go({ country })}
              />
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <label htmlFor="job-sort" className="text-sm text-neutral-600">
            {t('filters.sort')}
          </label>
          <select
            id="job-sort"
            value={filters.sort}
            onChange={(e) => go({ sort: e.target.value as JobSort })}
            className={cn(
              'h-11 rounded-md border border-input bg-background ps-3 pe-3 text-sm text-foreground',
              'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 focus-visible:border-primary-600',
            )}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {t(`sort.${opt}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
