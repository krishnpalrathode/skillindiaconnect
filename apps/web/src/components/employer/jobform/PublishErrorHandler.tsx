'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, ShieldAlert, TrendingUp } from 'lucide-react';
import type { ApiError } from '@/lib/api/client';

interface PublishErrorHandlerProps {
  error: ApiError;
  onDismiss?: () => void;
}

export function PublishErrorHandler({ error, onDismiss }: PublishErrorHandlerProps) {
  const t = useTranslations('jobform.publishErrors');
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  if (error.code === 'EMPLOYER_NOT_APPROVED') {
    return (
      <div
        role="alert"
        className="rounded-lg border border-warning-fg/30 bg-warning-bg p-4 flex gap-3"
      >
        <AlertCircle className="size-5 shrink-0 text-warning-fg mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-warning-fg">{t('notApprovedTitle')}</p>
          <p className="mt-1 text-sm text-neutral-700">{t('notApprovedBody')}</p>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t('dismiss')}
            className="shrink-0 text-neutral-400 hover:text-neutral-600"
          >
            ×
          </button>
        )}
      </div>
    );
  }

  if (error.code === 'WORKER_PROTECTION_VIOLATION') {
    const violations = (error.meta?.violations as string[] | undefined) ?? [];
    const violationLabels: Record<string, string> = {
      accommodation: t('violationAccommodation'),
      healthInsurance: t('violationHealthInsurance'),
      transportation: t('violationTransportation'),
    };
    return (
      <div role="alert" className="rounded-lg border border-error/30 bg-error-bg p-4 flex gap-3">
        <ShieldAlert className="size-5 shrink-0 text-error-fg mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-error-fg">{t('protectionTitle')}</p>
          <p className="mt-1 text-sm text-neutral-700">{t('protectionBody')}</p>
          {violations.length > 0 && (
            <ul className="mt-2 list-disc list-inside space-y-0.5">
              {violations.map((v) => (
                <li key={v} className="text-sm text-error-fg font-medium">
                  {violationLabels[v] ?? v}
                </li>
              ))}
            </ul>
          )}
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t('dismiss')}
            className="shrink-0 text-neutral-400 hover:text-neutral-600"
          >
            ×
          </button>
        )}
      </div>
    );
  }

  if (error.code === 'JOB_QUOTA_EXCEEDED') {
    const planLimit = (error.meta?.planLimit as number | undefined) ?? 1;
    return (
      <div
        role="alert"
        className="rounded-lg border border-primary-200 bg-primary-50 p-4 flex gap-3"
      >
        <TrendingUp className="size-5 shrink-0 text-primary-600 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-primary-800">
            {t('quotaTitle', { limit: planLimit })}
          </p>
          <p className="mt-1 text-sm text-neutral-700">{t('quotaBody')}</p>
          <Link
            href={`/${locale}/employer/subscription`}
            className="mt-2 inline-flex text-sm font-semibold text-primary-700 underline hover:text-primary-900"
          >
            {t('quotaUpgradeLink')} →
          </Link>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t('dismiss')}
            className="shrink-0 text-neutral-400 hover:text-neutral-600"
          >
            ×
          </button>
        )}
      </div>
    );
  }

  // Generic fallback
  return (
    <div role="alert" className="rounded-lg border border-error/30 bg-error-bg p-4 flex gap-3">
      <AlertCircle className="size-5 shrink-0 text-error-fg mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-error-fg">{t('genericTitle')}</p>
        <p className="mt-1 text-sm text-neutral-700">{error.detail}</p>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('dismiss')}
          className="shrink-0 text-neutral-400 hover:text-neutral-600"
        >
          ×
        </button>
      )}
    </div>
  );
}
