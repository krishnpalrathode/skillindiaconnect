'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, MessageSquareWarning } from 'lucide-react';
import {
  getAdminApplication,
  type AdminApplicationDetail,
  type AdminTimelineEntry,
} from '@/lib/api/admin-applications';
import { ApiRequestError } from '@/lib/api/client';
import { PermissionGate } from '@/components/admin/PermissionGate';
import { ForbiddenState } from '@/components/admin/ForbiddenState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ADMIN_APP_STATUS_VARIANT } from './AdminApplicationsTable';
import { OverrideDialog } from './OverrideDialog';
import { ResendWhatsAppDialog } from './ResendWhatsAppDialog';
import { NotesPanel } from './NotesPanel';

const BREAKDOWN_KEYS = ['category', 'experienceYears', 'foreignExperience', 'documents'] as const;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * The admin application detail — the admin sees EVERYTHING:
 *  - the candidate ↔ job pairing (links to both admin views);
 *  - the frozen match snapshot (score + breakdown, computed once at apply);
 *  - the FULL timeline: actorRole, the override flag, AND the overrideReason —
 *    the record whose existence is this screen's purpose. The candidate's
 *    shaped view deliberately excludes the reason; this one is admin-only.
 *  - the notification state: when the automated "Selected" WhatsApp fired
 *    (selectedNotifiedAt) — so an admin knows what the candidate has actually
 *    received BEFORE sending more.
 *
 * Actions (override / resend) refetch after — never optimistic.
 */
