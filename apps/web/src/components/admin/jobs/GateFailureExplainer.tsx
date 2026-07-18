'use client';

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ShieldAlert, Building2, CreditCard } from 'lucide-react';
import type { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';

/**
 * The three HONEST approval/publish failures — the screen's soul.
 *
 * S6b-B2 re-runs the publish gate ladder at approval time because the world
 * may have changed while the job sat in review. Each failure is the system
 * working correctly, so each gets its own explanation AND its own remedy:
 *  - EMPLOYER_NOT_APPROVED → link to the employer's review page (Screen 24);
 *  - WORKER_PROTECTION_VIOLATION → the failing rule(s) NAMED from the error
 *    meta, with Reject offered inline (the employer must add the benefit);
 *  - JOB_QUOTA_EXCEEDED → the plan explanation (the remedy is the employer
 *    upgrading; the admin can leave it pending or reject).
 * An admin who sees "Failed to approve" clicks again; an admin who sees WHY
 * takes the right next action. A generic error here is a bug.
 *
 * role="alert" — an admin using AT must HEAR why the approval failed.
 */
export function GateFailureExplainer({
  error,
  companyId,
  companyName,
  onReject,
}: {
  error: ApiError;
  companyId: string;
  companyName: string;
  /** Offered inline for the protection case (and as a fallback remedy on quota). */
  onReject?: () => void;
}) {
  const t = useTranslations('admin.jobs.gateFailure');
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const ruleName = (violation: string): string => {
    switch (violation) {
      case 'accommodation':
        return t('rules.accommodation');
      case 'healthInsurance':
        return t('rules.healthInsurance');
      case 'transportation':
        return t('rules.transportation');
      default:
        return violation;
    }
  };

  let icon = ShieldAlert;
  let title: string;
  let body: string;
  let remedy: React.ReactNode = null;

  switch (error.code) {
    case 'EMPLOYER_NOT_APPROVED': {
      icon = Building2;
      title = t('employer.title');
      body = t('employer.body', { company: companyName });
      remedy = (
        <Link
          href={`/${locale}/admin/employers/${companyId}`}
          className="inline-flex min-h-[44px] items-center rounded-lg border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-800 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          {t('employer.remedy')}
        </Link>
      );
      break;
    }
    case 'WORKER_PROTECTION_VIOLATION': {
      icon = ShieldAlert;
      const violations = Array.isArray(error.meta?.['violations'])
        ? (error.meta['violations'] as string[])
        : [];
      const named = violations.map(ruleName).join(', ');
      title = t('protection.title');
      body = t('protection.body', { rules: named || t('protection.unknownRule') });
      remedy = onReject ? (
        <Button variant="destructive" size="sm" onClick={onReject}>
          {t('protection.remedy')}
        </Button>
      ) : null;
      break;
    }
    case 'JOB_QUOTA_EXCEEDED': {
      icon = CreditCard;
      title = t('quota.title');
      body = t('quota.body', { company: companyName });
      remedy = <p className="text-xs text-neutral-600">{t('quota.remedy')}</p>;
      break;
    }
    default: {
      // Not one of the ladder's codes — still explained, never swallowed.
      title = t('unknown.title');
      body = error.detail || t('unknown.body');
    }
  }

  const Icon = icon;

  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-xl border border-error-fg/30 bg-error-bg/40 p-4"
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-5 shrink-0 text-error-fg" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-error-fg">{title}</p>
          <p className="mt-1 text-sm text-neutral-800">{body}</p>
        </div>
      </div>
      {remedy && <div className="flex items-center gap-2 ps-8">{remedy}</div>}
    </div>
  );
}
