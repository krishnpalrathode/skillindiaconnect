'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { formatDuration } from '@/lib/formatDuration';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { formatMonthYear } from '@/lib/format/date';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import {
  getCandidate,
  reactivateCandidate,
  suspendCandidate,
  purgeCandidate,
  type AdminCandidateDetail,
} from '@/lib/api/admin-candidates';
import { ApiRequestError } from '@/lib/api/client';
import { ForbiddenState } from '@/components/admin/ForbiddenState';
import { PermissionGate } from '@/components/admin/PermissionGate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CandidateStatusBadge, accountState } from './CandidateStatusBadge';
import { DeletionStateBanner } from './DeletionStateBanner';
import { AdminDocumentList } from './AdminDocumentList';
import { SuspendDialog } from './SuspendDialog';
import { PurgeDialog } from './PurgeDialog';

type OpenDialog = 'suspend' | 'purge' | null;

/**
 * The ADMIN candidate view (Screen 25's detail) — a deliberately SEPARATE
 * design from the S3-F2 employer-context components. This view renders
 * phone/email REGARDLESS of the candidate's privacy toggles (the audited
 * S6a-B1 relaxation); the employer components render OMISSION. One component
 * serving both is how a privacy boundary gets punched through six months from
 * now — so nothing in this folder imports from the employer-context component
 * tree, and the component tests assert that structurally on the source files.
 *
 * It renders WHAT THE API RETURNS — the admin payload carries contact details,
 * completion, experiences, skills, document status and the application count;
 * it does not carry a photo or dob, so none are invented here.
 *
 * The DANGER ZONE sits alone at the very bottom, after everything else and
 * physically distant from Suspend — a mis-click between "suspend" and "erase a
 * human's data" must be structurally impossible.
 */
