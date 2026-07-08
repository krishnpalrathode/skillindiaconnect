'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import type { CandidateStats } from '@/lib/api/dashboard';
import type { ProfileViewsSummary } from '@/lib/api/profile-views';

interface KpiCardsProps {
  stats: CandidateStats;
  unreadCount: number;
  /**
   * Profile-view analytics. `undefined` → still loading (skeleton);
   * `null` → the fetch failed (quiet dash — never a fabricated 0).
   */
  profileViews: ProfileViewsSummary | null | undefined;
}

interface KpiCardProps {
  label: string;
  value: number | string;
  href?: string;
  caption?: string;
  srLabel?: string;
  loading?: boolean;
}

function KpiCard({ label, value, href, caption, srLabel, loading }: KpiCardProps) {
  const content = (
    <div className="bg-white rounded-xl border border-neutral-200 px-4 py-5 flex flex-col gap-1 hover:shadow-sm transition-shadow min-h-[92px]">
      {loading ? (
        <Skeleton className="h-8 w-10" />
      ) : (
        <span className="text-2xl font-bold text-neutral-900 tabular-nums" aria-hidden={!!srLabel}>
          {value}
        </span>
      )}
      <span className="text-sm text-neutral-500 leading-snug">{label}</span>
      {caption && <span className="text-xs text-neutral-400 leading-snug">{caption}</span>}
    </div>
  );
  if (href) {
    return (
      <Link
        href={href}
        aria-label={srLabel}
        className="block focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded-xl"
      >
        {content}
      </Link>
    );
  }
  if (srLabel) {
    return (
      <div role="group" aria-label={srLabel}>
        {content}
      </div>
    );
  }
  return content;
}

export function KpiCards({ stats, unreadCount, profileViews }: KpiCardsProps) {
  const t = useTranslations('dashboard.kpi');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';

  // Profile Views surfaces last30Days. undefined = loading, null = failed fetch
  // (quiet dash), so a real "0 views" and a failed fetch never look identical.
  const viewsLoading = profileViews === undefined;
  const viewsValue = profileViews == null ? '—' : profileViews.last30Days;
  const viewsSrLabel =
    profileViews && profileViews.last30Days >= 0
      ? t('viewsSrLabel', { count: profileViews.last30Days })
      : undefined;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {/* S4-F2: the values are live (GET /candidates/me/stats) and now link into
          Screen 08 — the "once applications open" placeholder is gone. */}
      <KpiCard label={t('applied')} value={stats.applied} href={`/${locale}/applications`} />
      <KpiCard
        label={t('views')}
        value={viewsValue}
        caption={t('viewsCaption')}
        href="#recent-views"
        srLabel={viewsSrLabel}
        loading={viewsLoading}
      />
      <KpiCard
        label={t('shortlisted')}
        value={stats.shortlisted}
        href={`/${locale}/applications?status=SHORTLISTED`}
      />
      <KpiCard label={t('updates')} value={unreadCount} href={`/${locale}/notifications`} />
    </div>
  );
}
