'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { Briefcase, Eye, Bookmark, Bell } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
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
  icon: React.ReactNode;
  /** Tailwind classes for the icon tile (bg + text color). */
  iconClassName: string;
  href?: string;
  caption?: string;
  srLabel?: string;
  loading?: boolean;
}

function KpiCard({
  label,
  value,
  icon,
  iconClassName,
  href,
  caption,
  srLabel,
  loading,
}: KpiCardProps) {
  const content = (
    <div className="flex h-full min-h-[104px] items-start gap-3 rounded-2xl border border-neutral-200/70 bg-white/90 px-4 py-4 shadow-sm backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-neutral-200 hover:shadow-md sm:px-5">
      <span
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-xl',
          iconClassName,
        )}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-col">
        {loading ? (
          <Skeleton className="h-8 w-10" />
        ) : (
          <span
            className="text-2xl font-bold leading-tight text-neutral-900 tabular-nums"
            aria-hidden={!!srLabel}
          >
            {value}
          </span>
        )}
        <span className="text-sm font-medium leading-snug text-neutral-700">{label}</span>
        {caption && <span className="text-xs leading-snug text-neutral-600">{caption}</span>}
      </div>
    </div>
  );
  if (href) {
    return (
      <Link
        href={href}
        aria-label={srLabel}
        className="block rounded-2xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
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
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
      {/* S4-F2: the values are live (GET /candidates/me/stats) and now link into
          Screen 08 — the "once applications open" placeholder is gone. */}
      <KpiCard
        label={t('applied')}
        value={stats.applied}
        caption={t('appliedCaption')}
        icon={<Briefcase className="size-5" aria-hidden="true" />}
        iconClassName="bg-[#E8F0FE] text-[#0F3D91]"
        href={`/${locale}/applications`}
      />
      <KpiCard
        label={t('views')}
        value={viewsValue}
        caption={t('viewsCaption')}
        icon={<Eye className="size-5" aria-hidden="true" />}
        iconClassName="bg-success-bg text-success-fg"
        href="#recent-views"
        srLabel={viewsSrLabel}
        loading={viewsLoading}
      />
      <KpiCard
        label={t('shortlisted')}
        value={stats.shortlisted}
        caption={t('shortlistedCaption')}
        icon={<Bookmark className="size-5" aria-hidden="true" />}
        iconClassName="bg-[#F3E8FF] text-[#7C3AED]"
        href={`/${locale}/applications?status=SHORTLISTED`}
      />
      <KpiCard
        label={t('updates')}
        value={unreadCount}
        caption={t('updatesCaption')}
        icon={<Bell className="size-5" aria-hidden="true" />}
        iconClassName="bg-accent-100 text-accent-600"
        href={`/${locale}/notifications`}
      />
    </div>
  );
}
