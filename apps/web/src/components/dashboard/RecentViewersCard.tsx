'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { Eye, Building2 } from 'lucide-react';
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
      className="scroll-mt-20 bg-white rounded-xl border border-neutral-200"
    >
      <div className="flex items-center gap-2 px-4 sm:px-5 py-4 border-b border-neutral-100">
        <Eye className="size-4 text-primary-600" aria-hidden="true" />
        <h2 id="recent-views-heading" className="text-base font-semibold text-neutral-900">
          {t('title')}
        </h2>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <p className="text-sm font-medium text-neutral-700">{t('emptyTitle')}</p>
          <p className="text-xs text-neutral-600">{t('emptyBody')}</p>
          <Link
            href={`/${locale}/profile`}
            className="mt-1 inline-flex min-h-[44px] items-center rounded-md px-3 text-sm font-medium text-primary-600 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            {t('emptyCta')}
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {rows.map((view, i) => (
            <li
              key={`${view.companyName}-${view.viewedAt}-${i}`}
              className="flex items-center gap-3 px-4 sm:px-5 py-3"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-600">
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
