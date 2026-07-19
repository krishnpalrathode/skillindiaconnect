'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { MapPin, Check, X, Phone } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatPostedAgo } from '@/lib/jobs/format';
import { cn } from '@/lib/utils';
import { MatchBreakdownPopover } from './MatchBreakdownPopover';
import { ApplicantActions } from './ApplicantActions';
import { DocumentViewButton } from '@/components/billing/DocumentViewButton';

type ApplicantCard = components['schemas']['ApplicantCard'];
type ApplicationStatus = components['schemas']['ApplicationStatus'];
type JobMarket = components['schemas']['JobMarket'];
type DocumentType = components['schemas']['DocumentType'];

export const APPLICANT_STATUS_VARIANT: Record<
  ApplicationStatus,
  'success' | 'info' | 'error' | 'neutral'
> = { SELECTED: 'success', SHORTLISTED: 'info', REJECTED: 'error', PENDING: 'neutral' };

const DOC_TYPES: DocumentType[] = ['PASSPORT', 'EXPERIENCE_CERT', 'EDUCATIONAL_CERT'];

function initials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

interface ApplicantCardProps {
  applicant: ApplicantCard;
  jobMarket: JobMarket;
  locale: string;
  busy: boolean;
  onTransition: (to: ApplicationStatus, opts?: { rejectionFeedback?: string }) => void;
  onOpenDetail: () => void;
}

export function ApplicantCard({
  applicant: a,
  jobMarket,
  locale,
  busy,
  onTransition,
  onOpenDetail,
}: ApplicantCardProps) {
  const t = useTranslations('applicants');
  const [expanded, setExpanded] = useState(false);

  const years = (a.experiences ?? []).reduce(
    (s, e) => s + (e.years ?? 0) + (e.months ?? 0) / 12,
    0,
  );
  const hasForeign = (a.experiences ?? []).some((e) => e.type === 'FOREIGN');
  const docsByType = new Map((a.documentsStatus ?? []).map((d) => [d.type, d]));

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-100 text-sm font-semibold text-primary-700">
          {initials(a.fullName)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              onClick={onOpenDetail}
              className="text-base font-semibold text-neutral-900 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
            >
              {a.fullName}
            </button>
            <Badge variant={APPLICANT_STATUS_VARIANT[a.status]}>{t(`status.${a.status}`)}</Badge>
            {hasForeign && <Badge variant="primary">{t('gulfBadge')}</Badge>}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-neutral-600">
            {a.age != null && <span>{t('ageYears', { age: a.age })}</span>}
            {a.currentLocation && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden="true" />
                {a.currentLocation}
              </span>
            )}
            <span>{t('expYears', { years: Math.round(years) })}</span>
          </p>
          {/* Phone renders ONLY when present — hidden-phone (showPhone=false) → absent. */}
          {a.phone && (
            <p className="mt-0.5 flex items-center gap-1 text-sm text-neutral-600">
              <Phone className="size-3.5" aria-hidden="true" />
              {a.phone}
            </p>
          )}
        </div>
        <MatchBreakdownPopover
          score={a.matchScore}
          breakdown={a.matchBreakdown}
          jobMarket={jobMarket}
          candidateName={a.fullName}
        />
      </div>

      {/* Docs chips — status badge + Pro-gated View button per uploaded doc. */}
      <ul className="flex flex-wrap gap-1.5" aria-label={t('docs.heading')}>
        {DOC_TYPES.map((type) => {
          const d = docsByType.get(type);
          const uploaded = d?.uploaded ?? false;
          const expired = type === 'PASSPORT' && uploaded && d?.passportValid === false;
          return (
            <li
              key={type}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs',
                uploaded && !expired
                  ? 'bg-success-bg text-success-fg'
                  : 'bg-neutral-100 text-neutral-600',
              )}
            >
              {uploaded && !expired ? (
                <Check className="size-3" aria-hidden="true" />
              ) : (
                <X className="size-3" aria-hidden="true" />
              )}
              {t(`docs.${type}`)}
              {type === 'PASSPORT' && uploaded && (
                <span>· {expired ? t('docs.expired') : t('docs.valid')}</span>
              )}
              {uploaded && (
                <DocumentViewButton candidateId={a.id} documentType={type} uploaded={uploaded} />
              )}
            </li>
          );
        })}
      </ul>

      {a.coverLetter && (
        <div>
          <p className={cn('text-sm text-neutral-700', !expanded && 'line-clamp-2')}>
            {a.coverLetter}
          </p>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-0.5 text-xs font-medium text-primary-600 hover:underline"
          >
            {expanded ? t('showLess') : t('showMore')}
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-neutral-600">
          {a.humanId} · {t('appliedAgo', { ago: formatPostedAgo(a.appliedAt, locale) })}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onOpenDetail} className="min-h-11">
            {t('viewDetails')}
          </Button>
          <ApplicantActions applicant={a} busy={busy} onTransition={onTransition} />
        </div>
      </div>
    </li>
  );
}
