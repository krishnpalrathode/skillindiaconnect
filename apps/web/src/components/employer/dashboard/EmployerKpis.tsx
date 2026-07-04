'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Briefcase, Eye, Star, Users, CheckCircle2, Info } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';

type EmployerDashboardKpi = components['schemas']['EmployerDashboardKpi'];

interface EmployerKpisProps {
  kpis: EmployerDashboardKpi;
}

/**
 * Dashboard KPI row (Screen 15, S3).
 *
 * `activeJobs` and `totalJobViews` are LIVE aggregates. `totalApplications`,
 * `shortlisted`, and `hiredThisMonth` are honest zeros until applications ship
 * (Sprint 4) — they render the API's real value (0) with a muted
 * "available once applications open" caption so the dashboard reads as honest
 * rather than broken. We never fabricate a number and never hide the metric.
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
      pending: false,
    },
    {
      key: 'totalJobViews',
      label: t('totalJobViews'),
      value: kpis.totalJobViews,
      icon: <Eye className="size-5" aria-hidden="true" />,
      colorClass: 'text-success-fg',
      bgClass: 'bg-success-bg',
      pending: false,
    },
    {
      key: 'totalApplications',
      label: t('totalApplications'),
      value: kpis.totalApplications,
      icon: <Users className="size-5" aria-hidden="true" />,
      colorClass: 'text-accent-600',
      bgClass: 'bg-orange-50',
      pending: true,
    },
    {
      key: 'shortlisted',
      label: t('shortlisted'),
      value: kpis.shortlisted,
      icon: <Star className="size-5" aria-hidden="true" />,
      colorClass: 'text-warning-fg',
      bgClass: 'bg-warning-bg',
      pending: true,
    },
    {
      key: 'hiredThisMonth',
      label: t('hired'),
      value: kpis.hiredThisMonth,
      icon: <CheckCircle2 className="size-5" aria-hidden="true" />,
      colorClass: 'text-info-fg',
      bgClass: 'bg-info-bg',
      pending: true,
    },
  ] as const;

  return (
    <dl className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
      {cards.map(({ key, label, value, icon, colorClass, bgClass, pending }) => (
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
            <dt className="text-xs text-neutral-500 mt-0.5 flex items-center gap-1">
              {label}
              {pending && <Info className="size-3 text-neutral-400 shrink-0" aria-hidden="true" />}
            </dt>
            {pending && <p className="text-[11px] text-neutral-400 mt-1">{t('pendingHint')}</p>}
          </div>
        </div>
      ))}
    </dl>
  );
}
