'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertTriangle, MapPin, Users, Briefcase, Eye } from 'lucide-react';
import { getAdminJob, pauseJob, archiveJob, type AdminJobDetail } from '@/lib/api/admin-jobs';
import { ApiRequestError } from '@/lib/api/client';
import { formatSalaryRange } from '@/lib/jobs/format';
import { PermissionGate } from '@/components/admin/PermissionGate';
import { ForbiddenState } from '@/components/admin/ForbiddenState';
import { ActionDialogShell } from '@/components/admin/employers/ActionDialogShell';
import { BenefitChips } from '@/components/jobs/BenefitChips';
import { JobStatusBadge } from '@/components/employer/myjobs/JobStatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApproveRejectActions, type ReviewOutcome } from './ApproveRejectActions';
import { FlagsControl } from './FlagsControl';
import { Ltr } from '@/components/common/Ltr';

/**
 * The moderation detail: the job AS CANDIDATES WOULD SEE IT (same single-source
 * BenefitChips and salary formatting as the S2-F1 public card — the admin
 * reviews the actual rendering, not a raw field dump) plus the admin facts.
 *
 * A SUSPENDED employer is flagged HERE, before the admin even tries to approve
 * — discovering it only via the gate's 403 would be a worse experience. The
 * protection-relevant benefits get an explicit present/missing readout: they
 * are what rung 2 of the approval gate will re-check.
 */
