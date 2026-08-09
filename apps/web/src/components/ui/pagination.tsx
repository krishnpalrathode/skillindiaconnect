'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Disables both controls while a page is in flight. */
  busy?: boolean;
  className?: string;
}

/**
 * Prev / "Page X of Y" / Next.
 *
 * Deliberately NOT numbered page links: the deepest list here runs to a few
 * hundred pages, and a numbered strip would need truncation logic that earns
 * nothing over two buttons plus a position readout.
 *
 * Renders nothing for a single page — a pager against one page is noise.
 * Logical properties only (see frontend-conventions.md) so RTL flips for free;
 * the labels stay semantic ("previous"/"next" in reading order), which is what
 * screen readers announce and what the RTL layout already mirrors visually.
 */
export function Pagination({
  page,
  totalPages,
  onPageChange,
  busy = false,
  className,
}: PaginationProps) {
  const t = useTranslations('pagination');

  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label={t('label')}
      className={
        className ?? 'mt-4 flex items-center justify-between gap-3 text-sm text-neutral-600'
      }
    >
      <span aria-live="polite">{t('pageInfo', { page, totalPages })}</span>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 1 || busy}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          aria-label={t('previousPage')}
        >
          {t('prev')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={page >= totalPages || busy}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          aria-label={t('nextPage')}
        >
          {t('next')}
        </Button>
      </div>
    </nav>
  );
}
