import { Module } from '@nestjs/common';
import { EmployerModule } from '../employer/employer.module';
import { SettingsModule } from '../settings/settings.module';
import { GatewaysModule } from './gateways/gateways.module';
import { RoutingService } from './routing.service';
import { CheckoutService } from './checkout.service';
import { BillingController } from './billing.controller';

/**
 * Payments (S5-B1): plans/subscription reads, checkout with server-side
 * gateway routing, the order poll target.
 *
 * Boundaries (module-boundaries.md): this module reads/writes ONLY its own
 * tables (plans, orders, subscriptions, invoices via relations) and reaches
 * other domains through their PUBLIC services — EmployerService for the
 * company/approval, SettingsService for GST/Stripe flags. Prisma/Redis/Audit
 * come from the @Global core.
 *
 * S5-B2 adds the webhook controllers + activation processor to this module
 * (worker side); the gateway port already types verify/parse for it.
 */
@Module({
  imports: [EmployerModule, SettingsModule, GatewaysModule],
  controllers: [BillingController],
  providers: [RoutingService, CheckoutService],
  // Exported for S5-B3 (quota rewiring reads the subscription through this
  // module's public service, never the tables directly — Rule 4).
  exports: [CheckoutService],
})
export class PaymentsModule {}
