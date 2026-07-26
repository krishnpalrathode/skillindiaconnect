'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Briefcase, Eye, Star, Users, CheckCircle2 } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';

type EmployerDashboardKpi = components['schemas']['EmployerDashboardKpi'];

interface EmployerKpisProps {
  kpis: EmployerDashboardKpi;
}

/**
 * Dashboard KPI row (Screen 15).
 *
 * ALL five metrics are LIVE aggregates. `totalApplications`, `shortlisted`, and
 * `hiredThisMonth` went live in the S4-B3 rewiring — the S3 "available once
 * applications open" placeholder caption has retired (mirrors the candidate
 * KpiCards). We render the API's real value and never fabricate or hide a metric.
 */
export function EmployerKpis({ kpis }: EmployerKpisProps) {
  const t = useTranslations('employer.dashboard.kpi');

  const cards = [
    {
      key: 'activeJobs',
      label: t('activeJobs'),
      value: kpis.activeJobs,
      icon: <Briefcase className="size-5" aria-hidden="true" />,
      colorClass: 'text-[#0F3D91]',
      bgClass: 'bg-[#E8F0FE]',
    },
    {
      key: 'totalJobViews',
      label: t('totalJobViews'),
      value: kpis.totalJobViews,
      icon: <Eye className="size-5" aria-hidden="true" />,
      colorClass: 'text-success-fg',
      bgClass: 'bg-success-bg',
    },
    {
      key: 'totalApplications',
      label: t('totalApplications'),
      value: kpis.totalApplications,
      icon: <Users className="size-5" aria-hidden="true" />,
      colorClass: 'text-accent-600',
      bgClass: 'bg-accent-100',
    },
    {
      key: 'shortlisted',
      label: t('shortlisted'),
      value: kpis.shortlisted,
      icon: <Star className="size-5" aria-hidden="true" />,
      colorClass: 'text-[#7C3AED]',
      bgClass: 'bg-[#F3E8FF]',
    },
    {
      key: 'hiredThisMonth',
      label: t('hired'),
      value: kpis.hiredThisMonth,
      icon: <CheckCircle2 className="size-5" aria-hidden="true" />,
      colorClass: 'text-info-fg',
      bgClass: 'bg-info-bg',
    },
  ] as const;

  return (
    <dl className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
      {cards.map(({ key, label, value, icon, colorClass, bgClass }) => (
        <div
          key={key}
          className="group flex flex-col gap-3 rounded-2xl border border-neutral-200/70 bg-white/90 p-4 shadow-sm backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md sm:p-5"
        >
          <span
            className={`size-11 rounded-xl flex items-center justify-center transition-transform duration-200 group-hover:scale-105 ${bgClass} ${colorClass}`}
          >
            {icon}
          </span>
          <div>
            <dd
              className="text-2xl font-bold tabular-nums leading-tight text-neutral-900"
              aria-label={`${label}: ${value}`}
            >
              {value}
            </dd>
            <dt className="text-xs font-medium text-neutral-600 mt-1">{label}</dt>
          </div>
        </div>
      ))}
    </dl>
  );
}
