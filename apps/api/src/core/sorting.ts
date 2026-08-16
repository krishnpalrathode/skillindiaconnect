/**
 * `sort=field:dir` → a Prisma `orderBy`, through a per-endpoint WHITELIST.
 *
 * api-conventions.md: "Filtering/sorting: whitelisted per endpoint — never
 * arbitrary field access." Handing a user-supplied string straight to Prisma's
 * `orderBy` would let a caller order by any column on the model, including ones
 * the endpoint deliberately never returns — an oracle for reading data through
 * ordering alone (page through sorted-by-`phone` and you learn phone order for
 * candidates whose phone is hidden). The whitelist is the security boundary, not
 * a convenience.
 *
 * Generalized from the map JobsService.list already used, so every table sorts
 * the same way instead of each one re-deriving it.
 */

export type SortDirection = 'asc' | 'desc';

/**
 * Whitelist for one endpoint: the client-facing field name → the model column.
 * They are separated so a UI column can be renamed without exposing the schema,
 * and so a sortable "company" can map to a nested relation path.
 */
export type SortWhitelist = Record<string, string>;

export interface ResolvedSort {
  field: string;
  direction: SortDirection;
  /** The client-facing form, echoed back so the UI can render its own state. */
  applied: string;
}

/**
 * Parse and clamp. An unknown field or direction falls back to the endpoint's
 * default rather than erroring: a stale bookmark with a removed column should
 * still render a list, not a 400.
 */
export function resolveSort(
  raw: string | undefined,
  whitelist: SortWhitelist,
  fallback: string,
): ResolvedSort {
  const [rawField, rawDir] = (raw ?? fallback).split(':');
  const [fbField, fbDir] = fallback.split(':');

  const field = rawField && rawField in whitelist ? rawField : (fbField as string);
  const direction: SortDirection =
    rawDir === 'asc' || rawDir === 'desc' ? rawDir : fbDir === 'asc' ? 'asc' : 'desc';

  return { field, direction, applied: `${field}:${direction}` };
}

/**
 * Build the Prisma `orderBy` array.
 *
 * `id` is appended as a final tiebreaker ALWAYS. Without it, ordering by a
 * non-unique column (status, title, a date shared by bulk-imported rows) is not
 * a total order, and offset pagination on a non-total order can repeat or skip
 * rows between pages — the exact defect the pagination work was careful to avoid.
 *
 * A dotted whitelist target (`company.name`) becomes a nested orderBy, which is
 * how a table sorts by a joined display column.
 */
export function buildOrderBy(
  sort: ResolvedSort,
  whitelist: SortWhitelist,
): Record<string, unknown>[] {
  const target = whitelist[sort.field] ?? 'id';
  const parts = target.split('.');

  const primary =
    parts.length === 1
      ? { [parts[0]!]: sort.direction }
      : parts.reduceRight<Record<string, unknown>>(
          (acc, key, i) => (i === parts.length - 1 ? { [key]: sort.direction } : { [key]: acc }),
          {},
        );

  return target === 'id' ? [primary] : [primary, { id: sort.direction }];
}
