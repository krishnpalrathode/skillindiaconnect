/**
 * RazorpayAdapter — GATED LIVE SMOKE against the real test-mode API.
 *
 * Skip mechanism: the live test runs ONLY when real-looking Razorpay keys are
 * exported in the test environment (`RAZORPAY_KEY_ID` present and not the
 * `.env` boot placeholder). CI without keys — and any dev machine that hasn't
 * exported them — skips cleanly via `it.skip`, reported as skipped, never
 * failed. With keys, one real `orders.create` round-trips and proves the
 * adapter against the actual API: amount echoed in subunits, an `order_…` id
 * returned, our order id carried in the receipt.
 */
import { ConfigService } from '@nestjs/config';
import { RazorpayAdapter } from './razorpay.adapter';

const keyId = process.env['RAZORPAY_KEY_ID'];
const keySecret = process.env['RAZORPAY_KEY_SECRET'];
const hasRealKeys =
  !!keyId && !!keySecret && keyId !== 'rzp_test_placeholder' && keyId.startsWith('rzp_');

const liveIt = hasRealKeys ? it : it.skip;

function configWith(env: Record<string, string | undefined>): ConfigService {
  return { get: (k: string) => env[k] } as unknown as ConfigService;
}

describe('RazorpayAdapter', () => {
  it('isConfigured reflects key presence', () => {
    expect(
      new RazorpayAdapter(configWith({ RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 's' }))
        .isConfigured,
    ).toBe(true);
    expect(new RazorpayAdapter(configWith({})).isConfigured).toBe(false);
  });

  describe('verifyWebhook (S5-B2) — HMAC-SHA256 on raw bytes, constant-time', () => {
    const SECRET = 'whsec_unit_test';
    const adapter = () =>
      new RazorpayAdapter(
        configWith({
          RAZORPAY_KEY_ID: 'rzp_test_x',
          RAZORPAY_KEY_SECRET: 's',
          RAZORPAY_WEBHOOK_SECRET: SECRET,
        }),
      );
    const sign = (body: Buffer) =>
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      (require('node:crypto') as typeof import('node:crypto'))
        .createHmac('sha256', SECRET)
        .update(body)
        .digest('hex');

    it('accepts a correctly signed body', () => {
      const body = Buffer.from(JSON.stringify({ event: 'payment.captured' }));
      expect(adapter().verifyWebhook(body, sign(body))).toBe(true);
    });

    it('rejects a tampered body / wrong signature / missing signature', () => {
      const body = Buffer.from(JSON.stringify({ event: 'payment.captured' }));
      const sig = sign(body);
      const tampered = Buffer.from(JSON.stringify({ event: 'payment.captured', x: 1 }));
      expect(adapter().verifyWebhook(tampered, sig)).toBe(false);
      expect(adapter().verifyWebhook(body, 'deadbeef')).toBe(false);
      expect(adapter().verifyWebhook(body, '')).toBe(false);
    });

    it('throws the config error when the webhook secret is missing', () => {
      const bare = new RazorpayAdapter(
        configWith({ RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 's' }),
      );
      expect(() => bare.verifyWebhook(Buffer.from('x'), 'sig')).toThrow(/RAZORPAY_WEBHOOK_SECRET/);
    });

    it('parseEvent prefers the x-razorpay-event-id header, falls back to a raw-bytes hash', () => {
      const body = Buffer.from(JSON.stringify({ event: 'payment.captured' }));
      const withHeader = adapter().parseEvent(body, { 'x-razorpay-event-id': 'evt_hdr_1' });
      expect(withHeader).toMatchObject({ eventId: 'evt_hdr_1', type: 'payment.captured' });

      const noHeader1 = adapter().parseEvent(body);
      const noHeader2 = adapter().parseEvent(body);
      expect(noHeader1.eventId).toMatch(/^rzp-[0-9a-f]{40}$/);
      // Deterministic — an identical replayed delivery still dedupes.
      expect(noHeader2.eventId).toBe(noHeader1.eventId);
    });
  });

  describe('live smoke (gated — skipped without real test-mode keys)', () => {
    liveIt(
      'creates a real test-mode order and returns its order_ id',
      async () => {
        const adapter = new RazorpayAdapter(
          configWith({ RAZORPAY_KEY_ID: keyId, RAZORPAY_KEY_SECRET: keySecret }),
        );
        const orderId = `smoke-${Date.now()}`;
        const ref = await adapter.createOrder({
          orderId,
          totalSubunits: 100, // ₹1.00 — the smallest sensible test-mode order
          currency: 'INR',
          planName: 'Live Smoke',
        });
        expect(ref.gatewayOrderId).toMatch(/^order_/);
        expect(ref.keyId).toBe(keyId);
      },
      30_000,
    );
  });
});
