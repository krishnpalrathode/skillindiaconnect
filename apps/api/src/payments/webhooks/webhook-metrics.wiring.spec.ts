/**
 * C3 (Razorpay live cutover) — the go-live monitoring wiring.
 *
 * The cutover's failure-alerts read `sic_webhook_events_total` and
 * `sic_payment_activations_total`. Those counters existed in the registry
 * since S8-H3 but had NO call sites, so the alerts could never fire — a
 * payment that silently failed to activate would page no one. This test locks
 * the wiring in against a REAL MetricsService (no Docker), by asserting the
 * counters actually appear in the Prometheus exposition after the money-path
 * code runs. It is pure wiring — the payment LOGIC is unchanged and lives in
 * webhooks.matrix.spec.ts.
 */
import { UnauthorizedException } from '@nestjs/common';
import { MetricsService } from '../../core/observability/metrics.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { PaymentGatewayPort } from '../gateways/payment-gateway.interface';
import { PaymentEventsHandler } from './handlers/payment-events.handler';
import { WebhookService } from './webhook.service';

function buildWebhookService(overrides: {
  verify: boolean;
  handlerOutcome?: string;
  handlerThrows?: boolean;
}) {
  const metrics = new MetricsService();
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const razorpay = {
    verifyWebhook: () => overrides.verify,
    parseEvent: () => ({ eventId: 'evt-1', type: 'payment.captured', payload: { event: 'x' } }),
  } as unknown as PaymentGatewayPort;
  const stripe = {} as unknown as PaymentGatewayPort;
  const handler = {
    handle: overrides.handlerThrows
      ? jest.fn().mockRejectedValue(new Error('boom'))
      : jest.fn().mockResolvedValue(overrides.handlerOutcome ?? 'activated'),
  } as unknown as PaymentEventsHandler;
  const prisma = {
    webhookEvent: {
      create: jest.fn().mockResolvedValue({ id: 'row-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;
  const service = new WebhookService(prisma, handler, audit, razorpay, stripe, metrics);
  return { service, metrics };
}

describe('C3 — webhook metric wiring (real MetricsService, no Docker)', () => {
  it('a REJECTED webhook increments sic_webhook_events_total{outcome="rejected"}', async () => {
    const { service, metrics } = buildWebhookService({ verify: false });
    await expect(service.process('razorpay', Buffer.from('{}'), {})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const text = metrics.render();
    expect(text).toContain('sic_webhook_events_total');
    expect(text).toMatch(/sic_webhook_events_total\{[^}]*outcome="rejected"[^}]*\}\s+1/);
    // The latency histogram was recorded too (the "webhook lag" alert's source).
    expect(text).toContain('sic_webhook_processing_ms');
  });

  it('a PROCESSED webhook records the handler outcome as the metric label', async () => {
    const { service, metrics } = buildWebhookService({ verify: true, handlerOutcome: 'activated' });
    await service.process('razorpay', Buffer.from('{}'), {});
    expect(metrics.render()).toMatch(
      /sic_webhook_events_total\{[^}]*outcome="activated"[^}]*\}\s+1/,
    );
  });

  it('a handler THROW records outcome="error" (so a 5xx retry storm is visible)', async () => {
    const { service, metrics } = buildWebhookService({ verify: true, handlerThrows: true });
    await expect(service.process('razorpay', Buffer.from('{}'), {})).rejects.toThrow('boom');
    expect(metrics.render()).toMatch(/sic_webhook_events_total\{[^}]*outcome="error"[^}]*\}\s+1/);
  });
});
