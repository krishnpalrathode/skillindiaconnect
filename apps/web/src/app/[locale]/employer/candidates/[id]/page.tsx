'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, UserX, AlertCircle } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { useEmployer } from '@/lib/employer/employer-context';
import { getCandidate, type CandidateEmployerView } from '@/lib/api/employer-candidates';
import { ApiRequestError } from '@/lib/api/client';
import { CandidateViewHeader } from '@/components/employer/candidates/view/CandidateViewHeader';
import { CandidateFacts } from '@/components/employer/candidates/view/CandidateFacts';
import { ExperienceTimeline } from '@/components/employer/candidates/view/ExperienceTimeline';
import { SkillsList } from '@/components/employer/candidates/view/SkillsList';
import { DocumentsStatusCard } from '@/components/employer/candidates/view/DocumentsStatusCard';

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; candidate: CandidateEmployerView }
  | { kind: 'notFound' }
  | { kind: 'error' };

/**
 * Candidate view (Screen — S3).
 *
 * Fetches GET /employers/candidates/{id} — the ONLY request. The server records
 * the profile view as a side effect; the frontend adds no tracking call/beacon.
 *
 * A hidden (`profileVisible = false`) or nonexistent candidate returns an
 * identical 404 and renders ONE not-found page (the two causes are
 * indistinguishable by design — we never build two states).
 */
export default function CandidateViewPage() {
  const t = useTranslations('employer.candidates');
  const { company, isLoading } = useEmployer();
  const params = useParams<{ locale: string; id: string }>();
  const locale = params?.locale ?? 'en';
  const id = params?.id ?? '';
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const fetchedId = useRef<string | null>(null);

  const load = React.useCallback(() => {
    setPhase({ kind: 'loading' });
    getCandidate(id)
      .then((candidate) => setPhase({ kind: 'ready', candidate }))
      .catch((err) => {
        if (err instanceof ApiRequestError && err.error.status === 404) {
          setPhase({ kind: 'notFound' });
        } else {
          setPhase({ kind: 'error' });
        }
      });
  }, [id]);

  useEffect(() => {
    if (isLoading || !company || company.status !== 'APPROVED') return;
    // Guard against React double-invoking the effect so the view GET (which has
    // a server-side side effect) fires once per id.
    if (fetchedId.current === id) return;
    fetchedId.current = id;
    load();
  }, [isLoading, company, id, load]);

  const backHref = `/${locale}/employer/candidates`;

  // Loading handled by the employer shell layout for the company; local spinner
  // covers the candidate fetch.
  if (isLoading) return null;

  // Approval gate — mirrors the browse page.
  if (!company || company.status !== 'APPROVED') {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 pt-8 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-warning-bg">
          <AlertCircle className="size-7 text-warning-fg" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-bold text-neutral-900">{t('approvalGate.title')}</h1>
        <p className="text-sm text-neutral-600">{t('approvalGate.body')}</p>
        <Button variant="outline" onClick={() => router.push(`/${locale}/employer/dashboard`)}>
          {t('approvalGate.backToDashboard')}
        </Button>
      </div>
    );
  }

  const backLink = (
    <Link
      href={backHref}
      className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-neutral-600 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
    >
      <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
      {t('view.back')}
    </Link>
  );

  if (phase.kind === 'loading') {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size={28} label={t('view.loading')} />
      </div>
    );
  }

  if (phase.kind === 'notFound') {
    return (
      <div className="max-w-2xl">
        <div className="mb-6">{backLink}</div>
        <div className="flex flex-col items-center gap-3 rounded-xl border border-neutral-200 bg-white py-16 px-4 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-neutral-100">
            <UserX className="size-6 text-neutral-600" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-neutral-700">{t('view.notFoundTitle')}</p>
            <p className="mt-1 text-xs text-neutral-600">{t('view.notFoundBody')}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => router.push(backHref)}>
            {t('view.backToBrowse')}
          </Button>
        </div>
      </div>
    );
  }

  if (phase.kind === 'error') {
    return (
      <div className="max-w-2xl">
        <div className="mb-6">{backLink}</div>
        <div className="flex flex-col items-center gap-4 rounded-xl border border-neutral-200 bg-white py-16 text-center">
          <p className="text-sm text-neutral-600">{t('view.loadError')}</p>
          <Button variant="outline" size="sm" onClick={load}>
            {t('retry')}
          </Button>
        </div>
      </div>
    );
  }

  const { candidate } = phase;

  return (
    <div className="max-w-2xl">
      <div className="mb-4">{backLink}</div>

      <div className="flex flex-col gap-4">
        <CandidateViewHeader candidate={candidate} locale={locale} />
        <CandidateFacts candidate={candidate} />
        <ExperienceTimeline experiences={candidate.experiences ?? []} />
        <SkillsList skills={candidate.skills ?? []} />
        <DocumentsStatusCard
          candidateId={candidate.id}
          documentsStatus={candidate.documentsStatus}
        />
      </div>
    </div>
  );
}
