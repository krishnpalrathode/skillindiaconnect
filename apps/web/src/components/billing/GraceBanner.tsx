'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { formatDate } from '@/lib/format/date';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface GraceBannerProps {
  planName: string;
  graceEndsAt: string;
  daysRemaining: number;
  renewHref: string;
}

export function GraceBanner({ planName, graceEndsAt, daysRemaining, renewHref }: GraceBannerProps) {
  const t = useTranslations('billing.manage');

  const graceEndDate = formatDate(graceEndsAt);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col gap-3 rounded-lg border border-warning-fg/25 bg-warning-bg px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-fg" aria-hidden="true" />
        <div className="text-sm">
          <p className="font-semibold text-warning-fg">
            {t('graceBannerTitle', { plan: planName })}
          </p>
          <p className="mt-0.5 text-warning-fg/80">
            {t('graceBannerBody', { date: graceEndDate, count: daysRemaining })}
          </p>
        </div>
      </div>
      <Button
        asChild
        size="sm"
        className="shrink-0 bg-warning-fg text-white hover:bg-warning-fg/90 focus-visible:ring-warning-fg/40"
      >
        <Link href={renewHref}>{t('renewNow')}</Link>
      </Button>
    </div>
  );
}
