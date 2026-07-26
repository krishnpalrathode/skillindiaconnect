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
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0F3D91] via-[#2E67B1] to-[#0F3D91] p-6 sm:p-8 text-white flex flex-col sm:flex-row items-start sm:items-center gap-6 shadow-lg shadow-[#0F3D91]/20">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -end-16 -top-16 size-56 rounded-full bg-[#F57C20]/20 blur-3xl"
      />
      <span className="relative size-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0 ring-1 ring-white/25">
        <Briefcase className="size-7 text-white" aria-hidden="true" />
      </span>

      <div className="relative flex-1 min-w-0">
        <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{t('title')}</h2>
        <p className="text-sm text-white/85 mt-1.5">{t('body')}</p>
      </div>

      {isApproved ? (
        <Link
          href={`/${locale}/employer/jobs/new`}
          className="relative shrink-0 inline-flex items-center gap-2 px-6 py-3 bg-white text-[#0F3D91] font-semibold text-sm rounded-xl shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/70 min-h-[44px]"
        >
          <PlusCircle className="size-4" aria-hidden="true" />
          {t('button')}
        </Link>
      ) : (
        <span
          title={t('pendingTooltip')}
          aria-label={`${t('button')} — ${t('pendingTooltip')}`}
          className="relative shrink-0 inline-flex items-center gap-2 px-6 py-3 bg-white/25 text-white/70 font-semibold text-sm rounded-xl cursor-not-allowed select-none min-h-[44px] ring-1 ring-white/20"
        >
          <PlusCircle className="size-4" aria-hidden="true" />
          {t('button')}
        </span>
      )}
    </div>
  );
}
