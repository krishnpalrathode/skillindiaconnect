/**
 * The PaymentGateway seam — ONE port, two adapters (Razorpay, Stripe).
 *
 * PCI scope note: NO card data ever touches this codebase. Both gateways use
 * gateway-hosted payment UIs (Razorpay Checkout.js / Stripe Checkout) — we
 * create an order/session server-side and hand the browser a launch payload;
 * card entry happens entirely on the gateway's origin.
 *
 * `createOrder` is the ONE sanctioned synchronous external call in the API
 * process (worker-and-external-sends rule): the user is sitting at checkout
 * waiting for the gateway handle. Everything after payment (webhooks,
 * activation, invoices) is S5-B2 worker territory.
 */

export const RAZORPAY_GATEWAY = 'RAZORPAY_GATEWAY';
export const STRIPE_GATEWAY = 'STRIPE_GATEWAY';

export interface CreateOrderInput {
  /** Our order row id — sent as the gateway receipt/metadata for reconciliation. */
  orderId: string;
  /** What the gateway charges (amount + gst), integer subunits. */
  totalSubunits: number;
  /** ISO-4217 code, e.g. INR. */
  currency: string;
  /** Human plan name for gateway-hosted line items ("Pro Monthly"). */
  planName: string;
}

/**
 * What an adapter hands back after creating the gateway-side order/session.
 * The checkout service maps this into the frozen CheckoutSession's single
 * gateway block (razorpay `{ keyId, gatewayOrderId }` / stripe `{ redirectUrl }`).
 */
export interface GatewayOrderRef {
  /** Razorpay order id (`order_…`) or Stripe checkout-session id (`cs_…`). */
  gatewayOrderId: string;
  /** Razorpay only: the publishable key id Checkout.js is opened with. */
  keyId?: string;
  /** Stripe only: the hosted-checkout URL the browser is redirected to. */
  redirectUrl?: string;
}

/**
 * S5-B2 shapes — typed NOW so B2 is additive, not a refactor. A normalized,
 * signature-verified gateway event.
 */
export interface VerifiedGatewayEvent {
  /** Provider-scoped event id — the `(provider, eventId)` dedupe key. */
  eventId: string;
  /** Provider event type (e.g. `payment.captured`, `checkout.session.completed`). */
  type: string;
  /** The parsed event payload (opaque here; B2's processor interprets it). */
  payload: unknown;
}

export interface PaymentGatewayPort {
  /**
   * False when the gateway's credentials are absent (Stripe's key is
   * OPTIONAL at boot — the hedge). RoutingService consults this so an
   * unconfigured gateway is never routed to.
   */
  readonly isConfigured: boolean;

  /** Create the gateway-side order/session for an existing CREATED order row. */
  createOrder(input: CreateOrderInput): Promise<GatewayOrderRef>;

  /**
   * S5-B2: verify the webhook signature against the RAW body BEFORE any
   * parsing (verify-before-parse). Returns false on a bad/missing signature;
   * throws ONLY on adapter misconfiguration (missing secret). `JSON.parse`
   * must never run before this returns true.
   */
  verifyWebhook(rawBody: Buffer, signature: string): boolean;

  /**
   * S5-B2: parse a VERIFIED raw body into a normalized event. `headers` is an
   * optional hint source — Razorpay's canonical event id travels in the
   * `x-razorpay-event-id` HEADER, not the body (Stripe's is `event.id`).
   */
  parseEvent(
    rawBody: Buffer,
    headers?: Record<string, string | string[] | undefined>,
  ): VerifiedGatewayEvent;
}
