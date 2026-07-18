import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { CompanyType, Gateway } from '@prisma/client';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../settings/settings.keys';
import {
  PaymentGatewayPort,
  RAZORPAY_GATEWAY,
  STRIPE_GATEWAY,
} from './gateways/payment-gateway.interface';

/**
 * Razorpay serves both markets from one adapter; the mode is informational
 * (audit/order context) — domestic vs international is Razorpay ACCOUNT-level
 * enablement, not an API switch (see RazorpayAdapter).
 */
export type RazorpayMode = 'DOMESTIC' | 'INTERNATIONAL';

export interface GatewayDecision {
  gateway: Gateway;
  /** Present only for RAZORPAY. */
  mode?: RazorpayMode;
}

/**
 * The load-bearing gateway decision — SEALED SERVER-SIDE. The checkout request
 * carries `{ planCode }` only; a client can never name, hint, or force a
 * gateway (the DTO whitelist rejects any smuggled field).
 *
 * Routing rules (locked by the S5-0 contract):
 *  - LOCAL   → Razorpay DOMESTIC (INR + GST).
 *  - FOREIGN → Stripe IFF the `payments.stripe_enabled` setting is on AND the
 *              optional Stripe key is configured; otherwise Razorpay
 *              INTERNATIONAL (the locked primary — INR-denominated,
 *              international cards, account-level enablement).
 *  - Neither viable → 503 GATEWAY_UNAVAILABLE — the honest failure. Never
 *    silently fall back to a wrong gateway.
 */
@Injectable()
export class RoutingService {
  constructor(
    private readonly settings: SettingsService,
    @Inject(RAZORPAY_GATEWAY) private readonly razorpay: PaymentGatewayPort,
    @Inject(STRIPE_GATEWAY) private readonly stripe: PaymentGatewayPort,
  ) {}

  async resolveGateway(companyType: CompanyType): Promise<GatewayDecision> {
    if (companyType === CompanyType.LOCAL) {
      if (!this.razorpay.isConfigured) {
        throw new ServiceUnavailableException({ code: 'GATEWAY_UNAVAILABLE' });
      }
      return { gateway: Gateway.RAZORPAY, mode: 'DOMESTIC' };
    }

    // FOREIGN: Stripe only when the settings flag is on AND the key exists —
    // required-at-routing, optional-at-boot.
    const stripeEnabled = await this.settings.get(SETTING_KEYS.STRIPE_ENABLED);
    if (stripeEnabled && this.stripe.isConfigured) {
      return { gateway: Gateway.STRIPE };
    }

    if (this.razorpay.isConfigured) {
      return { gateway: Gateway.RAZORPAY, mode: 'INTERNATIONAL' };
    }

    // FOREIGN + stripe not viable + razorpay unavailable → the honest 503.
    throw new ServiceUnavailableException({ code: 'GATEWAY_UNAVAILABLE' });
  }
}
