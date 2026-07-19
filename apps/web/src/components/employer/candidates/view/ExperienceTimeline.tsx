'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Briefcase } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';

type WorkExperience = components['schemas']['WorkExperience'];

interface ExperienceTimelineProps {
  experiences: WorkExperience[];
}

function useDuration() {
  const t = useTranslations('employer.candidates.view.timeline');
  return (exp: WorkExperience): string => {
    const parts: string[] = [];
    if (exp.years) parts.push(t('years', { count: exp.years }));
    if (exp.months) parts.push(t('months', { count: exp.months }));
    return parts.join(' ');
  };
}

/**
 * Work-experience timeline. Each entry carries an India/Foreign type badge and,
 * where present, country, company, role, and duration. RTL-safe: the rail and
 * spacing use logical properties so the timeline mirrors under `dir="rtl"`.
 */
export function ExperienceTimeline({ experiences }: ExperienceTimelineProps) {
  const t = useTranslations('employer.candidates.view.timeline');
  const formatDuration = useDuration();

  if (experiences.length === 0) return null;

  return (
    <section
      aria-labelledby="candidate-experience-heading"
      className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
    >
      <h2
        id="candidate-experience-heading"
        className="mb-4 text-base font-semibold text-neutral-900"
      >
        {t('title')}
      </h2>
      <ol className="flex flex-col gap-4">
        {experiences.map((exp) => {
          const isForeign = exp.type === 'FOREIGN';
          const duration = formatDuration(exp);
          return (
            <li key={exp.id} className="flex gap-3 border-s-2 border-neutral-100 ps-4">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600">
                <Briefcase className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {exp.role && (
                    <span className="text-sm font-semibold text-neutral-900">{exp.role}</span>
                  )}
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      isForeign ? 'bg-info-bg text-info-fg' : 'bg-neutral-100 text-neutral-600'
                    }`}
                  >
                    {isForeign ? t('foreign') : t('india')}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-neutral-600">
                  {exp.companyName && <span>{exp.companyName}</span>}
                  {exp.country && <span>· {exp.country}</span>}
                </div>
                {duration && <p className="mt-0.5 text-xs text-neutral-600">{duration}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
