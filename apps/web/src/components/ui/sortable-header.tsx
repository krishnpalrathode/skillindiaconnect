'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

export type SortDirection = 'asc' | 'desc';

interface SortableHeaderProps {
  /** This column's sort key — must be one the endpoint whitelists. */
  field: string;
  /** The server's CURRENT sort, as `field:dir`. */
  current: string | undefined;
  /** Called with the next `field:dir`. */
  onSort: (next: string) => void;
  children: React.ReactNode;
  /** `end` for numeric/right-aligned columns. */
  align?: 'start' | 'end';
  className?: string;
}

/** Parse `field:dir`; tolerant of undefined so a first render is not special-cased. */
export function parseSort(sort: string | undefined): { field: string; direction: SortDirection } {
  const [field, dir] = (sort ?? '').split(':');
  return { field: field ?? '', direction: dir === 'asc' ? 'asc' : 'desc' };
}

/**
 * A sortable column header.
 *
 * Renders a real `<button>` inside the `<th>` rather than putting the handler on
 * the `<th>` itself: a table header is not focusable or keyboard-activatable, so
 * a clickable `<th>` is unreachable without a mouse. `aria-sort` goes on the
 * `<th>` (where assistive tech expects it) while the button carries the action.
 *
 * The direction shown always reflects the SERVER's answer, never local optimism
 * — if a request is clamped to the default (an unknown field, a stale bookmark),
 * the header shows what actually happened.
 */
export function SortableHeader({
  field,
  current,
  onSort,
  children,
  align = 'start',
  className,
}: SortableHeaderProps) {
  const t = useTranslations('sorting');
  const { field: activeField, direction } = parseSort(current);
  const isActive = activeField === field;

  // First click on a new column sorts DESCENDING for dates and scores — "newest
  // / highest first" is what someone means by "sort by date". Toggling an
  // already-active column flips it.
  const next: SortDirection = isActive ? (direction === 'asc' ? 'desc' : 'asc') : 'asc';

  const Icon = !isActive ? ChevronsUpDown : direction === 'asc' ? ArrowUp : ArrowDown;

  return (
    <th
      scope="col"
      aria-sort={isActive ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={className ?? 'p-3 text-start font-semibold text-neutral-700'}
    >
      <button
        type="button"
        onClick={() => onSort(`${field}:${next}`)}
        className={[
          'group inline-flex items-center gap-1.5 rounded font-semibold',
          'hover:text-primary-700 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
          align === 'end' ? 'flex-row-reverse' : '',
          isActive ? 'text-primary-700' : 'text-neutral-700',
        ].join(' ')}
        // The label states the ACTION, not the state — a screen-reader user
        // needs to know what pressing this will do. `aria-sort` above already
        // conveys the current state.
        aria-label={t(next === 'asc' ? 'sortAscending' : 'sortDescending', {
          column: typeof children === 'string' ? children : field,
        })}
      >
        <span>{children}</span>
        <Icon
          className={
            isActive ? 'size-3.5 shrink-0' : 'size-3.5 shrink-0 opacity-40 group-hover:opacity-70'
          }
          aria-hidden="true"
        />
      </button>
    </th>
  );
}
