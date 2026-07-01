import type { components } from '@skillindiaconnect/shared-types';

export type JobMarket = components['schemas']['JobMarket'];
export type JobSort = 'relevance' | 'recent' | 'salary';

export interface JobSearchFilters {
  market: JobMarket | null;
  category: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  q: string | null;
  sort: JobSort;
}

export const DEFAULT_SORT: JobSort = 'recent';
export const DEFAULT_PAGE_SIZE = 12;

const VALID_MARKETS: JobMarket[] = ['GULF', 'LOCAL'];
const VALID_SORTS: JobSort[] = ['relevance', 'recent', 'salary'];

export const EMPTY_FILTERS: JobSearchFilters = {
  market: null,
  category: null,
  salaryMin: null,
  salaryMax: null,
  currency: null,
  q: null,
  sort: DEFAULT_SORT,
};

/** Next.js page `searchParams` prop shape — values may be repeated in the URL. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** URL query string → typed filter state. Unknown/invalid values fall back to "no filter". */
export function parseJobSearchParams(params: RawSearchParams): JobSearchFilters {
  const market = first(params['market']);
  const sort = first(params['sort']);

  return {
    market: market && VALID_MARKETS.includes(market as JobMarket) ? (market as JobMarket) : null,
    category: first(params['category']) || null,
    salaryMin: parseNumber(first(params['salaryMin'])),
    salaryMax: parseNumber(first(params['salaryMax'])),
    currency: first(params['currency']) || null,
    q: first(params['q']) || null,
    sort: sort && VALID_SORTS.includes(sort as JobSort) ? (sort as JobSort) : DEFAULT_SORT,
  };
}

/**
 * Typed filter state → query string, shared by the SSR fetch, the client
 * load-more fetch, and the URL bar (`router.push`) so all three always agree.
 * Default values are omitted from the string to keep shared/bookmarked URLs
 * clean (e.g. `sort=recent` never appears since it's the default).
 */
export function buildJobSearchQuery(
  filters: JobSearchFilters,
  extra?: { cursor?: string | null; limit?: number },
): string {
  const params = new URLSearchParams();
  if (filters.market) params.set('market', filters.market);
  if (filters.category) params.set('category', filters.category);
  if (filters.salaryMin != null) params.set('salaryMin', String(filters.salaryMin));
  if (filters.salaryMax != null) params.set('salaryMax', String(filters.salaryMax));
  if (filters.currency) params.set('currency', filters.currency);
  if (filters.q) params.set('q', filters.q);
  if (filters.sort !== DEFAULT_SORT) params.set('sort', filters.sort);
  if (extra?.cursor) params.set('cursor', extra.cursor);
  if (extra?.limit) params.set('limit', String(extra.limit));
  return params.toString();
}

/**
 * Merges a partial filter change into the current filters and returns the
 * next URL. Used by JobSearchControls/JobFilters so `router.push(...)` always
 * carries the full filter set forward — never just the one field that changed.
 */
export function nextJobSearchUrl(
  pathname: string,
  filters: JobSearchFilters,
  patch: Partial<JobSearchFilters>,
): string {
  const merged = { ...filters, ...patch };
  const qs = buildJobSearchQuery(merged);
  return qs ? `${pathname}?${qs}` : pathname;
}
