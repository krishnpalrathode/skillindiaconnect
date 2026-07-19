'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { MapPin, Plane, Briefcase } from 'lucide-react';
import { jobCategoryLabelKey } from '@/lib/jobs/categories';
import type { CandidateBrowseCard as CandidateBrowseCardModel } from '@/lib/api/employer-candidates';

interface CandidateBrowseCardProps {
  candidate: CandidateBrowseCardModel;
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
 * Browse result card — the SUBSET fields only (no phone, salary, or documents,
 * none of which exist on CandidateBrowseCard). The whole card is a link to the
 * candidate view; the accessible name combines the candidate name and category
 * so screen-reader users get context without the surrounding chips.
 */
export function CandidateBrowseCard({ candidate }: CandidateBrowseCardProps) {
  const t = useTranslations('employer.candidates');
  const tc = useTranslations('jobs.categories');
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const labelKey = jobCategoryLabelKey(candidate.jobCategoryId);
  const categoryLabel = labelKey ? tc(labelKey) : null;
  const years = candidate.experienceYears ?? 0;

  const srLabel = categoryLabel
    ? t('card.srLabel', { name: candidate.fullName, category: categoryLabel })
    : candidate.fullName;

  return (
    <Link
      href={`/${locale}/employer/candidates/${candidate.id}`}
      aria-label={srLabel}
      className="group flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition-colors hover:border-primary-300 hover:bg-primary-50/20 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-100 text-sm font-semibold text-primary-700">
          {initials(candidate.fullName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-neutral-900 group-hover:text-primary-700">
            {candidate.fullName}
          </p>
          {categoryLabel && <p className="truncate text-sm text-neutral-600">{categoryLabel}</p>}
        </div>
        {/* Availability — text-backed, not colour-only */}
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

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-600">
        {candidate.currentLocation && (
          <span className="flex items-center gap-1">
            <MapPin className="size-3.5" aria-hidden="true" />
            {candidate.currentLocation}
          </span>
        )}
        <span className="flex items-center gap-1">
          <Briefcase className="size-3.5" aria-hidden="true" />
          {t('card.experienceYears', { years })}
        </span>
        {candidate.hasForeignExperience && (
          <span className="inline-flex items-center gap-1 rounded-full bg-info-bg px-2 py-0.5 font-medium text-info-fg">
            <Plane className="size-3" aria-hidden="true" />
            {t('card.gulfExperience')}
          </span>
        )}
      </div>

      {candidate.skills && candidate.skills.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('card.skillsLabel')}>
          {candidate.skills.slice(0, 3).map((skill) => (
            <li
              key={skill}
              className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600"
            >
              {skill}
            </li>
          ))}
        </ul>
      )}
    </Link>
  );
}
