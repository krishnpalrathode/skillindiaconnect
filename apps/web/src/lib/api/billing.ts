import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch } from '@/lib/api/client';

type Plan = components['schemas']['Plan'];
type CheckoutSession = components['schemas']['CheckoutSession'];
type Order = components['schemas']['Order'];
type PlanCode = components['schemas']['PlanCode'];
type SubscriptionStatus = components['schemas']['SubscriptionStatus'];

/** GET /billing/plans — the seeded three plans (FREE / PRO_MONTHLY / PRO_YEARLY). */
export function getPlans(): Promise<Plan[]> {
  return apiFetch<Plan[]>('/billing/plans');
}

/**
 * GET /billing/subscription — the current plan (never 404; no record = FREE).
 * Read here only for the "Current plan" indicator; full subscription MANAGEMENT
 * is S5-F2.
 */
export function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  return apiFetch<SubscriptionStatus>('/billing/subscription');
}

/**
 * POST /billing/checkout — starts a purchase.
 *
 * The body carries `{ planCode }` and NOTHING else — the gateway is chosen
 * SERVER-SIDE from the company; the client never sends or picks one. An
 * `Idempotency-Key` (one UUID per checkout INTENT) makes a double-tap replay
 * the original order rather than creating a second one; pass a fresh key per
 * attempt so a genuine retry after failure starts clean.
 */
export function createCheckout(
  planCode: PlanCode,
  idempotencyKey: string,
): Promise<CheckoutSession> {
  return apiFetch<CheckoutSession>('/billing/checkout', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ planCode }),
  });
}

/**
 * GET /billing/orders/{id} — THE poll target after the gateway flow.
 *
 * Side-effect-free: polling never flips an order. Only the signature-verified
 * webhook moves CREATED → PAID/FAILED, so the caller must poll this until the
 * status settles (or surface the honest "still confirming" timeout).
 */
export function getOrder(orderId: string): Promise<Order> {
  return apiFetch<Order>(`/billing/orders/${orderId}`);
}
