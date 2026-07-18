'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, AlertCircle, Users } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Skeleton } from '@/components/ui/skeleton';
import { useEmployer } from '@/lib/employer/employer-context';
import { ApiRequestError } from '@/lib/api/client';
import { getJobClient } from '@/lib/api/jobs';
import { listApplicants, transitionApplication, type ApplicantSort } from '@/lib/api/applicants';
import {
  ApplicantFilters,
  type ApplicantStatusFilter,
} from '@/components/employer/applicants/ApplicantFilters';
import { ApplicantCard } from '@/components/employer/applicants/ApplicantCard';
import { ApplicantDetail } from '@/components/employer/applicants/ApplicantDetail';

type ApplicantCardT = components['schemas']['ApplicantCard'];
type ApplicantCounts = components['schemas']['ApplicantCounts'];
type ApplicationStatus = components['schemas']['ApplicationStatus'];
type JobMarket = components['schemas']['JobMarket'];

const PAGE_SIZE = 10;
const EMPTY_COUNTS: ApplicantCounts = { pending: 0, shortlisted: 0, selected: 0, rejected: 0 };
const COUNT_KEY: Record<ApplicationStatus, keyof ApplicantCounts> = {
  PENDING: 'pending',
  SHORTLISTED: 'shortlisted',
  SELECTED: 'selected',
  REJECTED: 'rejected',
};

