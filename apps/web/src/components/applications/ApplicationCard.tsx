'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { MapPin } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Badge } from '@/components/ui/badge';
import { formatPostedAgo } from '@/lib/jobs/format';
import { WhatsAppReceipt } from './WhatsAppReceipt';

type ApplicationCard = components['schemas']['ApplicationCard'];
type ApplicationStatus = components['schemas']['ApplicationStatus'];

/**
 * F0 Badge semantics mapped to application status (named by MEANING, tested):
 *  - SELECTED    → success (green)
 *  - SHORTLISTED → info    (blue — the "in progress / good news pending" tier)
 *  - REJECTED    → error   (red)
 *  - PENDING     → neutral (grey — awaiting employer action)
 */
export const STATUS_VARIANT: Record<ApplicationStatus, 'success' | 'info' | 'error' | 'neutral'> = {
  SELECTED: 'success',
  SHORTLISTED: 'info',
  REJECTED: 'error',
  PENDING: 'neutral',
};

interface ApplicationCardProps {
  application: ApplicationCard;
  locale: string;
}

export function ApplicationCard({ application: a, locale }: ApplicationCardProps) {
  const t = useTranslations('applications');
  const tCard = useTranslations('jobs.card');

  return (
    <Link
      href={`/${locale}/applications/${a.id}`}
      className="block rounded-xl border border-neutral-200 bg-white p-4 transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={a.job.market === 'GULF' ? 'primary' : 'accent'}>
            {tCard(a.job.market === 'GULF' ? 'marketGulf' : 'marketLocal')}
          </Badge>
          <Badge variant={STATUS_VARIANT[a.status]}>{t(`status.${a.status}`)}</Badge>
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-neutral-700">
          {t('matchShort', { score: a.matchScore })}
        </span>
      </div>

      <h3 className="mt-2 text-base font-semibold text-neutral-900">{a.job.title}</h3>
      <p className="text-sm text-neutral-600">{a.job.companyName}</p>
      <p className="mt-1 flex items-center gap-1 text-sm text-neutral-600">
        <MapPin className="size-4 shrink-0" aria-hidden="true" />
        {a.job.location}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-600">
        <span className="font-medium">{a.humanId}</span>
        <span>{t('appliedAgo', { ago: formatPostedAgo(a.appliedAt, locale) })}</span>
      </div>

      {/* Field-driven — the receipt shows ONLY when selectedNotifiedAt is set. */}
      {a.selectedNotifiedAt && (
        <div className="mt-2">
          <WhatsAppReceipt notifiedAt={a.selectedNotifiedAt} locale={locale} />
        </div>
      )}

      {/* Rejected + feedback → a one-line preview (constructive, not a wall of red). */}
      {a.status === 'REJECTED' && a.rejectionFeedback && (
        <p className="mt-2 line-clamp-1 text-xs italic text-neutral-600">
          &ldquo;{a.rejectionFeedback}&rdquo;
        </p>
      )}
    </Link>
  );
}
