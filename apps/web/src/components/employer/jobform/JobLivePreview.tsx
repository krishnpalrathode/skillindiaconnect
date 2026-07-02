'use client';

import React, { useDeferredValue } from 'react';
import { useTranslations } from 'next-intl';
import { Eye } from 'lucide-react';
import { BenefitChips } from '@/components/jobs/BenefitChips';
import { Badge } from '@/components/ui/badge';
import { MapPin } from 'lucide-react';
import { formatSalaryRange } from '@/lib/jobs/format';
import { formToPreview, type JobFormValues } from '@/lib/jobs/jobFormState';

interface JobLivePreviewProps {
  values: JobFormValues;
  companyName: string;
  locale: string;
}

export function JobLivePreview({ values, companyName, locale }: JobLivePreviewProps) {
  const t = useTranslations('jobform.preview');
  // Defer preview derivation so slow devices don't jank on every keystroke
  const deferredValues = useDeferredValue(values);
  const preview = formToPreview(deferredValues, companyName);
  const salary = formatSalaryRange(
    preview.salaryMin,
    preview.salaryMax,
    preview.salaryCurrency,
    locale,
  );

  return (
    <div className="sticky top-6 flex flex-col gap-3" aria-label={t('panelLabel')} role="region">
      <div className="flex items-center gap-2">
        <Eye className="size-4 text-neutral-400" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-neutral-600 uppercase tracking-wide">
          {t('heading')}
        </h3>
      </div>
      <p className="text-xs text-neutral-400">{t('subtitle')}</p>

      {/* Preview card — matches S2-F1 JobCard layout exactly (single source) */}
      <div
        aria-live="polite"
        aria-atomic="true"
        aria-label={t('liveRegionLabel')}
        className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden"
      >
        {/* Card header */}
        <div className="p-4 flex flex-wrap items-center gap-1.5 border-b border-neutral-100">
          <Badge variant={preview.market === 'GULF' ? 'primary' : 'accent'}>
            {preview.market === 'GULF' ? 'Gulf' : 'India'}
          </Badge>
          <Badge variant="info">New</Badge>
        </div>

        {/* Card content */}
        <div className="p-4 flex flex-col gap-2">
          <div>
            <h4 className="text-base font-semibold text-neutral-900 leading-snug">
              {preview.title}
            </h4>
            <p className="text-sm text-neutral-600">{preview.companyName}</p>
          </div>

          <p className="flex items-center gap-1 text-sm text-neutral-500">
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            {preview.location}
          </p>

          {salary && <p className="text-sm font-medium text-neutral-900">{salary}</p>}

          <BenefitChips job={preview} />

          <p className="mt-auto text-xs text-neutral-400">{t('justPosted')}</p>
        </div>

        {/* Card footer */}
        <div className="px-4 py-3 border-t border-neutral-100">
          <span className="text-sm font-medium text-primary-600">{t('viewDetails')}</span>
        </div>
      </div>

      <p className="text-xs text-neutral-400 italic">{t('previewNote')}</p>
    </div>
  );
}
