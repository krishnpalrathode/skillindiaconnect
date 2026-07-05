'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ArrowUpRight } from 'lucide-react';
import { getSubscription, type EmployerSubscription } from '@/lib/api/employer';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

function daysUntil(dateStr: string): number {
  const now = Date.now();
  const target = new Date(dateStr).getTime();
  return Math.max(0, Math.ceil((target - now) / (1000 * 60 * 60 * 24)));
}

export function PlanStatusWidget() {
  const t = useTranslations('employer');
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const [subscription, setSubscription] = useState<EmployerSubscription | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getSubscription()
      .then(setSubscription)
      .catch(() => {
        // Sprint 5 stub returns 501 — treat as free plan
        setSubscription(null);
      })
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

  const isFree = !subscription || subscription.planKey === 'FREE';
  const daysLeft = subscription?.expiresAt ? daysUntil(subscription.expiresAt) : null;
  const nearExpiry = daysLeft !== null && daysLeft <= 7;

  return (
    <div className="px-3 py-3 rounded-lg bg-neutral-50 border border-neutral-200 mx-2 mb-3">
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-neutral-700 truncate">
            {isFree ? t('plan.freePlan') : (subscription?.planName ?? t('plan.proPlan'))}
          </p>
          {!isFree && daysLeft !== null && (
            <p
              className={cn(
                'text-xs mt-0.5',
                nearExpiry ? 'text-warning-fg font-medium' : 'text-neutral-500',
              )}
            >
              {nearExpiry && (
                <AlertTriangle
                  className="inline size-3 me-0.5 align-text-bottom"
                  aria-hidden="true"
                />
              )}
              {t('plan.daysLeft', { count: daysLeft })}
            </p>
          )}
          {isFree && <p className="text-xs text-neutral-500 mt-0.5">{t('plan.freeHint')}</p>}
        </div>
      </div>
      <Link
        href={`/${locale}/employer/subscription`}
        className={cn(
          'mt-2 flex items-center gap-1 text-xs font-medium rounded transition-colors',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
          isFree
            ? 'text-primary-600 hover:text-primary-700'
            : 'text-neutral-600 hover:text-neutral-800',
        )}
      >
        {isFree ? t('plan.upgrade') : t('plan.manage')}
        <ArrowUpRight className="size-3" aria-hidden="true" />
      </Link>
    </div>
  );
}
