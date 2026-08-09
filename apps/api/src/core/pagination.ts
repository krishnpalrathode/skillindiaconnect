/**
 * Offset pagination helpers.
 *
 * The `{ page, pageSize, total, totalPages }` meta shape is the response
 * contract from api-conventions.md; it was previously recomputed inline at every
 * call site. These helpers exist so the clamping rules (page >= 1, pageSize
 * bounded, totalPages >= 1) stay identical across endpoints.
 */

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Normalize untrusted page/pageSize into `skip`/`take` plus the clamped values.
 *
 * DTO validators already bound these, but services are also called from cron
 * and tests where nothing validated the input, so clamp here too.
 */
export function resolvePaging(
  page?: number,
  pageSize?: number,
  maxPageSize: number = MAX_PAGE_SIZE,
): { page: number; pageSize: number; skip: number; take: number } {
  const p = Math.max(1, Math.floor(page ?? 1) || 1);
  const size = Math.min(maxPageSize, Math.max(1, Math.floor(pageSize ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE));
  return { page: p, pageSize: size, skip: (p - 1) * size, take: size };
}

/**
 * Build the meta envelope.
 *
 * `totalPages` floors at 1 so an empty list reports "Page 1 of 1" rather than
 * "Page 1 of 0" — the pager then correctly hides itself instead of rendering a
 * disabled control against a nonexistent page.
 */
export function pageMeta(page: number, pageSize: number, total: number): PageMeta {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
