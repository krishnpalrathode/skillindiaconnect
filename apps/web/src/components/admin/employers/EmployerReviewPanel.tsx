'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';
import {
  approveEmployer,
  getEmployer,
  reactivateEmployer,
  rejectEmployer,
  suspendEmployer,
  type Company,
} from '@/lib/api/admin-employers';
import { ApiRequestError } from '@/lib/api/client';
import { PermissionGate } from '@/components/admin/PermissionGate';
import { ForbiddenState } from '@/components/admin/ForbiddenState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CertificateViewer } from './CertificateViewer';
import { ApproveDialog } from './ApproveDialog';
import { RejectDialog } from './RejectDialog';
import { SuspendDialog } from './SuspendDialog';
import { ReactivateDialog } from './ReactivateDialog';

type OpenDialog = 'approve' | 'reject' | 'suspend' | 'reactivate' | null;

const STATUS_BADGE: Record<Company['status'], 'warning' | 'success' | 'error' | 'neutral'> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'error',
  SUSPENDED: 'neutral',
};

/** One verification fact. The layout exists to be CHECKED against the document. */
function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="text-sm text-neutral-900">{value || '—'}</dd>
    </div>
  );
}

/**
 * The review workflow. Facts on one side, the certificate beside them — the
 * admin's job is comparing the two, so nothing else competes for the screen.
 *
 * Actions are permission-gated PER BUTTON (approve/reject on
 * employers.approve_reject; suspend on employers.suspend — a MODERATOR sees the
 * first pair and not the second). Gating is UX; each endpoint re-checks.
 *
 * NO OPTIMISTIC UPDATES. These actions are rare and consequential (approval
 * lets a company post jobs to real candidates; suspension pauses their whole
 * board). After every action the panel REFETCHES and renders what the server
 * says is true — correctness over snappiness, exactly backwards from a
 * like-button.
 */
export function EmployerReviewPanel({ companyId }: { companyId: string }) {
  const t = useTranslations('admin.employers');
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const [company, setCompany] = useState<Company | null>(null);
  const [error, setError] = useState<ApiRequestError | Error | null>(null);
  const [openDialog, setOpenDialog] = useState<OpenDialog>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setCompany(await getEmployer(companyId));
    } catch (err) {
      setError(err as Error);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAction(fn: () => Promise<Company>, successKey: string) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      setOpenDialog(null);
      setNotice(t(successKey));
      // Refetch — the server's version of the new state is the one we show.
      await load();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setActionError(err.error.detail);
      } else {
        setActionError(t('actionFailed'));
      }
    } finally {
      setBusy(false);
    }
  }

  if (error instanceof ApiRequestError && error.error.status === 403) {
    return (
      <ForbiddenState
        requiredPermission={error.error.meta?.['requiredPermission'] as string | undefined}
      />
    );
  }

  if (error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 py-8">
        <p className="text-sm font-medium text-error-fg">
          {error instanceof ApiRequestError && error.error.status === 404
            ? t('notFound')
            : t('loadFailed')}
        </p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-10 w-1/2 rounded-lg" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/${locale}/admin/employers`}
        className="flex w-fit min-h-[44px] items-center gap-1.5 rounded text-sm font-medium text-neutral-600 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('backToQueue')}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-neutral-900">{company.name}</h1>
          <Badge variant={STATUS_BADGE[company.status]}>{t(`status.${company.status}`)}</Badge>
        </div>

        {/* The action rail — gated per button, staged per status. */}
        <div className="flex flex-wrap gap-2">
          {company.status === 'PENDING' && (
            <PermissionGate permission="employers.approve_reject">
              <Button size="sm" onClick={() => setOpenDialog('approve')}>
                {t('actions.approve')}
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setOpenDialog('reject')}>
                {t('actions.reject')}
              </Button>
            </PermissionGate>
          )}
          {company.status === 'APPROVED' && (
            <PermissionGate permission="employers.suspend">
              <Button size="sm" variant="destructive" onClick={() => setOpenDialog('suspend')}>
                {t('actions.suspend')}
              </Button>
            </PermissionGate>
          )}
          {company.status === 'SUSPENDED' && (
            <PermissionGate permission="employers.approve_reject">
              <Button size="sm" onClick={() => setOpenDialog('reactivate')}>
                {t('actions.reactivate')}
              </Button>
            </PermissionGate>
          )}
        </div>
      </div>

      {notice && (
        <p
          role="status"
          className="rounded-lg bg-success-bg p-3 text-sm font-medium text-success-fg"
        >
          {notice}
        </p>
      )}
      {actionError && !openDialog && (
        <p role="alert" className="rounded-lg bg-error-bg p-3 text-sm font-medium text-error-fg">
          {actionError}
        </p>
      )}

      {/* Prior rejection reason — context for a re-review. */}
      {company.status === 'REJECTED' && company.rejectionReason && (
        <div className="rounded-lg bg-error-bg p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-error-fg">
            {t('rejectionReasonLabel')}
          </p>
          <p className="mt-1 text-sm text-error-fg">{company.rejectionReason}</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* The facts to verify */}
        <section
          aria-labelledby="company-facts-heading"
          className="rounded-xl border border-neutral-200 bg-white p-4"
        >
          <h2 id="company-facts-heading" className="mb-4 text-sm font-semibold text-neutral-900">
            {t('factsHeading')}
          </h2>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Fact label={t('fact.registrationNumber')} value={company.registrationNumber} />
            <Fact label={t('fact.type')} value={t(`type.${company.type}`)} />
            <Fact label={t('fact.industry')} value={company.industryType} />
            <Fact label={t('fact.phone')} value={company.phone} />
            <Fact label={t('fact.location')} value={company.location} />
            <Fact label={t('fact.employeeRange')} value={company.employeeRange} />
            <Fact label={t('fact.website')} value={company.website} />
            <Fact
              label={t('fact.submitted')}
              value={new Date(company.createdAt).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            />
          </dl>
          {company.description && (
            <div className="mt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                {t('fact.description')}
              </p>
              <p className="mt-1 text-sm text-neutral-700">{company.description}</p>
            </div>
          )}
        </section>

        {/* The document they're verified against */}
        <CertificateViewer companyId={company.id} />
      </div>

      {openDialog === 'approve' && (
        <ApproveDialog
          companyName={company.name}
          busy={busy}
          onConfirm={() => void runAction(() => approveEmployer(company.id), 'toast.approved')}
          onClose={() => setOpenDialog(null)}
        />
      )}
      {openDialog === 'reject' && (
        <RejectDialog
          companyName={company.name}
          busy={busy}
          serverError={actionError}
          onConfirm={(reason) =>
            void runAction(() => rejectEmployer(company.id, reason), 'toast.rejected')
          }
          onClose={() => setOpenDialog(null)}
        />
      )}
      {openDialog === 'suspend' && (
        <SuspendDialog
          companyName={company.name}
          busy={busy}
          onConfirm={() => void runAction(() => suspendEmployer(company.id), 'toast.suspended')}
          onClose={() => setOpenDialog(null)}
        />
      )}
      {openDialog === 'reactivate' && (
        <ReactivateDialog
          companyName={company.name}
          busy={busy}
          onConfirm={() =>
            void runAction(() => reactivateEmployer(company.id), 'toast.reactivated')
          }
          onClose={() => setOpenDialog(null)}
        />
      )}
    </div>
  );
}
