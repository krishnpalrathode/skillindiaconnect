'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { Eye, Building2, FileSearch } from 'lucide-react';
import type { ProfileViewsSummary } from '@/lib/api/profile-views';

interface RecentViewersCardProps {
  /** null when the profile-views fetch failed — the card degrades to its empty state. */
  summary: ProfileViewsSummary | null;
}

const MAX_ROWS = 5;

/**
 * "Recent profile views" — the recent-viewers surface on the candidate dashboard
 * (Screen 06), anchored at #recent-views (the Profile Views KPI links here).
 *
 * Company NAME is the entire viewer identity the API sends — no logos, no links
 * to employer pages (candidates have none to visit). Relative times localize via
 * Intl.RelativeTimeFormat so they mirror correctly under RTL.
 */
export function RecentViewersCard({ summary }: RecentViewersCardProps) {
  const t = useTranslations('dashboard.recentViews');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';

  const rows = summary?.recentViews?.slice(0, MAX_ROWS) ?? [];

  return (
    <section
      id="recent-views"
      aria-labelledby="recent-views-heading"
      className="scroll-mt-20 overflow-hidden rounded-2xl border border-neutral-200/70 bg-white/90 shadow-sm backdrop-blur-sm"
    >
      <div className="flex items-center gap-2.5 border-b border-neutral-100 px-5 py-4 sm:px-6">
        <span className="flex size-8 items-center justify-center rounded-lg bg-[#E8F0FE] text-[#0F3D91]">
          <Eye className="size-4" aria-hidden="true" />
        </span>
        <h2 id="recent-views-heading" className="text-base font-semibold text-neutral-900">
          {t('title')}
        </h2>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
          <span
            className="flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-[#EEF3FB] to-[#E8F0FE] text-[#0F3D91] ring-8 ring-[#F5F8FC]"
            aria-hidden="true"
          >
            <FileSearch className="size-9" />
          </span>
          <p className="text-base font-semibold text-neutral-900">{t('emptyTitle')}</p>
          <p className="max-w-xs text-sm text-neutral-600">{t('emptyBody')}</p>
          <Link
            href={`/${locale}/profile`}
            className="mt-2 inline-flex min-h-[44px] items-center rounded-xl bg-[#0F3D91] px-5 text-sm font-semibold text-white shadow-sm shadow-[#0F3D91]/20 transition-all hover:bg-[#0d3479] hover:shadow-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            {t('emptyCta')}
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {rows.map((view, i) => (
            <li
              key={`${view.companyName}-${view.viewedAt}-${i}`}
              className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-neutral-50/70 sm:px-6"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#E8F0FE] text-[#0F3D91]">
                <Building2 className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-900">{view.companyName}</p>
              </div>
              <time
                dateTime={view.viewedAt}
                className="shrink-0 text-xs text-neutral-600 tabular-nums"
              >
                {formatRelativeTime(view.viewedAt, locale)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Locale-aware, RTL-safe relative time (e.g. "2h ago" / "منذ ساعتين"). */
function formatRelativeTime(iso: string, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const diffMs = new Date(iso).getTime() - Date.now();
  const mins = Math.round(diffMs / 60_000);
  if (Math.abs(mins) < 60) return rtf.format(mins, 'minute');
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  const days = Math.round(hours / 24);
  return rtf.format(days, 'day');
}