export function ApplicationDetailPanel({ applicationId }: { applicationId: string }) {
  const t = useTranslations('admin.applications.detail');
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const [detail, setDetail] = useState<AdminApplicationDetail | null>(null);
  const [error, setError] = useState<ApiRequestError | Error | null>(null);
  const [dialog, setDialog] = useState<'override' | 'resend' | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetail(await getAdminApplication(applicationId));
    } catch (err) {
      setError(err as Error);
    }
  }, [applicationId]);

  useEffect(() => {
    void load();
  }, [load]);

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
  if (!detail) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-8 w-72 rounded-lg" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  const candidate = detail.candidateName ?? t('deletedUser');
  const breakdown = (detail.matchBreakdown ?? {}) as Record<
    string,
    { score?: number; max?: number } | undefined
  >;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-neutral-900">{detail.humanId}</h1>
        <Badge variant={ADMIN_APP_STATUS_VARIANT[detail.status]}>
          {t(`status.${detail.status}`)}
        </Badge>
        {detail.overrideReason != null && <Badge variant="warning">{t('overrideChip')}</Badge>}
      </div>

      {/* The pairing — one line, both admin views linked. */}
      <p className="flex flex-wrap items-center gap-2 text-sm text-neutral-700">
        {detail.candidateId ? (
          <Link
            href={`/${locale}/admin/candidates/${detail.candidateId}`}
            className="font-medium text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
          >
            {candidate}
          </Link>
        ) : (
          <span className="text-neutral-600">{candidate}</span>
        )}
        <ArrowRight className="size-4 text-neutral-600" aria-hidden="true" />
        <Link
          href={`/${locale}/admin/jobs/${detail.jobId}`}
          className="font-medium text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
        >
          {detail.jobTitle ?? t('unknownJob')}
        </Link>
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          {/* The frozen snapshot */}
          <section
            aria-labelledby="match-heading"
            className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 id="match-heading" className="text-sm font-semibold text-neutral-900">
                {t('match.heading')}
              </h2>
              <span className="text-lg font-bold tabular-nums text-neutral-900">
                {detail.matchScore}
                <span className="text-sm font-normal text-neutral-600">/100</span>
              </span>
            </div>
            {/* Snapshot semantics stated: computed once at apply, never recomputed. */}
            <p className="text-xs text-neutral-600">{t('match.snapshotNote')}</p>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {BREAKDOWN_KEYS.map((key) => {
                const part = breakdown[key];
                if (!part || part.score === undefined) return null;
                return (
                  <div key={key} className="rounded-lg bg-neutral-50 p-2">
                    <dt className="text-xs text-neutral-600">{t(`match.${key}`)}</dt>
                    <dd className="text-sm font-semibold tabular-nums text-neutral-900">
                      {part.score}
                      <span className="font-normal text-neutral-600">/{part.max ?? '—'}</span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>

          {/* Application facts */}
          <section
            aria-labelledby="app-facts-heading"
            className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-4"
          >
            <h2 id="app-facts-heading" className="text-sm font-semibold text-neutral-900">
              {t('facts.heading')}
            </h2>
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600">{t('facts.applied')}</dt>
                <dd className="text-neutral-900">{formatDate(detail.appliedAt)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600">{t('facts.docs')}</dt>
                <dd className="text-neutral-900">
                  {t('facts.docsValue', {
                    complete: detail.docsCompleteCount,
                    required: detail.docsRequiredCount,
                  })}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600">{t('facts.passport')}</dt>
                <dd className={detail.passportValidAtApply ? 'text-success-fg' : 'text-error-fg'}>
                  {detail.passportValidAtApply
                    ? t('facts.passportValid')
                    : t('facts.passportInvalid')}
                </dd>
              </div>
              {/* What the candidate has ACTUALLY received. */}
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-600">{t('facts.whatsapp')}</dt>
                <dd className="text-neutral-900">
                  {detail.selectedNotifiedAt
                    ? t('facts.whatsappSentOn', { date: formatDate(detail.selectedNotifiedAt) })
                    : t('facts.whatsappNotSent')}
                </dd>
              </div>
            </dl>

            {detail.coverLetter && (
              <div className="mt-1 border-t border-neutral-100 pt-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
                  {t('facts.coverLetter')}
                </h3>
                <p className="mt-1 whitespace-pre-line text-sm text-neutral-700">
                  {detail.coverLetter}
                </p>
              </div>
            )}
          </section>

          {/* THE FULL TIMELINE — the record, reasons included. */}
          <section
            aria-labelledby="timeline-heading"
            className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-4"
          >
            <h2 id="timeline-heading" className="text-sm font-semibold text-neutral-900">
              {t('timeline.heading')}
            </h2>
            <p className="text-xs text-neutral-600">{t('timeline.adminViewNote')}</p>

            {detail.timeline.length === 0 && (
              <p role="status" className="text-sm text-neutral-600">
                {t('timeline.empty')}
              </p>
            )}

            <ol className="flex flex-col gap-3">
              {detail.timeline.map((entry: AdminTimelineEntry, idx: number) => (
                <li key={idx} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 size-2.5 shrink-0 rounded-full ${
                      entry.isAdminOverride ? 'bg-warning-fg' : 'bg-primary-600'
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="text-sm text-neutral-900">
                      {entry.fromStatus
                        ? t('timeline.transition', {
                            from: t(`status.${entry.fromStatus}`),
                            to: t(`status.${entry.toStatus}`),
                          })
                        : t('timeline.initial', { to: t(`status.${entry.toStatus}`) })}
                    </p>
                    <p className="text-xs text-neutral-600">
                      {t('timeline.byline', {
                        role: entry.actorRole ?? t('timeline.system'),
                        date: formatDate(entry.createdAt),
                      })}
                      {entry.isAdminOverride && (
                        <span className="ms-1.5 font-medium text-warning-fg">
                          {t('timeline.overrideFlag')}
                        </span>
                      )}
                    </p>
                    {/* The reason — admin/audit-only, and shown HERE in full. */}
                    {entry.overrideReason && (
                      <p className="mt-1 rounded-lg bg-warning-bg/60 p-2 text-xs text-neutral-800">
                        {t('timeline.reason', { reason: entry.overrideReason })}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="flex flex-col gap-4">
          {/* Actions — gated on applications.change_status */}
          <PermissionGate permission="applications.change_status">
            <section
              aria-labelledby="app-actions-heading"
              className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-4"
            >
              <h2 id="app-actions-heading" className="text-sm font-semibold text-neutral-900">
                {t('actions.heading')}
              </h2>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setDialog('override')}>
                  {t('actions.override')}
                </Button>
                {/* SELECTED-only — offering it elsewhere would just be a 422. */}
                {detail.status === 'SELECTED' && (
                  <Button variant="outline" onClick={() => setDialog('resend')}>
                    <MessageSquareWarning className="size-4" aria-hidden="true" />
                    {t('actions.resend')}
                  </Button>
                )}
              </div>
            </section>
          </PermissionGate>

          <NotesPanel applicationId={detail.id} />
        </div>
      </div>

      {dialog === 'override' && (
        <OverrideDialog
          application={detail}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            void load();
          }}
        />
      )}
      {dialog === 'resend' && (
        <ResendWhatsAppDialog
          application={detail}
          onClose={() => setDialog(null)}
          onDone={() => void load()}
        />
      )}
    </div>
  );
}
