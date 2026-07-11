import { Module } from '@nestjs/common';
import { RAZORPAY_GATEWAY, STRIPE_GATEWAY } from './payment-gateway.interface';
import { RazorpayAdapter } from './razorpay.adapter';
import { StripeAdapter } from './stripe.adapter';

/**
 * Gateway provider wiring — one DI token per gateway, both bound to real
 * SDK adapters (test-mode keys in dev). Consumers (RoutingService,
 * CheckoutService, B2's webhook processors) inject the TOKENS and speak
 * `PaymentGatewayPort` — swapping or mocking a gateway is a provider change,
 * never a service change.
 */
@Module({
  providers: [
    RazorpayAdapter,
    StripeAdapter,
    { provide: RAZORPAY_GATEWAY, useExisting: RazorpayAdapter },
    { provide: STRIPE_GATEWAY, useExisting: StripeAdapter },
  ],
  exports: [RAZORPAY_GATEWAY, STRIPE_GATEWAY],
})
export class GatewaysModule {}
