import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import {
  CreateOrderInput,
  GatewayOrderRef,
  PaymentGatewayPort,
  VerifiedGatewayEvent,
} from './payment-gateway.interface';

/**
 * Stripe adapter — the hosted Checkout-Session redirect flow.
 *
 * Stripe is the HEDGE for FOREIGN companies: `STRIPE_SECRET_KEY` is OPTIONAL
 * at boot (the API runs Razorpay-only without it), but REQUIRED at routing —
 * RoutingService checks `isConfigured` and only routes here when the
 * `payments.stripe_enabled` setting is on AND the key exists. If a
 * misconfiguration ever slips past routing, `createOrder` throws the clear
 * config error below rather than a cryptic SDK failure.
 */
@Injectable()
export class StripeAdapter implements PaymentGatewayPort {
  private readonly logger = new Logger(StripeAdapter.name);
  private readonly client: Stripe | null;
  private readonly webAppUrl: string;
  private readonly webhookSecret: string;

  constructor(config: ConfigService) {
    const key = config.get<string>('STRIPE_SECRET_KEY');
    // Constructed ONLY when the optional key exists — never a dummy client.
    this.client = key ? new Stripe(key) : null;
    this.webAppUrl = config.get<string>('WEB_APP_URL') ?? '';
    this.webhookSecret = config.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  async createOrder(input: CreateOrderInput): Promise<GatewayOrderRef> {
    if (!this.client) {
      // Routing prevents reaching this; the error exists for the misconfigured middle.
      throw new Error(
        'Stripe is not configured (STRIPE_SECRET_KEY missing). ' +
          'Routing must not select STRIPE while isConfigured is false.',
      );
    }

    // Hosted Checkout: one payment-mode line item derived from the plan.
    // unit_amount is INTEGER SUBUNITS — exactly what Stripe expects (cents/paise).
    // metadata.orderId ties the session back to our row for B2's webhook.
    // The success/cancel pages are S5-F1's; the paths are stable route stubs —
    // activation NEVER happens on the success redirect (webhook-only), the
    // success page just starts polling GET /billing/orders/{id}.
    const session = await this.client.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: input.totalSubunits,
            product_data: { name: input.planName },
          },
          quantity: 1,
        },
      ],
      metadata: { orderId: input.orderId },
      success_url: `${this.webAppUrl}/en/employer/billing/return?orderId=${input.orderId}`,
      cancel_url: `${this.webAppUrl}/en/employer/billing?cancelled=1`,
    });

    if (!session.url) {
      throw new Error(`Stripe checkout session ${session.id} returned no redirect URL.`);
    }
    // No PII in logs: gateway/DB ids only.
    this.logger.log(`Stripe session created (orderId=${input.orderId}, sessionId=${session.id})`);
    return { gatewayOrderId: session.id, redirectUrl: session.url };
  }

  // ── S5-B2: webhooks ──────────────────────────────────────────────────────────

  /**
   * `stripe.webhooks.constructEvent(rawBody, sig, secret)` — Stripe's SDK does
   * the timestamped HMAC verification (its own constant-time compare) against
   * the RAW bytes. Returns false on a bad signature; throws ONLY on the
   * misconfigured middle: events arriving while STRIPE_WEBHOOK_SECRET is
   * unset (the secret is optional-at-boot, PAIRED with the key at use time).
   */
  verifyWebhook(rawBody: Buffer, signature: string): boolean {
    if (!this.client) {
      throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing).');
    }
    if (!this.webhookSecret) {
      throw new Error(
        'Stripe webhook secret is not configured (STRIPE_WEBHOOK_SECRET). ' +
          'It must be set alongside STRIPE_SECRET_KEY before enabling Stripe webhooks.',
      );
    }
    if (!signature) return false;
    try {
      this.client.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
      return true;
    } catch {
      return false;
    }
  }

  /** Parse a VERIFIED body. Stripe's unique event id is `event.id` (evt_…). */
  parseEvent(rawBody: Buffer): VerifiedGatewayEvent {
    const event = JSON.parse(rawBody.toString('utf8')) as { id?: string; type?: string };
    return {
      eventId: event.id ?? 'unknown',
      type: event.type ?? 'unknown',
      payload: event,
    };
  }
}
