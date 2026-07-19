'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Application = components['schemas']['Application'];
type JobMarket = components['schemas']['JobMarket'];

interface MatchRevealCardProps {
  application: Application;
  jobMarket: JobMarket;
  locale: string;
}

/**
 * Success reveal. Every value comes from the 201 payload's snapshot — NOTHING is
 * recomputed client-side. Bars are text-backed ({score}/{max} shown, not
 * color-only) and use logical sizing so they mirror under RTL. The foreign
 * component's 0 on a LOCAL job gets an explanatory note so it doesn't read as a bug.
 */
export function MatchRevealCard({ application, jobMarket, locale }: MatchRevealCardProps) {
  const t = useTranslations('apply.reveal');
  const b = application.matchBreakdown;

  const rows: { key: string; label: string; score: number; max: number; note?: string }[] = [
    { key: 'category', label: t('category'), score: b.category.score, max: b.category.max },
    {
      key: 'experience',
      label: t('experience'),
      score: b.experienceYears.score,
      max: b.experienceYears.max,
      note: t('experienceBasis', {
        clamped: b.experienceYears.clamped,
        raw: b.experienceYears.raw,
      }),
    },
    {
      key: 'foreign',
      label: t('foreign'),
      score: b.foreignExperience.score,
      max: b.foreignExperience.max,
      note:
        b.foreignExperience.score === 0 && jobMarket === 'LOCAL'
          ? t('foreignLocalNote')
          : undefined,
    },
    { key: 'documents', label: t('documents'), score: b.documents.score, max: b.documents.max },
  ];

  return (
    <div className="flex flex-col gap-5 py-2 text-center">
      <div className="flex flex-col items-center gap-1">
        <span className="flex size-12 items-center justify-center rounded-full bg-success-bg">
          <CheckCircle2 className="size-7 text-success-fg" aria-hidden="true" />
        </span>
        <p className="text-2xl font-bold text-neutral-900">
          {t('score', { score: application.matchScore })}
        </p>
        <p className="text-xs font-medium text-neutral-600">{application.humanId}</p>
      </div>

      <ul className="flex flex-col gap-3 text-start">
        {rows.map((r) => {
          const pct = r.max > 0 ? Math.round((r.score / r.max) * 100) : 0;
          return (
            <li key={r.key} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium text-neutral-800">{r.label}</span>
                <span className="tabular-nums text-neutral-600">
                  {t('componentScore', { score: r.score, max: r.max })}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-neutral-200" role="presentation">
                <div
                  className="h-full rounded-full bg-primary-500"
                  style={{ inlineSize: `${pct}%` }}
                />
              </div>
              {r.note && <p className="text-xs text-neutral-600">{r.note}</p>}
            </li>
          );
        })}
      </ul>

      <Link
        href={`/${locale}/applications`}
        className={cn(buttonVariants({ variant: 'primary' }), 'min-h-11')}
      >
        {t('track')}
      </Link>
    </div>
  );
}
