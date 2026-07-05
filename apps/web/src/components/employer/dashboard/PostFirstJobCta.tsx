'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { PlusCircle, Briefcase } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';

type CompanyStatus = components['schemas']['CompanyStatus'];

interface PostFirstJobCtaProps {
  companyStatus: CompanyStatus | null;
}

/**
 * Prominent CTA guiding the employer to post their first job.
 * Disabled (with tooltip) when company is not yet APPROVED — mirrors the
 * approval gate in the F0 sidebar nav.
 */
export function PostFirstJobCta({ companyStatus }: PostFirstJobCtaProps) {
  const t = useTranslations('employer.dashboard.postJobCta');
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const isApproved = companyStatus === 'APPROVED';

  return (
    <div className="bg-gradient-to-br from-primary-600 to-secondary-500 rounded-2xl p-6 sm:p-8 text-white flex flex-col sm:flex-row items-start sm:items-center gap-6">
      <span className="size-14 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
        <Briefcase className="size-7 text-white" aria-hidden="true" />
      </span>

      <div className="flex-1 min-w-0">
        <h2 className="text-xl font-bold">{t('title')}</h2>
        <p className="text-sm text-white/80 mt-1">{t('body')}</p>
      </div>

      {isApproved ? (
        <Link
          href={`/${locale}/employer/jobs/new`}
          className="shrink-0 inline-flex items-center gap-2 px-5 py-2.5 bg-white text-primary-700 font-semibold text-sm rounded-xl hover:bg-white/90 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/70 min-h-[44px]"
        >
          <PlusCircle className="size-4" aria-hidden="true" />
          {t('button')}
        </Link>
      ) : (
        <span
          title={t('pendingTooltip')}
          aria-label={`${t('button')} — ${t('pendingTooltip')}`}
          className="shrink-0 inline-flex items-center gap-2 px-5 py-2.5 bg-white/30 text-white/60 font-semibold text-sm rounded-xl cursor-not-allowed select-none min-h-[44px]"
        >
          <PlusCircle className="size-4" aria-hidden="true" />
          {t('button')}
        </span>
      )}
    </div>
  );
}
