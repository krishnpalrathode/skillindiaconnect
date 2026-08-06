'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import type { components } from '@skillindiaconnect/shared-types';
import { useEmployer } from '@/lib/employer/employer-context';
import { getPlans, getSubscriptionStatus, createCheckout } from '@/lib/api/billing';
import { ApiRequestError } from '@/lib/api/client';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { PlanCards } from '@/components/billing/PlanCards';
import { CheckoutLauncher } from '@/components/billing/CheckoutLauncher';
import { PaymentConfirming } from '@/components/billing/PaymentConfirming';
import { UpgradeContext } from '@/components/billing/UpgradeContext';
import { CurrentPlanCard } from '@/components/billing/CurrentPlanCard';
import { InvoiceList } from '@/components/billing/InvoiceList';
import { EMPLOYER_PAGE_SHELL } from '@/lib/page-shell';

type Plan = components['schemas']['Plan'];
type PlanCode = components['schemas']['PlanCode'];
type CheckoutSession = components['schemas']['CheckoutSession'];
type SubscriptionStatus = components['schemas']['SubscriptionStatus'];

type View =
  | { kind: 'plans' }
  | { kind: 'launching'; session: CheckoutSession }
  | { kind: 'confirming'; orderId: string };

/**
 * Screen 19 — Plans + checkout (S5-F1).
 *
 * Hosts the plan cards, the server-routed checkout launch, and the
 * webhook-truth polling UX. Lives inside the F0 employer shell (which supplies
 * useEmployer() → company.type for the GST framing). S5-F2 later adds the
 * "manage subscription" view alongside this.
 *
 * Entry points:
 *   - ?upgrade=quota (from S2-F4's JOB_QUOTA_EXCEEDED) → the context banner + Pro emphasis.
 *   - ?order={id} (a Stripe return) → jump straight to PaymentConfirming.
 */
export default function SubscriptionPage() {
  const t = useTranslations('billing');
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const searchParams = useSearchParams();
  const { company, isLoading: companyLoading } = useEmployer();

  const upgradeReason = searchParams.get('upgrade'); // 'quota' from F4
  const returnedOrderId = searchParams.get('order'); // Stripe return

  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [currentPlanCode, setCurrentPlanCode] = useState<PlanCode>('FREE');
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [busyPlan, setBusyPlan] = useState<PlanCode | null>(null);

  // A Stripe return deep-links straight into the confirming state.
  const [view, setView] = useState<View>(
    returnedOrderId ? { kind: 'confirming', orderId: returnedOrderId } : { kind: 'plans' },
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [planList, sub] = await Promise.all([getPlans(), getSubscriptionStatus()]);
      setPlans(planList);
      setSubscription(sub);
      setCurrentPlanCode(sub.plan.code);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleUpgrade = useCallback(
    async (planCode: PlanCode) => {
      setCheckoutError(null);
      setBusyPlan(planCode);
      try {
        // One Idempotency-Key per attempt: a double-tap replays the same order;
        // a genuine retry after failure gets a fresh key and a clean order.
        const idempotencyKey =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const session = await createCheckout(planCode, idempotencyKey);
        setView({ kind: 'launching', session });
      } catch (err) {
        if (err instanceof ApiRequestError) {
          const code = err.error.code;
          // Map the checkout error ladder to honest copy.
          if (code === 'EMPLOYER_NOT_APPROVED') setCheckoutError(t('errNotApproved'));
          else if (code === 'PLAN_NOT_PURCHASABLE') setCheckoutError(t('errNotPurchasable'));
          else if (code === 'SUBSCRIPTION_ALREADY_ACTIVE') setCheckoutError(t('errAlreadyActive'));
          else if (code === 'GATEWAY_UNAVAILABLE') setCheckoutError(t('errGatewayUnavailable'));
          else setCheckoutError(t('errGeneric'));
        } else {
          setCheckoutError(t('errGeneric'));
        }
      } finally {
        setBusyPlan(null);
      }
    },
    [t],
  );

  const backToPlans = useCallback(() => setView({ kind: 'plans' }), []);
  const goDashboard = useCallback(
    () => router.push(`/${locale}/employer/dashboard`),
    [router, locale],
  );
  const goPostJob = useCallback(
    () => router.push(`/${locale}/employer/jobs/new`),
    [router, locale],
  );

  // ── Loading / error ────────────────────────────────────────────────────────
  if (companyLoading || loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size={28} label={t('loadingPlans')} />
      </div>
    );
  }

  if (loadError || !plans) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-neutral-200/70 bg-white p-10 text-center shadow-sm">
        <p className="text-sm text-neutral-600">{t('loadError')}</p>
        <Button variant="outline" size="sm" className="rounded-xl" onClick={load}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  const isLocal = company?.type === 'LOCAL';

  return (
    <div className={EMPLOYER_PAGE_SHELL}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
          {t('pageTitle')}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">{t('pageSubtitle')}</p>
      </div>

      {/* Manage view — current plan status + invoice history (S5-F2). */}
      {view.kind === 'plans' && subscription && (
        <>
          <CurrentPlanCard subscription={subscription} />
          <InvoiceList />
        </>
      )}

      {view.kind === 'plans' && (
        <>
          {upgradeReason === 'quota' && <UpgradeContext />}

          {checkoutError && (
            <p role="alert" className="text-sm text-error-fg font-medium">
              {checkoutError}
            </p>
          )}

          {busyPlan ? (
            <div className="flex items-center gap-2 text-sm text-neutral-600">
              <Spinner size={18} label={t('startingCheckout')} />
              {t('startingCheckout')}
            </div>
          ) : null}

          <PlanCards
            plans={plans}
            isLocal={isLocal}
            currentPlanCode={currentPlanCode}
            emphasizePro={upgradeReason === 'quota'}
            onUpgrade={handleUpgrade}
          />
        </>
      )}

      {view.kind === 'launching' && (
        <CheckoutLauncher
          session={view.session}
          onConfirming={(orderId) => setView({ kind: 'confirming', orderId })}
          onCancel={backToPlans}
        />
      )}

      {view.kind === 'confirming' && (
        <PaymentConfirming
          orderId={view.orderId}
          onRetry={backToPlans}
          onPostJob={goPostJob}
          onDone={goDashboard}
        />
      )}
    </div>
  );
}
