'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, XCircle, Clock } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { getOrder } from '@/lib/api/billing';

type OrderStatus = components['schemas']['OrderStatus'];

type Phase = 'confirming' | 'paid' | 'failed' | 'timeout';

interface PaymentConfirmingProps {
  orderId: string;
  /** Back to the plan cards (from the FAILED state). */
  onRetry: () => void;
  /** Post a job now (from the SUCCESS state) — the quota is lifted. */
  onPostJob: () => void;
  /** Back to dashboard (from the SUCCESS state). */
  onDone: () => void;
  /**
   * Poll backoff schedule (ms) and total budget. Injectable so tests can drive
   * the timeout path fast; production uses widening 2s→8s over ~75s.
   */
  pollSchedule?: number[];
  timeoutMs?: number;
}

// Widening backoff: quick at first (the webhook usually lands in seconds), then
// easing off. Reused (last value repeats) until the timeout budget is spent.
const DEFAULT_SCHEDULE = [2000, 2000, 3000, 4000, 5000, 8000];
const DEFAULT_TIMEOUT_MS = 75_000;

/**
 * The webhook-truth polling UX (S5-F1) — the hard part.
 *
 * The order is CREATED until the SIGNATURE-VERIFIED WEBHOOK flips it; a gateway
 * success callback changes NOTHING. So this component (which mounts only AFTER
 * the gateway flow returns) starts in `confirming` and polls
 * GET /billing/orders/{id} with backoff:
 *   - PAID  → success (the ONLY path to success — never the callback).
 *   - FAILED / EXPIRED → the honest failure + retry.
 *   - still CREATED past the budget → the honest TIMEOUT ("we'll email you"),
 *     NEVER a false success and NEVER a false failure, with a real manual
 *     "refresh status" button.
 *
 * aria-live=polite announces every phase transition to screen readers.
 */
export function PaymentConfirming({
  orderId,
  onRetry,
  onPostJob,
  onDone,
  pollSchedule = DEFAULT_SCHEDULE,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: PaymentConfirmingProps) {
  const t = useTranslations('billing');
  const [phase, setPhase] = useState<Phase>('confirming');

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelled = useRef(false);
  const startedAt = useRef<number>(Date.now());
  const attempt = useRef(0);

  const applyStatus = useCallback((status: OrderStatus): boolean => {
    // Returns true when a TERMINAL status was reached (stop polling).
    if (status === 'PAID') {
      setPhase('paid');
      return true;
    }
    if (status === 'FAILED' || status === 'EXPIRED') {
      setPhase('failed');
      return true;
    }
    return false; // CREATED — keep waiting
  }, []);

  const scheduleNext = useCallback(() => {
    const elapsed = Date.now() - startedAt.current;
    if (elapsed >= timeoutMs) {
      setPhase('timeout');
      return;
    }
    const delay = pollSchedule[Math.min(attempt.current, pollSchedule.length - 1)]!;
    attempt.current += 1;
    timer.current = setTimeout(runPoll, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollSchedule, timeoutMs]);

  const runPoll = useCallback(async () => {
    if (cancelled.current) return;
    try {
      const order = await getOrder(orderId);
      if (cancelled.current) return;
      const terminal = applyStatus(order.status);
      if (!terminal) scheduleNext();
    } catch {
      // A transient poll error is not a payment failure — keep polling within
      // the budget; the timeout state is the honest resolution if it persists.
      if (!cancelled.current) scheduleNext();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, applyStatus, scheduleNext]);

  useEffect(() => {
    cancelled.current = false;
    startedAt.current = Date.now();
    attempt.current = 0;
    runPoll();
    return () => {
      cancelled.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // Manual "refresh status" from the timeout state — one poll; if still CREATED
  // it stays honest (remains in timeout), it never fabricates success.
  const [refreshing, setRefreshing] = useState(false);
  const manualRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const order = await getOrder(orderId);
      applyStatus(order.status); // PAID → success; else stays timeout
    } catch {
      // keep timeout state
    } finally {
      setRefreshing(false);
    }
  }, [orderId, applyStatus]);

  return (
    <div
      aria-live="polite"
      className="flex flex-col items-center gap-4 rounded-lg border border-neutral-200 bg-white p-8 text-center"
    >
      {phase === 'confirming' && (
        <>
          <Spinner size={32} label={t('confirmingTitle')} />
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">{t('confirmingTitle')}</h2>
            <p className="text-sm text-neutral-600 mt-1 max-w-sm">{t('confirmingBody')}</p>
          </div>
        </>
      )}

      {phase === 'paid' && (
        <>
          <CheckCircle2 className="size-12 text-success-fg" aria-hidden="true" />
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">{t('successTitle')}</h2>
            <p className="text-sm text-neutral-600 mt-1 max-w-sm">{t('successBody')}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <Button variant="primary" size="md" onClick={onPostJob}>
              {t('successPostJob')}
            </Button>
            <Button variant="outline" size="md" onClick={onDone}>
              {t('successBackToDashboard')}
            </Button>
          </div>
        </>
      )}

      {phase === 'failed' && (
        <>
          <XCircle className="size-12 text-error-fg" aria-hidden="true" />
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">{t('failedTitle')}</h2>
            <p className="text-sm text-neutral-600 mt-1 max-w-sm">{t('failedBody')}</p>
          </div>
          <Button variant="primary" size="md" onClick={onRetry}>
            {t('failedRetry')}
          </Button>
        </>
      )}

      {phase === 'timeout' && (
        <>
          <Clock className="size-12 text-warning-fg" aria-hidden="true" />
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">{t('timeoutTitle')}</h2>
            <p className="text-sm text-neutral-600 mt-1 max-w-sm">{t('timeoutBody')}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button variant="primary" size="md" onClick={manualRefresh} loading={refreshing}>
              {t('timeoutRefresh')}
            </Button>
            <Button variant="outline" size="md" onClick={onDone}>
              {t('successBackToDashboard')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
