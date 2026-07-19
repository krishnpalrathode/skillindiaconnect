'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ArrowUpRight } from 'lucide-react';
import { getSubscriptionStatus } from '@/lib/api/billing';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { components } from '@skillindiaconnect/shared-types';

type SubscriptionStatus = components['schemas']['SubscriptionStatus'];

export function PlanStatusWidget() {
  const t = useTranslations('employer');
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const [sub, setSub] = useState<SubscriptionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getSubscriptionStatus()
      .then(setSub)
      .catch(() => setSub(null))
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return (
      <div className="px-3 py-3 space-y-1.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-16" />
      </div>
    );
  }

  const isFree = !sub || sub.plan.code === 'FREE';
  const isGrace = sub?.status === 'GRACE';
  const isExpired = sub?.status === 'EXPIRED';
  const isActive = sub?.status === 'ACTIVE' && !isFree;
  const daysRemaining = sub?.daysRemaining ?? null;
  const nearExpiry = isActive && daysRemaining !== null && daysRemaining <= 7;

  const subscriptionHref = `/${locale}/employer/subscription`;

  return (
    <div
      className={cn(
        'px-3 py-3 rounded-lg border mx-2 mb-3',
        isGrace ? 'bg-warning-bg border-warning-fg/25' : 'bg-neutral-50 border-neutral-200',
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-neutral-700 truncate">
            {isFree || isExpired
              ? t('plan.freePlan')
              : isGrace
                ? t('plan.gracePlan', { plan: sub!.plan.name })
                : (sub?.plan.name ?? t('plan.proPlan'))}
          </p>

          {isActive && daysRemaining !== null && (
            <p
              className={cn(
                'text-xs mt-0.5',
                nearExpiry ? 'text-warning-fg font-medium' : 'text-neutral-600',
              )}
            >
              {nearExpiry && (
                <AlertTriangle
                  className="inline size-3 me-0.5 align-text-bottom"
                  aria-hidden="true"
                />
              )}
              {t('plan.daysLeft', { count: daysRemaining })}
            </p>
          )}

          {isGrace && daysRemaining !== null && (
            <p className="text-xs mt-0.5 text-warning-fg font-medium">
              <AlertTriangle
                className="inline size-3 me-0.5 align-text-bottom"
                aria-hidden="true"
              />
              {t('plan.graceDaysLeft', { count: daysRemaining })}
            </p>
          )}

          {(isFree || isExpired) && (
            <p className="text-xs text-neutral-600 mt-0.5">{t('plan.freeHint')}</p>
          )}
        </div>
      </div>

      <Link
        href={subscriptionHref}
        className={cn(
          'mt-2 flex items-center gap-1 text-xs font-medium rounded transition-colors',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
          isFree || isExpired
            ? 'text-primary-600 hover:text-primary-700'
            : isGrace
              ? 'text-warning-fg hover:text-warning-fg/80'
              : 'text-neutral-600 hover:text-neutral-800',
        )}
      >
        {isFree || isExpired ? t('plan.upgrade') : isGrace ? t('plan.renewNow') : t('plan.manage')}
        <ArrowUpRight className="size-3" aria-hidden="true" />
      </Link>
    </div>
  );
}
