'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatPostedAgo } from '@/lib/jobs/format';
import { CandidateFacts } from '@/components/employer/candidates/view/CandidateFacts';
import { ExperienceTimeline } from '@/components/employer/candidates/view/ExperienceTimeline';
import { SkillsList } from '@/components/employer/candidates/view/SkillsList';
import { DocumentsStatusCard } from '@/components/employer/candidates/view/DocumentsStatusCard';
import { APPLICANT_STATUS_VARIANT } from './ApplicantCard';
import { MatchBreakdownPopover } from './MatchBreakdownPopover';
import { ApplicantActions } from './ApplicantActions';

type ApplicantCard = components['schemas']['ApplicantCard'];
type ApplicationStatus = components['schemas']['ApplicationStatus'];
type JobMarket = components['schemas']['JobMarket'];

interface ApplicantDetailProps {
  applicant: ApplicantCard;
  jobMarket: JobMarket;
  locale: string;
  busy: boolean;
  onTransition: (to: ApplicationStatus, opts?: { rejectionFeedback?: string }) => void;
  onClose: () => void;
}

/**
 * Applicant drill-down — a focus-trapped panel that COMPOSES S3-F2's candidate-view
 * components (CandidateFacts / ExperienceTimeline / SkillsList / DocumentsStatusCard),
 * so the same privacy discipline (phone absence when hidden, docs status-only)
 * flows through unchanged, plus the application fields + the same forward-only actions.
 */
export function ApplicantDetail({
  applicant: a,
  jobMarket,
  locale,
  busy,
  onTransition,
  onClose,
}: ApplicantDetailProps) {
  const t = useTranslations('applicants');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const nodes = () =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(
              'a[href],button:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
            ),
          )
        : [];
    nodes()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      if (e.key !== 'Tab') return;
      const items = nodes();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-neutral-900/50" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="applicant-detail-title"
        className="relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto bg-neutral-50 p-4 shadow-xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="applicant-detail-title" className="text-lg font-semibold text-neutral-900">
              {a.fullName}
            </h2>
            <Badge variant={APPLICANT_STATUS_VARIANT[a.status]}>{t(`status.${a.status}`)}</Badge>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={t('detail.close')}
            className="shrink-0"
          >
            <X className="size-5" aria-hidden="true" />
          </Button>
        </div>

        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-xs text-neutral-600">
            {a.humanId} · {t('appliedAgo', { ago: formatPostedAgo(a.appliedAt, locale) })}
          </span>
          <MatchBreakdownPopover
            score={a.matchScore}
            breakdown={a.matchBreakdown}
            jobMarket={jobMarket}
            candidateName={a.fullName}
          />
        </div>

        <div className="flex flex-col gap-4">
          <CandidateFacts candidate={a} />
          {a.coverLetter && (
            <section className="rounded-xl border border-neutral-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-neutral-900">{t('detail.coverLetter')}</h3>
              <p className="mt-1 whitespace-pre-line text-sm text-neutral-700">{a.coverLetter}</p>
            </section>
          )}
          <ExperienceTimeline experiences={a.experiences ?? []} />
          <SkillsList skills={a.skills ?? []} />
          <DocumentsStatusCard candidateId={a.id} documentsStatus={a.documentsStatus} />
        </div>

        <div className="sticky bottom-0 mt-4 border-t border-neutral-200 bg-neutral-50 pt-3">
          <ApplicantActions applicant={a} busy={busy} onTransition={onTransition} />
        </div>
      </div>
    </div>
  );
}
