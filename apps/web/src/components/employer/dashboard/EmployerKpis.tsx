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
      colorClass: 'text-primary-600',
      bgClass: 'bg-primary-50',
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
      bgClass: 'bg-orange-50',
    },
    {
      key: 'shortlisted',
      label: t('shortlisted'),
      value: kpis.shortlisted,
      icon: <Star className="size-5" aria-hidden="true" />,
      colorClass: 'text-warning-fg',
      bgClass: 'bg-warning-bg',
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
          className="bg-white rounded-xl border border-neutral-200 p-4 flex flex-col gap-3"
        >
          <span
            className={`size-10 rounded-lg flex items-center justify-center ${bgClass} ${colorClass}`}
          >
            {icon}
          </span>
          <div>
            <dd
              className="text-2xl font-bold tabular-nums text-neutral-900"
              aria-label={`${label}: ${value}`}
            >
              {value}
            </dd>
            <dt className="text-xs text-neutral-600 mt-0.5">{label}</dt>
          </div>
        </div>
      ))}
    </dl>
  );
}
