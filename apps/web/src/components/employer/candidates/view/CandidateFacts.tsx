'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import type { CandidateEmployerView } from '@/lib/api/employer-candidates';

interface CandidateFactsProps {
  candidate: CandidateEmployerView;
}

/**
 * Absence-aware facts list (the privacy mirror).
 *
 * The row list is BUILT from fields that are actually present — never a fixed
 * template with conditional blanks. An omitted key (e.g. `phone` when the
 * candidate has showPhone = false, or `religion` by default) produces NO row
 * and NO label, so the field's very existence is never revealed. We never emit
 * a "hidden by candidate" placeholder.
 */
export function CandidateFacts({ candidate }: CandidateFactsProps) {
  const t = useTranslations('employer.candidates.view.facts');

  const rows: Array<{ key: string; label: string; value: string }> = [];

  if (candidate.nationality) {
    rows.push({ key: 'nationality', label: t('nationality'), value: candidate.nationality });
  }
  if (candidate.languages && candidate.languages.length > 0) {
    rows.push({ key: 'languages', label: t('languages'), value: candidate.languages.join(', ') });
  }
  if (typeof candidate.noticePeriod === 'number') {
    rows.push({
      key: 'notice',
      label: t('noticePeriod'),
      value: t('noticeDays', { days: candidate.noticePeriod }),
    });
  }
  // Present ONLY when the candidate exposes them — omission renders nothing.
  if (candidate.phone) {
    rows.push({ key: 'phone', label: t('phone'), value: candidate.phone });
  }
  if (candidate.religion) {
    rows.push({ key: 'religion', label: t('religion'), value: candidate.religion });
  }

  if (rows.length === 0) return null;

  return (
    <section
      aria-labelledby="candidate-facts-heading"
      className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
    >
      <h2 id="candidate-facts-heading" className="mb-4 text-base font-semibold text-neutral-900">
        {t('title')}
      </h2>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.key} className="flex flex-col gap-0.5">
            <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">
              {row.label}
            </dt>
            <dd className="text-sm text-neutral-900">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
