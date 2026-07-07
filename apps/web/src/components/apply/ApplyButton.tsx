'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Button, buttonVariants } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/lib/auth/auth-context';
import { getCandidateCompletion } from '@/lib/api/candidate';
import { getMyApplicationForJob } from '@/lib/api/apply';
import { formatSalaryRange } from '@/lib/jobs/format';
import { cn } from '@/lib/utils';
import type { JobDetail } from '@/lib/api/jobs';
import { ApplySheet, type ApplySheetJob } from './ApplySheet';

type CompletionResult = components['schemas']['CompletionResult'];

interface ApplyButtonProps {
  job: JobDetail;
  locale: string;
}

/**
 * The eligibility-aware Apply entry on job detail. NEVER hidden — always an
 * affordance with a path:
 *  - logged out → login redirect (with `next` back to this job)
 *  - candidate + canApply → primary "Apply" → the sheet (form)
 *  - candidate + !canApply → "Complete your profile to apply" → the sheet (preview)
 *  - already applied → "Applied ✓" → My Applications (survives revisits via the
 *    on-load applications check; the 409 on submit covers the same session)
 *
 * The eligibility read is UX only — the server decides on submit (never
 * disable-and-trust).
 */
export function ApplyButton({ job, locale }: ApplyButtonProps) {
  const t = useTranslations('apply');
  const { user, isLoading: authLoading } = useAuth();
  const isCandidate = user?.role === 'CANDIDATE';

  const [completion, setCompletion] = useState<CompletionResult | null>(null);
  const [loadingElig, setLoadingElig] = useState(false);
  const [applied, setApplied] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isCandidate) return;
    let active = true;
    setLoadingElig(true);
    void (async () => {
      try {
        const [comp, existing] = await Promise.all([
          getCandidateCompletion(),
          getMyApplicationForJob(job.id).catch(() => null),
        ]);
        if (!active) return;
        setCompletion(comp);
        if (existing) setApplied(true);
      } catch {
        // Eligibility read failed — leave completion null; the CTA still opens the
        // sheet and the server gates the submit. Preview ≠ enforcement.
      } finally {
        if (active) setLoadingElig(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [isCandidate, job.id]);

  // Non-candidate roles (employer/admin) don't apply — no affordance here.
  if (user && !isCandidate) return null;

  // Logged out → login with a next back to this job.
  if (!authLoading && !user) {
    const next = encodeURIComponent(`/${locale}/jobs/${job.id}`);
    return (
      <Link
        href={`/${locale}/login?next=${next}`}
        className={cn(buttonVariants({ variant: 'primary' }), 'min-h-11')}
      >
        {t('cta.apply')}
      </Link>
    );
  }

  const canApply = completion?.canApply ?? true; // fetch-failed → let the server gate
  const sheetJob: ApplySheetJob = {
    id: job.id,
    title: job.title,
    companyName: job.companyName,
    salary: formatSalaryRange(job.salaryMin, job.salaryMax, job.salaryCurrency, locale),
    market: job.market,
  };

  // The trigger and the sheet COEXIST — flipping to "Applied" (on success or 409)
  // must NOT unmount an open sheet, or the success reveal would vanish. The applied
  // entry is what remains once the sheet is closed (and on revisit).
  let trigger: ReactNode;
  if (applied) {
    trigger = (
      <Link
        href={`/${locale}/applications`}
        className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11')}
      >
        <CheckCircle2 className="size-4 text-success-fg" aria-hidden="true" />
        {t('cta.applied')}
      </Link>
    );
  } else if (authLoading || loadingElig) {
    trigger = (
      <Button variant="primary" disabled className="min-h-11">
        <Spinner className="size-4" />
        {t('cta.apply')}
      </Button>
    );
  } else {
    trigger = (
      <Button variant="primary" onClick={() => setOpen(true)} className="min-h-11">
        {canApply ? t('cta.apply') : t('cta.completeProfile')}
      </Button>
    );
  }

  return (
    <>
      {trigger}
      {open && (
        <ApplySheet
          job={sheetJob}
          locale={locale}
          completion={completion ?? { pct: 0, sections: [], canApply: true, missingForApply: [] }}
          onClose={() => setOpen(false)}
          onApplied={() => setApplied(true)}
        />
      )}
    </>
  );
}
