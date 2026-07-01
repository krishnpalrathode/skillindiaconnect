'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import type { CandidateStats } from '@/lib/api/dashboard';

interface KpiCardsProps {
  stats: CandidateStats;
  unreadCount: number;
}

interface KpiCardProps {
  label: string;
  value: number | string;
  href?: string;
}

function KpiCard({ label, value, href }: KpiCardProps) {
  const content = (
    <div className="bg-white rounded-xl border border-neutral-200 px-4 py-5 flex flex-col gap-1 hover:shadow-sm transition-shadow">
      <span className="text-2xl font-bold text-neutral-900 tabular-nums">{value}</span>
      <span className="text-sm text-neutral-500 leading-snug">{label}</span>
    </div>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="block focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded-xl"
      >
        {content}
      </Link>
    );
  }
  return content;
}

export function KpiCards({ stats, unreadCount }: KpiCardsProps) {
  const t = useTranslations('dashboard.kpi');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <KpiCard label={t('applied')} value={stats.applied} />
      <KpiCard label={t('views')} value={stats.profileViews} />
      <KpiCard label={t('shortlisted')} value={stats.shortlisted} />
      <KpiCard label={t('updates')} value={unreadCount} href={`/${locale}/notifications`} />
    </div>
  );
}