export default function ApplicantsPage() {
  const t = useTranslations('applicants');
  const { company, isLoading } = useEmployer();
  const params = useParams<{ locale: string; id: string }>();
  const locale = params?.locale ?? 'en';
  const jobId = params?.id ?? '';

  const [jobTitle, setJobTitle] = useState<string | null>(null);
  const [jobMarket, setJobMarket] = useState<JobMarket>('GULF');
  const [items, setItems] = useState<ApplicantCardT[]>([]);
  const [counts, setCounts] = useState<ApplicantCounts>(EMPTY_COUNTS);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<ApplicantStatusFilter>('ALL');
  const [sort, setSort] = useState<ApplicantSort>('match');
  const [phase, setPhase] = useState<'loading' | 'ready' | 'notFound' | 'error'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ApplicantCardT | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const approved = !!company && company.status === 'APPROVED';

  const load = useCallback(async () => {
    setPhase('loading');
    try {
      const page = await listApplicants(jobId, {
        status: status === 'ALL' ? undefined : status,
        sort,
        limit: PAGE_SIZE,
      });
      setItems(page.data);
      setCounts(page.counts);
      setCursor(page.nextCursor);
      setPhase('ready');
    } catch (err) {
      setPhase(
        err instanceof ApiRequestError && (err.error.status === 404 || err.error.status === 403)
          ? 'notFound'
          : 'error',
      );
    }
  }, [jobId, status, sort]);

  // Job title + market (for the header + the popover's LOCAL note). Best-effort:
  // a paused/archived job may 404 on the public endpoint — the pipeline still works.
  useEffect(() => {
    if (!approved) return;
    getJobClient(jobId)
      .then((job) => {
        setJobTitle(job.title);
        setJobMarket(job.market);
      })
      .catch(() => {
        /* header falls back to a generic label; market defaults to GULF */
      });
  }, [approved, jobId]);

  useEffect(() => {
    if (!approved) return;
    void load();
  }, [approved, load]);

  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(h);
  }, [toast]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await listApplicants(jobId, {
        status: status === 'ALL' ? undefined : status,
        sort,
        cursor,
        limit: PAGE_SIZE,
      });
      setItems((prev) => [...prev, ...page.data]);
      setCursor(page.nextCursor);
      setCounts(page.counts);
    } catch {
      /* keep current; button remains for retry */
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, jobId, status, sort]);

  const adjustCounts = (
    c: ApplicantCounts,
    from: ApplicationStatus,
    to: ApplicationStatus,
  ): ApplicantCounts => {
    const next = { ...c };
    next[COUNT_KEY[from]] = Math.max(0, next[COUNT_KEY[from]] - 1);
    next[COUNT_KEY[to]] = next[COUNT_KEY[to]] + 1;
    return next;
  };

  const handleTransition = useCallback(
    async (applicationId: string, to: ApplicationStatus, opts?: { rejectionFeedback?: string }) => {
      const target = items.find((a) => a.applicationId === applicationId);
      if (!target) return;
      const from = target.status;
      const snapItems = items;
      const snapCounts = counts;

      // Optimistic: reflect the move immediately (instant feedback under slow-3G).
      setBusyId(applicationId);
      setItems((prev) =>
        prev.map((a) => (a.applicationId === applicationId ? { ...a, status: to } : a)),
      );
      setCounts((c) => adjustCounts(c, from, to));
      setDetail((d) => (d && d.applicationId === applicationId ? { ...d, status: to } : d));

      try {
        await transitionApplication(applicationId, {
          status: to,
          ...(opts?.rejectionFeedback ? { rejectionFeedback: opts.rejectionFeedback } : {}),
        });
        // Reconcile from server truth (filter membership, counts, selectedNotifiedAt).
        await load();
      } catch (err) {
        // Roll back the optimistic lie.
        setItems(snapItems);
        setCounts(snapCounts);
        setDetail((d) => (d && d.applicationId === applicationId ? { ...d, status: from } : d));
        if (err instanceof ApiRequestError && err.error.code === 'ILLEGAL_TRANSITION') {
          setToast(t('toast.staleRefresh'));
          await load(); // a concurrent (admin) move happened — show the real state
        } else {
          setToast(t('toast.error'));
        }
      } finally {
        setBusyId(null);
      }
    },
    [items, counts, load, t],
  );

  // Re-sync the open detail with the reconciled list.
  const detailRef = useRef(detail);
  detailRef.current = detail;
  useEffect(() => {
    const d = detailRef.current;
    if (!d) return;
    const fresh = items.find((a) => a.applicationId === d.applicationId);
    if (fresh && fresh.status !== d.status) setDetail(fresh);
  }, [items]);

  // ── Render ──────────────────────────────────────────────────────────────
  if (isLoading) return null;

  if (!approved) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 pt-8 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-warning-bg">
          <AlertCircle className="size-7 text-warning-fg" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-bold text-neutral-900">{t('approvalGate.title')}</h1>
        <p className="text-sm text-neutral-500">{t('approvalGate.body')}</p>
        <Link href={`/${locale}/employer/dashboard`}>
          <Button variant="outline">{t('approvalGate.back')}</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link
        href={`/${locale}/employer/jobs`}
        className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-neutral-500 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
        {t('backToJobs')}
      </Link>

      <h1 className="text-xl font-bold text-neutral-900">
        {t('title')}
        {jobTitle && <span className="text-neutral-400"> · {jobTitle}</span>}
      </h1>

      {phase === 'notFound' ? (
        <p className="py-16 text-center text-sm text-neutral-500">{t('notFound')}</p>
      ) : phase === 'error' ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-neutral-500">{t('error')}</p>
          <Button variant="outline" onClick={() => void load()} className="min-h-11">
            {t('retry')}
          </Button>
        </div>
      ) : (
        <>
          <ApplicantFilters
            counts={counts}
            status={status}
            sort={sort}
            onStatusChange={setStatus}
            onSortChange={setSort}
          />

          <ul id="applicants-list" className="flex flex-col gap-3">
            {phase === 'loading' ? (
              <>
                <Skeleton className="h-40 w-full rounded-xl" />
                <Skeleton className="h-40 w-full rounded-xl" />
              </>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <Users className="size-10 text-neutral-300" aria-hidden="true" />
                <p className="text-sm text-neutral-600">{t('empty')}</p>
              </div>
            ) : (
              items.map((a) => (
                <ApplicantCard
                  key={a.applicationId}
                  applicant={a}
                  jobMarket={jobMarket}
                  locale={locale}
                  busy={busyId === a.applicationId}
                  onTransition={(to, opts) => void handleTransition(a.applicationId, to, opts)}
                  onOpenDetail={() => setDetail(a)}
                />
              ))
            )}
          </ul>

          {cursor && (
            <Button
              variant="outline"
              onClick={loadMore}
              disabled={loadingMore}
              className="mx-auto min-h-11"
            >
              {loadingMore ? <Spinner className="size-4" /> : null}
              {t('loadMore')}
            </Button>
          )}
        </>
      )}

      {detail && (
        <ApplicantDetail
          applicant={detail}
          jobMarket={jobMarket}
          locale={locale}
          busy={busyId === detail.applicationId}
          onTransition={(to, opts) => void handleTransition(detail.applicationId, to, opts)}
          onClose={() => setDetail(null)}
        />
      )}

      {/* Reconciliation toast (aria-live). */}
      <div aria-live="polite" className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
        {toast && (
          <div className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
