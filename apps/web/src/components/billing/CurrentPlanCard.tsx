'use client';

import React from 'react';
import { useTranslations, useLocale } from 'next-intl';
import Link from 'next/link';
import { CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { GraceBanner } from './GraceBanner';
import type { components } from '@skillindiaconnect/shared-types';

type SubscriptionStatus = components['schemas']['SubscriptionStatus'];

interface CurrentPlanCardProps {
  subscription: SubscriptionStatus;
}

function formatDate(dateStr: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(dateStr));
}

export function CurrentPlanCard({ subscription }: CurrentPlanCardProps) {
  const t = useTranslations('billing.manage');
  const locale = useLocale();

  const { plan, status, expiresAt, graceEndsAt, daysRemaining, renewable } = subscription;
  const isFree = plan.code === 'FREE';
  const isGrace = status === 'GRACE';
  const isExpired = status === 'EXPIRED';
  const isActive = status === 'ACTIVE' && !isFree;

  return (
    <section
      aria-labelledby="current-plan-heading"
      className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
    >
      <h2 id="current-plan-heading" className="mb-4 text-base font-semibold text-neutral-900">
        {t('currentPlanTitle')}
      </h2>

      {isGrace && graceEndsAt && (
        <div className="mb-4">
          <GraceBanner
            planName={plan.name}
            graceEndsAt={graceEndsAt}
            daysRemaining={daysRemaining ?? 0}
            renewHref={`/${locale}/employer/subscription`}
          />
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
              isActive ? 'bg-success-bg' : isGrace ? 'bg-warning-bg' : 'bg-neutral-100',
            )}
          >
            {isActive ? (
              <CheckCircle2 className="size-4 text-success-fg" aria-hidden="true" />
            ) : isGrace ? (
              <Clock className="size-4 text-warning-fg" aria-hidden="true" />
            ) : (
              <AlertCircle className="size-4 text-neutral-600" aria-hidden="true" />
            )}
          </span>
          <div>
            <p className="text-sm font-semibold text-neutral-900">
              {isFree ? t('statusFree') : plan.name}
            </p>
            {isActive && expiresAt && (
              <p className="mt-0.5 text-xs text-neutral-600">
                {t('expiresOn', { date: formatDate(expiresAt, locale) })}
              </p>
            )}
            {isActive && daysRemaining !== null && (
              <p
                className={cn(
                  'mt-0.5 text-xs font-medium',
                  daysRemaining <= 7 ? 'text-warning-fg' : 'text-neutral-600',
                )}
              >
                {t('daysRemaining', { count: daysRemaining })}
              </p>
            )}
            {isGrace && graceEndsAt && (
              <p className="mt-0.5 text-xs text-warning-fg font-medium">
                {t('graceDaysLeft', { count: daysRemaining ?? 0 })}
              </p>
            )}
            {isExpired && <p className="mt-0.5 text-xs text-neutral-600">{t('expiredHint')}</p>}
            {isFree && <p className="mt-0.5 text-xs text-neutral-600">{t('freeHint')}</p>}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {(isFree || isExpired) && (
            <Button asChild size="sm">
              <Link href={`/${locale}/employer/subscription`}>{t('upgradeNow')}</Link>
            </Button>
          )}
          {isActive && renewable && (
            <Button asChild size="sm">
              <Link href={`/${locale}/employer/subscription`}>{t('renewNow')}</Link>
            </Button>
          )}
          {isActive && !renewable && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/${locale}/employer/subscription`}>{t('managePlan')}</Link>
            </Button>
          )}
          {isGrace && (
            <Button asChild size="sm" className="bg-warning-fg text-white hover:bg-warning-fg/90">
              <Link href={`/${locale}/employer/subscription`}>{t('renewNow')}</Link>
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
