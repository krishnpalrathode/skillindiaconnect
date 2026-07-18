'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { components } from '@skillindiaconnect/shared-types';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { openRazorpayCheckout } from '@/lib/billing/razorpay';

type CheckoutSession = components['schemas']['CheckoutSession'];

/** MSW / dev has no real gateway — the launcher simulates the return instead. */
function defaultMockMode(): boolean {
  return process.env['NEXT_PUBLIC_API_MOCKING'] === 'enabled';
}

interface CheckoutLauncherProps {
  session: CheckoutSession;
  /** Gateway flow returned → advance to PaymentConfirming (NEVER success). */
  onConfirming: (orderId: string) => void;
  /** User dismissed / launch failed → back to the plan cards. */
  onCancel: () => void;
  // ── Injectable seams (tests + the mock walk) ──────────────────────────────
  mockMode?: boolean;
  navigate?: (url: string) => void;
  launchRazorpay?: typeof openRazorpayCheckout;
}

/**
 * Server-routed checkout launch (S5-F1) — the FE launches what it's TOLD, it
 * never chooses. Exactly one gateway block is present on the session and always
 * matches `session.gateway`; we branch on `gateway`:
 *
 *   RAZORPAY → load Checkout.js and open() (real key only).
 *   STRIPE   → redirect the browser to the Stripe-hosted URL.
 *   dev/MSW  → no real gateway exists, so BOTH show a "Simulate payment"
 *              affordance that jumps straight to CONFIRMING (the mock order
 *              flips only after its poll delay — instant activation is
 *              impossible by design).
 *
 * CRITICAL: none of these mark payment done. The Razorpay handler, the Stripe
 * return, and the simulate button all advance to CONFIRMING — the PAID poll is
 * the only thing that confirms.
 */
export function CheckoutLauncher({
  session,
  onConfirming,
  onCancel,
  mockMode = defaultMockMode(),
  navigate = (url) => {
    window.location.href = url;
  },
  launchRazorpay = openRazorpayCheckout,
}: CheckoutLauncherProps) {
  const t = useTranslations('billing');
  const [loadError, setLoadError] = useState(false);
  const launchedRef = useRef(false);

  // Real-gateway launch runs once on mount (skipped entirely in mock mode).
  useEffect(() => {
    if (mockMode || launchedRef.current) return;
    launchedRef.current = true;

    if (session.gateway === 'STRIPE' && session.stripe) {
      navigate(session.stripe.redirectUrl);
      return;
    }
    if (session.gateway === 'RAZORPAY' && session.razorpay) {
      const { keyId, gatewayOrderId } = session.razorpay;
      void launchRazorpay({
        keyId,
        gatewayOrderId,
        onFlowComplete: () => onConfirming(session.orderId),
        onDismiss: onCancel,
      }).then((ok) => {
        if (!ok) setLoadError(true); // script blocked/offline → retry state
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mockMode, session]);

  // ── dev/MSW: simulate the gateway return ──────────────────────────────────
  if (mockMode) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center">
        <p className="text-sm text-neutral-600 max-w-sm">{t('mockLaunchNote')}</p>
        <div className="flex gap-2">
          <Button variant="primary" size="md" onClick={() => onConfirming(session.orderId)}>
            {t('mockSimulatePay')}
          </Button>
          <Button variant="ghost" size="md" onClick={onCancel}>
            {t('cancel')}
          </Button>
        </div>
      </div>
    );
  }

  // ── Real gateway: launch-in-progress (or the load-failed retry) ───────────
  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border border-neutral-200 bg-white p-8 text-center">
        <p className="text-sm text-error-fg">{t('launchError')}</p>
        <Button variant="primary" size="md" onClick={onCancel}>
          {t('failedRetry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-neutral-200 bg-white p-8 text-center">
      <Spinner size={28} label={t('launchingTitle')} />
      <p className="text-sm text-neutral-500">
        {session.gateway === 'STRIPE' ? t('redirectingStripe') : t('launchingRazorpay')}
      </p>
    </div>
  );
}
