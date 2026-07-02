'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Briefcase, Users, Star, UserCheck } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';

type EmployerDashboardKpi = components['schemas']['EmployerDashboardKpi'];

interface EmployerKpisProps {
  kpis: EmployerDashboardKpi;
}

/**
 * KPI cards for the employer dashboard.
 * At S2, all values come from GET /employers/me/dashboard which returns 0 for
 * totalApplications, shortlisted, and selected (no applications exist yet in S2).
 * activeJobs reflects actual posted jobs once S2-B5 ships. All values are honest —
 * no fabricated numbers.
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
      key: 'hired',
      label: t('hired'),
      value: kpis.selected,
      icon: <UserCheck className="size-5" aria-hidden="true" />,
      colorClass: 'text-success-fg',
      bgClass: 'bg-success-bg',
    },
  ] as const;

  return (
    <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
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
            <dt className="text-xs text-neutral-500 mt-0.5">{label}</dt>
          </div>
        </div>
      ))}
    </dl>
  );
}
