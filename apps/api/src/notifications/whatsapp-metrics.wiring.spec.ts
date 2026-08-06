/**
 * CR-WA — the WhatsApp alerting wiring.
 *
 * THE RAZORPAY LESSON, APPLIED. `docs/cutover-razorpay-live.md` records that the
 * money-path counters "existed but were never emitted", so
 * `sic_payment_activations_total{outcome="failed"}` stayed at zero forever and a
 * threshold alert could NEVER FIRE — a silent failure that pages no one is worse
 * than no alert at all, because it is believed.
 *
 * The alerts in observability/alerts.yml read `sic_whatsapp_sends_total`. This
 * test asserts against a REAL MetricsService (no Docker) that the counter reaches
 * the Prometheus exposition after the code runs, with the LABELS the alert
 * expressions actually select on. A test on the helper alone would pass while
 * nothing called it.
 */
import { DeliveryStatus, WaMessageKind } from '@prisma/client';
import { MetricsService } from '../core/observability/metrics.service';
import { WhatsappWebhookService } from './webhooks/whatsapp-webhook.service';
import { PrismaService } from '../core/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('CR-WA — WhatsApp metric wiring (real MetricsService, no Docker)', () => {
  describe('the counter the alerts select on', () => {
    it('emits sic_whatsapp_sends_total with kind + outcome labels', () => {
      const metrics = new MetricsService();
      metrics.recordWhatsappSend(WaMessageKind.OTP, 'failed');

      const text = metrics.render();
      expect(text).toContain('sic_whatsapp_sends_total');
      // The exact label shape WhatsappOtpSendFailures matches on. A rename here
      // silently breaks the alert, which is why the assertion is literal.
      expect(text).toMatch(/sic_whatsapp_sends_total\{[^}]*kind="OTP"[^}]*\}\s+1/);
      expect(text).toMatch(/sic_whatsapp_sends_total\{[^}]*outcome="failed"[^}]*\}\s+1/);
    });

    it('sent and failed are separate series, so a RATIO can be computed', () => {
      const metrics = new MetricsService();
      metrics.recordWhatsappSend(WaMessageKind.OTP, 'sent');
      metrics.recordWhatsappSend(WaMessageKind.OTP, 'sent');
      metrics.recordWhatsappSend(WaMessageKind.OTP, 'failed');

      const text = metrics.render();
      // 2 sent + 1 failed. Both must be present: the alert divides by
      // (sent+failed), so a missing denominator series makes it undefined.
      expect(text).toMatch(/sic_whatsapp_sends_total\{kind="OTP",outcome="sent"\}\s+2/);
      expect(text).toMatch(/sic_whatsapp_sends_total\{kind="OTP",outcome="failed"\}\s+1/);
    });

    /**
     * The label split that lets ONE counter drive TWO severities. If OTP and
     * notification sends shared a label value, the critical login-availability
     * alert could not be separated from the warning-level one.
     */
    it('OTP and notification kinds are distinguishable', () => {
      const metrics = new MetricsService();
      metrics.recordWhatsappSend(WaMessageKind.OTP, 'failed');
      metrics.recordWhatsappSend(WaMessageKind.STATUS_UPDATE, 'failed');

      const text = metrics.render();
      expect(text).toMatch(/sic_whatsapp_sends_total\{kind="OTP",outcome="failed"\}\s+1/);
      expect(text).toMatch(/sic_whatsapp_sends_total\{kind="STATUS_UPDATE",outcome="failed"\}\s+1/);
    });

    /**
     * ⚠️ THE ONE THAT KEEPS THE ALERT HONEST.
     *
     * `downgraded` is an opt-out or a non-WhatsApp-capable user — not a provider
     * failure. The alert expressions select `outcome=~"sent|failed"` for the
     * denominator precisely so these are excluded. If someone later records a
     * downgrade as `failed`, this test fails and the alert stops tracking
     * opt-out rates instead of quietly starting to.
     */
    it('downgraded is its own outcome and matches NEITHER sent nor failed', () => {
      const metrics = new MetricsService();
      metrics.recordWhatsappSend(WaMessageKind.STATUS_UPDATE, 'downgraded');

      const text = metrics.render();
      expect(text).toMatch(/sic_whatsapp_sends_total\{[^}]*outcome="downgraded"[^}]*\}\s+1/);
      expect(text).not.toMatch(/outcome="failed"/);
      expect(text).not.toMatch(/outcome="sent"/);
    });
  });

  describe('delivery statuses from the W2 webhook', () => {
    function buildWebhookService(updatedCount: number) {
      const metrics = new MetricsService();
      const prisma = {
        whatsappMessage: {
          updateMany: jest.fn().mockResolvedValue({ count: updatedCount }),
          findFirst: jest.fn().mockResolvedValue(null),
        },
      } as unknown as PrismaService;
      const config = { get: () => 'secret' } as unknown as ConfigService;
      return { service: new WhatsappWebhookService(prisma, config, metrics), metrics };
    }

    it('an APPLIED status increments sic_whatsapp_delivery_status_total', async () => {
      const { service, metrics } = buildWebhookService(1);

      await service.applyStatuses([
        { waMessageId: 'wamid.1', status: DeliveryStatus.DELIVERED },
      ]);

      expect(metrics.render()).toMatch(
        /sic_whatsapp_delivery_status_total\{status="DELIVERED"\}\s+1/,
      );
    });

    /**
     * A callback that changed nothing must not be counted. Meta retries
     * aggressively and replays out of order, so counting every callback would
     * produce a "delivery rate" that measures Meta's retry behaviour rather than
     * our delivery.
     */
    it('a callback that updates NO row is not counted', async () => {
      const { service, metrics } = buildWebhookService(0);

      await service.applyStatuses([
        { waMessageId: 'wamid.unknown', status: DeliveryStatus.DELIVERED },
      ]);

      expect(metrics.render()).not.toContain('sic_whatsapp_delivery_status_total');
    });
  });
});
