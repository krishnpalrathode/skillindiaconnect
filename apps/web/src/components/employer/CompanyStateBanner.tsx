'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, Info, XCircle } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { cn } from '@/lib/utils';

type CompanyStatus = components['schemas']['CompanyStatus'];

interface CompanyStateBannerProps {
  status: CompanyStatus;
  rejectionReason?: string | null;
}

export function CompanyStateBanner({ status, rejectionReason }: CompanyStateBannerProps) {
  const t = useTranslations('employer');
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  if (status === 'APPROVED') return null;

  const configs = {
    PENDING: {
      role: 'status' as const,
      icon: <Info className="size-5 shrink-0" aria-hidden="true" />,
      className: 'bg-info-bg text-info-fg border-info',
      title: t('banner.pendingTitle'),
      body: t('banner.pendingBody'),
      action: null,
    },
    REJECTED: {
      role: 'alert' as const,
      icon: <AlertCircle className="size-5 shrink-0" aria-hidden="true" />,
      className: 'bg-warning-bg text-warning-fg border-warning',
      title: t('banner.rejectedTitle'),
      body: rejectionReason ?? t('banner.rejectedBodyFallback'),
      action: (
        <Link
          href={`/${locale}/employer/onboarding`}
          className="underline underline-offset-2 font-semibold hover:no-underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
        >
          {t('banner.rejectedAction')}
        </Link>
      ),
    },
    SUSPENDED: {
      role: 'alert' as const,
      icon: <XCircle className="size-5 shrink-0" aria-hidden="true" />,
      className: 'bg-error-bg text-error-fg border-error',
      title: t('banner.suspendedTitle'),
      body: t('banner.suspendedBody'),
      action: null,
    },
  };

  const config = configs[status];
  if (!config) return null;

  return (
    <div
      role={config.role}
      aria-live={config.role === 'alert' ? 'assertive' : 'polite'}
      className={cn('flex items-start gap-3 px-4 py-3 border-b text-sm', config.className)}
    >
      {config.icon}
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
        <span className="font-semibold">{config.title}</span>
        <span>{config.body}</span>
        {config.action}
      </div>
    </div>
  );
}
