'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { formatMonthYear } from '@/lib/format/date';
import { MapPin, CalendarClock } from 'lucide-react';
import { jobCategoryLabelKey } from '@/lib/jobs/categories';
import type { CandidateEmployerView } from '@/lib/api/employer-candidates';

interface CandidateViewHeaderProps {
  candidate: CandidateEmployerView;
  locale: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

/**
 * Candidate view header. Renders name, and — only when present — age, category,
 * and location. `dob` is never in the payload; only the derived `age` may be
 * shown. `createdAt` is surfaced as "member since". There is no photo field on
 * the employer view, so we render an initials avatar.
 */
export function CandidateViewHeader({ candidate, locale }: CandidateViewHeaderProps) {
  const t = useTranslations('employer.candidates');
  const tc = useTranslations('jobs.categories');

  const labelKey = jobCategoryLabelKey(candidate.jobCategoryId);
  const categoryLabel = labelKey ? tc(labelKey) : null;
  const memberSince = formatMonthYear(candidate.createdAt, locale);

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center">
      <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xl font-semibold text-primary-700">
        {initials(candidate.fullName)}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold text-neutral-900">{candidate.fullName}</h1>
          {typeof candidate.age === 'number' && (
            <span className="text-sm text-neutral-600">
              {t('view.ageYears', { age: candidate.age })}
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              candidate.isAvailable
                ? 'bg-success-bg text-success-fg'
                : 'bg-neutral-100 text-neutral-600'
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${candidate.isAvailable ? 'bg-success-fg' : 'bg-neutral-400'}`}
              aria-hidden="true"
            />
            {candidate.isAvailable ? t('available') : t('notAvailable')}
          </span>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-600">
          {categoryLabel && <span>{categoryLabel}</span>}
          {candidate.currentLocation && (
            <span className="flex items-center gap-1">
              <MapPin className="size-3.5" aria-hidden="true" />
              {candidate.currentLocation}
            </span>
          )}
          <span className="flex items-center gap-1">
            <CalendarClock className="size-3.5" aria-hidden="true" />
            {t('view.memberSince', { date: memberSince })}
          </span>
        </div>
      </div>
    </div>
  );
}
