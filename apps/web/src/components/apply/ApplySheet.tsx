'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { applyToJob } from '@/lib/api/apply';
import { getCandidateCompletion } from '@/lib/api/candidate';
import { ApiRequestError, type ApiError } from '@/lib/api/client';
import { CoverLetterField } from './CoverLetterField';
import { EligibilityPreview } from './EligibilityPreview';
import { ApplyErrorState } from './ApplyErrorState';
import { MatchRevealCard } from './MatchRevealCard';

type Application = components['schemas']['Application'];
type CompletionResult = components['schemas']['CompletionResult'];
type JobMarket = components['schemas']['JobMarket'];

export interface ApplySheetJob {
  id: string;
  title: string;
  companyName: string;
  salary: string | null;
  market: JobMarket;
}

interface ApplySheetProps {
  job: ApplySheetJob;
  locale: string;
  completion: CompletionResult;
  onClose: () => void;
  onApplied: () => void;
}

type Phase = 'preview' | 'form' | 'submitting' | 'success' | 'error';

// Client-side submit timeout — under slow-3G the spinner must resolve into a
// retryable state, never spin forever (constrained discipline).
const SUBMIT_TIMEOUT_MS = 20_000;

export function ApplySheet({ job, locale, completion, onClose, onApplied }: ApplySheetProps) {
  const t = useTranslations('apply');
  const [comp, setComp] = useState<CompletionResult>(completion);
  const [phase, setPhase] = useState<Phase>(completion.canApply ? 'form' : 'preview');
  const [coverLetter, setCoverLetter] = useState('');
  const [rechecking, setRechecking] = useState(false);
  const [application, setApplication] = useState<Application | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = 'apply-sheet-title';

  // ── Focus trap + escape + scroll lock ──────────────────────────────────────
  useEffect(() => {
    const prevActive = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = () =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(
              'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])',
            ),
          )
        : [];
    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
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
      prevActive?.focus?.();
    };
  }, [onClose]);

  const recheck = useCallback(async () => {
    setRechecking(true);
    try {
      const fresh = await getCandidateCompletion();
      setComp(fresh);
      if (fresh.canApply) setPhase('form');
    } catch {
      // A failed recheck leaves the preview as-is — the user can retry.
    } finally {
      setRechecking(false);
    }
  }, []);

  const submit = useCallback(async () => {
    setPhase('submitting');
    setError(null);
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('APPLY_TIMEOUT')), SUBMIT_TIMEOUT_MS),
      );
      const app = await Promise.race([
        applyToJob(job.id, coverLetter.trim() ? { coverLetter: coverLetter.trim() } : {}),
        timeout,
      ]);
      setApplication(app);
      setPhase('success');
      onApplied();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.error);
        // A concurrent double-submit (409) still means "you have applied".
        if (err.error.code === 'ALREADY_APPLIED') onApplied();
      } else {
        // timeout / network — generic retryable state (no code).
        setError({ code: 'UNKNOWN_ERROR', status: 0, title: 'Error', detail: 'timeout' });
      }
      setPhase('error');
    }
  }, [job.id, coverLetter, onApplied]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-neutral-900/50" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-neutral-900">
              {t('title')}
            </h2>
            <p className="text-sm text-neutral-600">
              {job.title} · {job.companyName}
            </p>
            {job.salary && <p className="text-sm font-medium text-neutral-800">{job.salary}</p>}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={t('close')}
            className="shrink-0"
          >
            <X className="size-5" aria-hidden="true" />
          </Button>
        </div>

        {phase === 'preview' && (
          <EligibilityPreview
            completion={comp}
            locale={locale}
            onRecheck={recheck}
            rechecking={rechecking}
          />
        )}

        {phase === 'form' && (
          <div className="flex flex-col gap-4">
            <CoverLetterField value={coverLetter} onChange={setCoverLetter} />
            <Button variant="primary" onClick={submit} className="w-full min-h-11">
              {t('submit')}
            </Button>
          </div>
        )}

        {phase === 'submitting' && (
          <div className="flex flex-col items-center gap-3 py-10" aria-live="polite">
            <Spinner />
            <p className="text-sm text-neutral-600">{t('submitting')}</p>
          </div>
        )}

        {phase === 'error' && error && (
          <ApplyErrorState error={error} locale={locale} onRetry={() => setPhase('form')} />
        )}

        {phase === 'success' && application && (
          <MatchRevealCard application={application} jobMarket={job.market} locale={locale} />
        )}
      </div>
    </div>
  );
}
