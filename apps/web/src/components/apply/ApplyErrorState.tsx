'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { AlertTriangle, FileWarning, Ban, CheckCircle2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import type { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ApplyErrorStateProps {
  error: ApiError;
  locale: string;
  onRetry: () => void;
}

/**
 * The five apply-gate failures as calm, single-action states — meta-driven copy
 * and a real link (never a raw error string, never a dead end). An unknown code
 * degrades to a generic retry. The application id is not in the 409 body, so
 * ALREADY_APPLIED links to the My Applications LIST route (`/{locale}/applications`,
 * F2) — route-stable so F2 slots in without a copy change.
 */
export function ApplyErrorState({ error, locale, onRetry }: ApplyErrorStateProps) {
  const t = useTranslations('apply.errors');

  const profileHref = `/${locale}/profile`;
  const docsHref = `/${locale}/profile#documents`;
  const jobsHref = `/${locale}/jobs`;
  const applicationsHref = `/${locale}/applications`;

  let Icon: LucideIcon = AlertTriangle;
  let title: string;
  let body: string;
  let action: { label: string; href: string } | null = null;

  switch (error.code) {
    case 'PROFILE_INCOMPLETE': {
      const pct = Number(error.meta?.['completionPct'] ?? 0);
      const threshold = Number(error.meta?.['threshold'] ?? 0);
      Icon = AlertTriangle;
      title = t('profileIncomplete.title');
      body = t('profileIncomplete.body', { pct, threshold });
      action = { label: t('profileIncomplete.action'), href: profileHref };
      break;
    }
    case 'MANDATORY_DOCS_MISSING': {
      const missing = (error.meta?.['missing'] as string[] | undefined) ?? [];
      const KNOWN = ['PASSPORT', 'EXPERIENCE_CERT', 'EDUCATIONAL_CERT'];
      const names = missing.map((d) => (KNOWN.includes(d) ? t(`docTypes.${d}`) : d)).join(', ');
      Icon = FileWarning;
      title = t('docsMissing.title');
      body = t('docsMissing.body', { docs: names });
      action = { label: t('docsMissing.action'), href: docsHref };
      break;
    }
    case 'PASSPORT_INVALID': {
      const reason = String(error.meta?.['reason'] ?? 'missing');
      Icon = FileWarning;
      title = t('passportInvalid.title');
      body = reason === 'expired' ? t('passportInvalid.expired') : t('passportInvalid.missing');
      action = { label: t('passportInvalid.action'), href: docsHref };
      break;
    }
    case 'ALREADY_APPLIED': {
      Icon = CheckCircle2;
      title = t('alreadyApplied.title');
      body = t('alreadyApplied.body');
      action = { label: t('alreadyApplied.action'), href: applicationsHref };
      break;
    }
    case 'JOB_NOT_ACTIVE': {
      Icon = Ban;
      title = t('jobNotActive.title');
      body = t('jobNotActive.body');
      action = { label: t('jobNotActive.action'), href: jobsHref };
      break;
    }
    default: {
      Icon = AlertTriangle;
      title = t('generic.title');
      body = t('generic.body');
      action = null;
    }
  }

  return (
    <div role="alert" className="flex flex-col items-center gap-4 py-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-warning-bg">
        <Icon className="size-6 text-warning-fg" aria-hidden="true" />
      </span>
      <div>
        <h3 className="text-base font-semibold text-neutral-900">{title}</h3>
        <p className="mt-1 text-sm text-neutral-600">{body}</p>
      </div>
      {action ? (
        <Link href={action.href} className={cn(buttonVariants({ variant: 'primary' }), 'min-h-11')}>
          {action.label}
        </Link>
      ) : (
        <Button variant="primary" onClick={onRetry} className="min-h-11">
          {t('generic.retry')}
        </Button>
      )}
    </div>
  );
}
