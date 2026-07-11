import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Razorpay from 'razorpay';
import {
  CreateOrderInput,
  GatewayOrderRef,
  PaymentGatewayPort,
  VerifiedGatewayEvent,
} from './payment-gateway.interface';

/**
 * Razorpay adapter — ONE adapter for both DOMESTIC and INTERNATIONAL modes.
 *
 * Domestic vs international is an ACCOUNT-LEVEL enablement on the Razorpay
 * side (dashboard setting + KYC/International-payments approval), NOT an API
 * parameter — the same `orders.create` call serves both. There is no code
 * switch to hunt for here; enabling international cards for FOREIGN companies
 * is a Razorpay-dashboard action item, tracked outside this codebase.
 *
 * Keys are REQUIRED env (`RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`) — Razorpay
 * is the locked primary gateway, so the API does not boot without them.
 */
@Injectable()
export class RazorpayAdapter implements PaymentGatewayPort {
  private readonly logger = new Logger(RazorpayAdapter.name);
  // Constructed ONLY when the key exists — the SDK refuses empty credentials
  // at construction time (mirrors StripeAdapter's optional-at-boot pattern;
  // for Razorpay the env is required, so a null client only occurs in tests
  // or a broken deploy — routing checks isConfigured before selecting us).
  private readonly client: Razorpay | null;
  /** Publishable key id — safe to expose; Checkout.js is opened with it. */
  readonly keyId: string;

  constructor(config: ConfigService) {
    this.keyId = config.get<string>('RAZORPAY_KEY_ID') ?? '';
    this.client = this.keyId
      ? new Razorpay({
          key_id: this.keyId,
          key_secret: config.get<string>('RAZORPAY_KEY_SECRET') ?? '',
        })
      : null;
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  async createOrder(input: CreateOrderInput): Promise<GatewayOrderRef> {
    if (!this.client) {
      // Routing prevents reaching this; the error exists for the misconfigured middle.
      throw new Error(
        'Razorpay is not configured (RAZORPAY_KEY_ID missing). ' +
          'Routing must not select RAZORPAY while isConfigured is false.',
      );
    }
    // amount is INTEGER SUBUNITS — exactly what Razorpay expects (paise).
    // receipt + notes.orderId tie the gateway order back to our row for
    // B2's webhook reconciliation.
    const order = await this.client.orders.create({
      amount: input.totalSubunits,
      currency: input.currency,
      receipt: input.orderId,
      notes: { orderId: input.orderId },
    });
    // No PII in logs: gateway/DB ids only.
    this.logger.log(`Razorpay order created (orderId=${input.orderId}, gatewayOrderId=${order.id})`);
    return { gatewayOrderId: order.id, keyId: this.keyId };
  }

  // ── S5-B2 (webhooks) — typed now, wired by B2 ────────────────────────────────

  verifyWebhook(_rawBody: Buffer, _signature: string): boolean {
    throw new Error('RazorpayAdapter.verifyWebhook is implemented in S5-B2.');
  }

  parseEvent(_rawBody: Buffer): VerifiedGatewayEvent {
    throw new Error('RazorpayAdapter.parseEvent is implemented in S5-B2.');
  }
}
