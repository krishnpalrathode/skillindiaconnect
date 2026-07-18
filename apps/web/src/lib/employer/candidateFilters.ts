/**
 * Candidate-browse filter state, mirroring lib/jobs/searchParams.ts.
 *
 * Only the whitelisted query parameters the API accepts are represented here —
 * arbitrary field access is not supported (see the browse endpoint contract).
 * The two boolean filters are one-directional toggles: "on" narrows to `true`,
 * "off" applies no filter (the param is omitted), so there is no way to request
 * `hasForeignExperience=false` / `availability=false` from the UI.
 */
export interface CandidateBrowseFilters {
  category: string | null;
  minExperienceYears: number | null;
  foreignOnly: boolean;
  availableOnly: boolean;
  q: string | null;
}

export const EMPTY_CANDIDATE_FILTERS: CandidateBrowseFilters = {
  category: null,
  minExperienceYears: null,
  foreignOnly: false,
  availableOnly: false,
  q: null,
};

/** Selectable minimum-experience thresholds (years). */
export const MIN_EXPERIENCE_OPTIONS = [1, 2, 3, 5, 10] as const;

/** Next.js page `searchParams` prop shape — values may be repeated in the URL. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** URL query string → typed filter state. Unknown/invalid values fall back to "no filter". */
export function parseCandidateFilters(params: RawSearchParams): CandidateBrowseFilters {
  return {
    category: first(params['category']) || null,
    minExperienceYears: parsePositiveInt(first(params['minExperienceYears'])),
    foreignOnly: first(params['hasForeignExperience']) === 'true',
    availableOnly: first(params['availability']) === 'true',
    q: first(params['q']) || null,
  };
}

/**
 * Typed filter state → query string. Shared by the initial fetch, the
 * load-more fetch, and the URL bar so all three always agree. Default (unset)
 * values are omitted to keep shared/bookmarked URLs clean.
 */
export function buildCandidateQuery(
  filters: CandidateBrowseFilters,
  extra?: { cursor?: string | null; limit?: number },
): string {
  const params = new URLSearchParams();
  if (filters.category) params.set('category', filters.category);
  if (filters.minExperienceYears != null)
    params.set('minExperienceYears', String(filters.minExperienceYears));
  if (filters.foreignOnly) params.set('hasForeignExperience', 'true');
  if (filters.availableOnly) params.set('availability', 'true');
  if (filters.q) params.set('q', filters.q);
  if (extra?.cursor) params.set('cursor', extra.cursor);
  if (extra?.limit) params.set('limit', String(extra.limit));
  return params.toString();
}

/**
 * Merge a partial filter change into the current filters and return the next
 * URL, carrying the full filter set forward so `router.push(...)` never drops
 * the fields that didn't change.
 */
export function nextCandidateUrl(
  pathname: string,
  filters: CandidateBrowseFilters,
  patch: Partial<CandidateBrowseFilters>,
): string {
  const merged = { ...filters, ...patch };
  const qs = buildCandidateQuery(merged);
  return qs ? `${pathname}?${qs}` : pathname;
}

export function hasActiveCandidateFilters(filters: CandidateBrowseFilters): boolean {
  return Boolean(
    filters.category ||
    filters.minExperienceYears != null ||
    filters.foreignOnly ||
    filters.availableOnly ||
    filters.q,
  );
}
