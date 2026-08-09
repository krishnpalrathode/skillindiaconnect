/**
 * The offset-pagination envelope shared by every paginated endpoint.
 *
 * Mirrors `apps/api/src/core/pagination.ts` — the API is the source of truth for
 * the shape; this is the client-side mirror so components don't each re-declare
 * it.
 */
export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PageMeta;
}

/** Meta for an empty first page — used as the initial state before a fetch lands. */
export const EMPTY_PAGE_META: PageMeta = { page: 1, pageSize: 20, total: 0, totalPages: 1 };