export function JobReviewPanel({ jobId }: { jobId: string }) {
  const t = useTranslations('admin.jobs.panel');
  const tBenefits = useTranslations('admin.jobs.panel.protection');
  const tReview = useTranslations('admin.jobs.review');
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const [job, setJob] = useState<AdminJobDetail | null>(null);
  const [error, setError] = useState<ApiRequestError | Error | null>(null);
  const [lifecycleDialog, setLifecycleDialog] = useState<'pause' | 'archive' | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleConflict, setLifecycleConflict] = useState<string | null>(null);
  // The review outcome lives HERE: a resolved job leaves PENDING_REVIEW, so
  // the actions section unmounts on the refetch and could not show it itself.
  const [reviewOutcome, setReviewOutcome] = useState<ReviewOutcome | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setJob(await getAdminJob(jobId));
    } catch (err) {
      setError(err as Error);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runLifecycle(action: 'pause' | 'archive') {
    setLifecycleBusy(true);
    setLifecycleConflict(null);
    try {
      await (action === 'pause' ? pauseJob(jobId) : archiveJob(jobId));
      setLifecycleDialog(null);
      void load();
    } catch (err) {
      setLifecycleDialog(null);
      if (err instanceof ApiRequestError && err.error.status === 409) {
        // An illegal transition is a CALM state — the job simply already is
        // (or cannot become) what was asked; converge on the server's truth.
        setLifecycleConflict(t('lifecycle.conflict'));
        void load();
      } else {
        setLifecycleConflict(t('lifecycle.failed'));
      }
    } finally {
      setLifecycleBusy(false);
    }
  }

  if (error instanceof ApiRequestError && error.error.status === 403) {
    return (
      <ForbiddenState
        requiredPermission={error.error.meta?.['requiredPermission'] as string | undefined}
      />
    );
  }
  if (error instanceof ApiRequestError && error.error.status === 404) {
    return (
      <p role="alert" className="py-10 text-center text-sm text-neutral-600">
        {t('notFound')}
      </p>
    );
  }
  if (error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 py-8">
        <p className="text-sm font-medium text-error-fg">{t('loadFailed')}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          {t('retry')}
        </Button>
      </div>
    );
  }
  if (!job) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-8 w-72 rounded-lg" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  const salary = formatSalaryRange(
    job.salaryMin ?? null,
    job.salaryMax ?? null,
    job.salaryCurrency,
    locale,
  );
  const employerNotApproved = job.companyStatus !== 'APPROVED';
  const protectionRows: Array<{ key: string; present: boolean }> = [
    { key: 'accommodation', present: job.accommodation },
    { key: 'healthInsurance', present: job.healthInsurance },
    { key: 'transportation', present: job.transportation },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Header: identity + status */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-neutral-900">{job.title}</h1>
        <JobStatusBadge status={job.status} />
        {job.isFeatured && <Badge variant="primary">{t('featuredChip')}</Badge>}
        {job.isUrgent && <Badge variant="accent">{t('urgentChip')}</Badge>}
      </div>
      <p className="text-sm text-neutral-600">
        {job.humanId} · {job.companyName}
      </p>

      {/* THE PRE-EMPTIVE WARNING: the employer's state, before any button is pressed. */}
      {employerNotApproved && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-warning-fg/40 bg-warning-bg p-4"
        >
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning-fg" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-warning-fg">
              {t('employerWarning.title', { status: job.companyStatus })}
            </p>
            <p className="mt-0.5 text-sm text-neutral-700">{t('employerWarning.body')}</p>
            <Link
              href={`/${locale}/admin/employers/${job.companyId}`}
              className="mt-1 inline-block text-sm font-medium text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
            >
              {t('employerWarning.link')}
            </Link>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        {/* ── The job as candidates would see it ─────────────────────────── */}
        <section
          aria-labelledby="candidate-view-heading"
          className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-4"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 id="candidate-view-heading" className="text-sm font-semibold text-neutral-900">
              {t('candidateView')}
            </h2>
            <Badge variant={job.market === 'GULF' ? 'primary' : 'accent'}>
              {job.market === 'GULF' ? t('marketGulf') : t('marketLocal')}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm text-neutral-600">
            <span className="flex items-center gap-1">
              <MapPin className="size-4 shrink-0" aria-hidden="true" />
              {job.location}
            </span>
            {job.vacancies != null && (
              <span className="flex items-center gap-1">
                <Users className="size-4 shrink-0" aria-hidden="true" />
                {t('vacancies', { count: job.vacancies })}
              </span>
            )}
            {job.experienceRequiredYears != null && (
              <span className="flex items-center gap-1">
                <Briefcase className="size-4 shrink-0" aria-hidden="true" />
                {t('experienceYears', { count: job.experienceRequiredYears })}
              </span>
            )}
          </div>

          {salary && (
            <p className="text-lg font-semibold text-neutral-900">
              <Ltr>{salary}</Ltr>
            </p>
          )}

          {/* Single source: the SAME chips candidates see on the public card. */}
          <BenefitChips job={job} />

          {job.description && (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-neutral-700">{t('description')}</h3>
              <p className="whitespace-pre-line text-sm text-neutral-700">{job.description}</p>
            </div>
          )}

          {(job.requirements ?? []).length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-neutral-700">{t('requirements')}</h3>
              <ul className="flex flex-col gap-1.5">
                {(job.requirements ?? []).map((req, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-neutral-700">
                    <span
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary-600"
                      aria-hidden="true"
                    />
                    {req}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(job.hoursPerDay != null || job.daysPerWeek != null) && (
            <p className="text-sm text-neutral-600">
              {t('workHours', {
                hours: job.hoursPerDay ?? '—',
                days: job.daysPerWeek ?? '—',
              })}
              {job.overtime ? ` · ${t('overtime')}` : ''}
            </p>
          )}
        </section>

        {/* ── Admin facts + actions ──────────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          <section
            aria-labelledby="admin-facts-heading"
            className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-4"
          >
            <h2 id="admin-facts-heading" className="text-sm font-semibold text-neutral-900">
              {t('adminFacts')}
            </h2>
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600">{t('facts.employer')}</dt>
                <dd className="text-end font-medium text-neutral-900">
                  <Link
                    href={`/${locale}/admin/employers/${job.companyId}`}
                    className="text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
                  >
                    {job.companyName}
                  </Link>
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600">{t('facts.employerStatus')}</dt>
                <dd
                  className={
                    employerNotApproved ? 'font-semibold text-warning-fg' : 'text-neutral-900'
                  }
                >
                  {job.companyStatus}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600">{t('facts.submitted')}</dt>
                <dd className="text-neutral-900">
                  {new Date(job.createdAt).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600">{t('facts.applicants')}</dt>
                <dd className="text-neutral-900">{job.applicantCount ?? 0}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-neutral-600">{t('facts.views')}</dt>
                <dd className="flex items-center gap-1 text-neutral-900">
                  <Eye className="size-3.5 text-neutral-600" aria-hidden="true" />
                  {job.views ?? 0}
                </dd>
              </div>
            </dl>

            {/* The protection readout — exactly what rung 2 will re-check. */}
            <div className="mt-1 border-t border-neutral-100 pt-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
                {tBenefits('heading')}
              </h3>
              <ul className="mt-1.5 flex flex-col gap-1">
                {protectionRows.map((row) => (
                  <li key={row.key} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-neutral-700">{tBenefits(row.key)}</span>
                    <Badge variant={row.present ? 'success' : 'error'}>
                      {row.present ? tBenefits('present') : tBenefits('missing')}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>

            {job.moderationReason && (
              <p className="mt-1 rounded-lg bg-neutral-50 p-2 text-xs text-neutral-600">
                {t('facts.lastRejectReason', { reason: job.moderationReason })}
              </p>
            )}
          </section>

          {reviewOutcome && reviewOutcome !== 'conflict' && (
            <div
              role="status"
              className="rounded-xl border border-success-fg/30 bg-success-bg/40 p-4 text-sm text-success-fg"
            >
              {reviewOutcome === 'approved' ? tReview('approvedNote') : tReview('rejectedNote')}
            </div>
          )}

          {job.status === 'PENDING_REVIEW' && (
            <ApproveRejectActions
              job={job}
              onResolved={(outcome) => {
                setReviewOutcome(outcome);
                void load();
              }}
            />
          )}

          <FlagsControl job={job} onChanged={() => void load()} />

          {/* Lifecycle — any job, but the state machine still governs (409 → calm). */}
          <PermissionGate permission="jobs.moderate">
            <section
              aria-labelledby="lifecycle-heading"
              className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-4"
            >
              <h2 id="lifecycle-heading" className="text-sm font-semibold text-neutral-900">
                {t('lifecycle.heading')}
              </h2>
              {lifecycleConflict && (
                <p role="status" className="rounded-lg bg-neutral-100 p-2 text-xs text-neutral-600">
                  {lifecycleConflict}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLifecycleDialog('pause')}
                  disabled={lifecycleBusy}
                >
                  {t('lifecycle.pause')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLifecycleDialog('archive')}
                  disabled={lifecycleBusy}
                >
                  {t('lifecycle.archive')}
                </Button>
              </div>
            </section>
          </PermissionGate>

          <Link
            href={`/${locale}/admin/applications?jobId=${job.id}`}
            className="text-sm font-medium text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded w-fit"
          >
            {t('viewApplications', { count: job.applicantCount ?? 0 })}
          </Link>
        </div>
      </div>

      {lifecycleDialog === 'pause' && (
        <ActionDialogShell
          titleId="pause-job-title"
          title={t('lifecycle.pauseDialog.title', { title: job.title })}
          busy={lifecycleBusy}
          confirmLabel={t('lifecycle.pauseDialog.confirm')}
          onConfirm={() => void runLifecycle('pause')}
          onClose={() => setLifecycleDialog(null)}
          cancelLabel={t('cancel')}
        >
          <p className="mt-2 text-sm text-neutral-600">{t('lifecycle.pauseDialog.body')}</p>
        </ActionDialogShell>
      )}
      {lifecycleDialog === 'archive' && (
        <ActionDialogShell
          titleId="archive-job-title"
          title={t('lifecycle.archiveDialog.title', { title: job.title })}
          busy={lifecycleBusy}
          confirmLabel={t('lifecycle.archiveDialog.confirm')}
          confirmVariant="destructive"
          onConfirm={() => void runLifecycle('archive')}
          onClose={() => setLifecycleDialog(null)}
          cancelLabel={t('cancel')}
        >
          {/* Archive is terminal AND removes the job from public search — say so. */}
          <p className="mt-2 text-sm text-neutral-600">{t('lifecycle.archiveDialog.body')}</p>
        </ActionDialogShell>
      )}
    </div>
  );
}
