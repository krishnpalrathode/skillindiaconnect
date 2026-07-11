import { Module } from '@nestjs/common';
import { EmployerModule } from '../employer/employer.module';
import { SettingsModule } from '../settings/settings.module';
import { NotificationModule } from '../notifications/notification.module';
import { GatewaysModule } from './gateways/gateways.module';
import { RoutingService } from './routing.service';
import { CheckoutService } from './checkout.service';
import { BillingController } from './billing.controller';
import { InvoiceService } from './invoice.service';
import { ActivationService } from './activation.service';
import { PaymentEventsHandler } from './webhooks/handlers/payment-events.handler';
import { WebhookService } from './webhooks/webhook.service';
import { WebhookController } from './webhooks/webhook.controller';

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
 * S5-B2 adds the webhook layer: raw-body-verified controllers, the
 * (provider, eventId)-deduped pipeline, and the transactional activation that
 * is the ONLY place a CREATED order becomes PAID.
 */
@Module({
  imports: [EmployerModule, SettingsModule, NotificationModule, GatewaysModule],
  controllers: [BillingController, WebhookController],
  providers: [
    RoutingService,
    CheckoutService,
    InvoiceService,
    ActivationService,
    PaymentEventsHandler,
    WebhookService,
  ],
  // Exported for S5-B3 (quota rewiring reads the subscription through this
  // module's public service, never the tables directly — Rule 4).
  exports: [CheckoutService],
})
export class PaymentsModule {}