export function AdminCandidateProfile({ candidateId }: { candidateId: string }) {
  const t = useTranslations('admin.candidates.profile');
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const [detail, setDetail] = useState<AdminCandidateDetail | null>(null);
  const [error, setError] = useState<ApiRequestError | Error | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [purgeStarted, setPurgeStarted] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetail(await getCandidate(candidateId));
    } catch (err) {
      setError(err as Error);
    }
  }, [candidateId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Consequential + low-frequency → refetch after every action, never optimistic.
  async function run(action: () => Promise<unknown>, opts?: { isPurge?: boolean }) {
    setBusy(true);
    setDialogError(null);
    try {
      await action();
      setDialog(null);
      if (opts?.isPurge) setPurgeStarted(true);
      await load();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        const code = err.error.code;
        if (code === 'CANDIDATE_ALREADY_PURGED') {
          // The guard worked — render calmly and show the truth.
          setDialog(null);
          await load();
        } else {
          setDialogError(err.error.detail);
        }
      } else {
        setDialogError(t('actionFailed'));
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
        <p className="text-sm font-medium text-error-fg">{t('loadFailed')}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const state = accountState(detail);
  const purged = state === 'PURGED';

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/${locale}/admin/candidates`}
        className="inline-flex min-h-[44px] w-fit items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-neutral-600 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('backToList')}
      </Link>

      {purgeStarted && purged && (
        <p role="status" className="rounded-lg bg-info-bg p-3 text-sm font-medium text-info-fg">
          {t('purgeStarted')}
        </p>
      )}

      <DeletionStateBanner card={detail} />

      {/* Identity header — renders the admin payload, tombstone included. */}
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-neutral-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={
              purged
                ? 'flex size-12 items-center justify-center rounded-full bg-neutral-200 text-lg font-semibold text-neutral-600'
                : 'flex size-12 items-center justify-center rounded-full bg-primary-50 text-lg font-semibold text-primary-700'
            }
          >
            {purged ? '—' : detail.fullName.charAt(0).toUpperCase()}
          </span>
          <div>
            <h1 className="text-xl font-bold text-neutral-900">{detail.fullName}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <CandidateStatusBadge card={detail} />
              {!purged && (
                <Badge variant={detail.profileVisible ? 'info' : 'neutral'}>
                  {detail.profileVisible ? t('visibleToEmployers') : t('hiddenFromEmployers')}
                </Badge>
              )}
              <span className="text-xs text-neutral-600">
                {t('memberSince', {
                  date: formatMonthYear(detail.createdAt, locale),
                })}
              </span>
            </div>
          </div>
        </div>

        {/* Account actions — moderation, not profile editing. Gated candidates.edit. */}
        {!purged && (
          <PermissionGate permission="candidates.edit">
            <div className="flex gap-2">
              {state === 'ACTIVE' && (
                <Button variant="outline" size="sm" onClick={() => setDialog('suspend')}>
                  {t('suspend')}
                </Button>
              )}
              {state === 'SUSPENDED' && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void run(() => reactivateCandidate(detail.id))}
                >
                  {t('reactivate')}
                </Button>
              )}
            </div>
          </PermissionGate>
        )}
      </header>

      {/* Contact — the deliberate, audited relaxation, stated factually. */}
      <section
        aria-labelledby="candidate-contact-heading"
        className="rounded-xl border border-neutral-200 bg-white p-4"
      >
        <h2 id="candidate-contact-heading" className="text-sm font-semibold text-neutral-900">
          {t('contactHeading')}
        </h2>
        <dl className="mt-2 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4 sm:block">
            <dt className="text-neutral-600">{t('phone')}</dt>
            <dd className="font-medium text-neutral-900">{detail.phone ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-4 sm:block">
            <dt className="text-neutral-600">{t('email')}</dt>
            <dd className="font-medium text-neutral-900">{detail.email ?? '—'}</dd>
          </div>
        </dl>
        {/* A quiet, honest line — accountability, not a scare banner. */}
        <p role="note" className="mt-3 text-xs text-neutral-600">
          {t('adminViewNote')}
        </p>
      </section>

      {/* Profile facts — what the admin payload carries, nothing invented. */}
      <section
        aria-labelledby="candidate-profile-heading"
        className="rounded-xl border border-neutral-200 bg-white p-4"
      >
        <h2 id="candidate-profile-heading" className="text-sm font-semibold text-neutral-900">
          {t('profileHeading')}
        </h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-neutral-600">{t('completion')}</dt>
            <dd className="font-medium text-neutral-900">{detail.completionPct}%</dd>
          </div>
          <div>
            <dt className="text-neutral-600">{t('applications')}</dt>
            <dd className="font-medium text-neutral-900">{detail.applicationCount}</dd>
          </div>
          <div>
            <dt className="text-neutral-600">{t('skills')}</dt>
            <dd className="font-medium text-neutral-900">
              {detail.skills.length > 0 ? detail.skills.map((s) => s.name).join(', ') : '—'}
            </dd>
          </div>
        </dl>

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-600">
          {t('experienceHeading')}
        </h3>
        {detail.experiences.length === 0 ? (
          <p className="mt-1 text-sm text-neutral-600">
            {purged ? t('experiencePurged') : t('experienceNone')}
          </p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1.5">
            {detail.experiences.map((exp) => (
              <li key={exp.id} className="text-sm text-neutral-700">
                <span className="font-medium text-neutral-900">{exp.role}</span>
                {' · '}
                {exp.companyName}
                {exp.country ? ` · ${exp.country}` : ''}
                {typeof exp.years === 'number' && ` · ${formatDuration(t, exp.years, exp.months)}`}
              </li>
            ))}
          </ul>
        )}
      </section>

      <AdminDocumentList detail={detail} />

      {/* ── THE DANGER ZONE ────────────────────────────────────────────────
          Alone at the bottom, after everything else, visually distinct, and
          NEVER adjacent to Suspend. Gated on candidates.delete
          (SUPER_ADMIN-effective): an ADMIN sees nothing here at all. A purged
          account has no danger zone — nothing is left to destroy. */}
      {!purged && (
        <PermissionGate permission="candidates.delete">
          <section
            aria-labelledby="danger-zone-heading"
            className="mt-8 rounded-xl border-2 border-error-fg/30 bg-error-bg/40 p-4"
          >
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-error-fg" aria-hidden="true" />
              <div className="flex-1">
                <h2 id="danger-zone-heading" className="text-sm font-semibold text-error-fg">
                  {t('dangerZoneHeading')}
                </h2>
                <p className="mt-1 text-sm text-neutral-700">{t('dangerZoneBody')}</p>
                <Button
                  variant="destructive"
                  size="sm"
                  className="mt-3"
                  onClick={() => setDialog('purge')}
                >
                  {t('purgeButton')}
                </Button>
              </div>
            </div>
          </section>
        </PermissionGate>
      )}

      {dialog === 'suspend' && (
        <SuspendDialog
          candidateName={detail.fullName}
          busy={busy}
          serverError={dialogError}
          onConfirm={(reason) => void run(() => suspendCandidate(detail.id, reason))}
          onClose={() => {
            setDialog(null);
            setDialogError(null);
          }}
        />
      )}

      {dialog === 'purge' && (
        <PurgeDialog
          candidateName={detail.fullName}
          busy={busy}
          serverError={dialogError}
          onConfirm={(reason) =>
            void run(() => purgeCandidate(detail.id, reason), { isPurge: true })
          }
          onClose={() => {
            setDialog(null);
            setDialogError(null);
          }}
        />
      )}
    </div>
  );
}
