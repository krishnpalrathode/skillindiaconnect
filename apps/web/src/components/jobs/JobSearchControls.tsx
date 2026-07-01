'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  nextJobSearchUrl,
  type JobMarket,
  type JobSearchFilters,
  type JobSort,
} from '@/lib/jobs/searchParams';

interface JobSearchControlsProps {
  filters: JobSearchFilters;
}

const MARKET_TABS: { value: JobMarket | null; labelKey: string }[] = [
  { value: null, labelKey: 'tabs.all' },
  { value: 'LOCAL', labelKey: 'tabs.local' },
  { value: 'GULF', labelKey: 'tabs.foreign' },
];

const SORT_OPTIONS: JobSort[] = ['recent', 'relevance', 'salary'];

export function JobSearchControls({ filters }: JobSearchControlsProps) {
  const t = useTranslations('jobs');
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(filters.q ?? '');

  function go(patch: Partial<JobSearchFilters>) {
    router.push(nextJobSearchUrl(pathname, filters, patch));
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        role="search"
        onSubmit={(e) => {
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
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400"
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
        <Button type="submit" variant="secondary">
          {t('searchButton')}
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label={t('marketTabsLabel')}
          className="flex rounded-md border border-border overflow-hidden text-sm"
        >
          {MARKET_TABS.map((tab) => {
            const selected = filters.market === tab.value;
            return (
              <button
                key={tab.labelKey}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => go({ market: tab.value })}
                className={cn(
                  'min-h-11 px-4 font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
                  selected
                    ? 'bg-primary-50 text-primary-700 border-b-2 border-primary-600'
                    : 'text-neutral-600 hover:bg-neutral-50',
                )}
              >
                {t(tab.labelKey)}
              </button>
            );
          })}
        </div>

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
