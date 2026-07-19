'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { components } from '@skillindiaconnect/shared-types';
import { cn } from '@/lib/utils';

type MatchBreakdown = components['schemas']['MatchBreakdown'];
type JobMarket = components['schemas']['JobMarket'];

interface MatchBreakdownPopoverProps {
  score: number;
  breakdown: MatchBreakdown;
  jobMarket: JobMarket;
  candidateName: string;
}

/**
 * The prominent match score; a tap/keypress opens the SNAPSHOT breakdown (four
 * components, incl. experience raw+clamped and the foreign-0-on-LOCAL note).
 * Values come straight from the payload — never recomputed. Keyboard-openable
 * (native button), text-complete, Escape/click-outside closes.
 */
export function MatchBreakdownPopover({
  score,
  breakdown,
  jobMarket,
  candidateName,
}: MatchBreakdownPopoverProps) {
  const t = useTranslations('applicants.breakdown');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const rows = [
    {
      key: 'category',
      label: t('category'),
      score: breakdown.category.score,
      max: breakdown.category.max,
    },
    {
      key: 'experience',
      label: t('experience'),
      score: breakdown.experienceYears.score,
      max: breakdown.experienceYears.max,
      note: t('experienceBasis', {
        clamped: breakdown.experienceYears.clamped,
        raw: breakdown.experienceYears.raw,
      }),
    },
    {
      key: 'foreign',
      label: t('foreign'),
      score: breakdown.foreignExperience.score,
      max: breakdown.foreignExperience.max,
      note:
        breakdown.foreignExperience.score === 0 && jobMarket === 'LOCAL'
          ? t('foreignLocalNote')
          : undefined,
    },
    {
      key: 'documents',
      label: t('documents'),
      score: breakdown.documents.score,
      max: breakdown.documents.max,
    },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t('open', { name: candidateName, score })}
        className="flex min-h-11 items-center gap-1 rounded-lg bg-primary-50 px-2.5 text-sm font-bold tabular-nums text-primary-700 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
      >
        {t('scoreShort', { score })}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('title')}
          className="absolute z-20 mt-1 w-64 rounded-xl border border-neutral-200 bg-white p-3 shadow-lg end-0"
        >
          <p className="mb-2 text-sm font-semibold text-neutral-900">{t('title')}</p>
          <ul className="flex flex-col gap-2">
            {rows.map((r) => {
              const pct = r.max > 0 ? Math.round((r.score / r.max) * 100) : 0;
              return (
                <li key={r.key} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-neutral-700">{r.label}</span>
                    <span className="tabular-nums text-neutral-600">
                      {t('componentScore', { score: r.score, max: r.max })}
                    </span>
                  </div>
                  <div
                    className="h-1.5 overflow-hidden rounded-full bg-neutral-200"
                    role="presentation"
                  >
                    <div
                      className="h-full rounded-full bg-primary-500"
                      style={{ inlineSize: `${pct}%` }}
                    />
                  </div>
                  {r.note && <p className={cn('text-[11px] text-neutral-600')}>{r.note}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
