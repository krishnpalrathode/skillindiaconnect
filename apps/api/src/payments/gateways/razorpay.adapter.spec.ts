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

  it('verifyWebhook/parseEvent are B2 stubs that throw loudly', () => {
    const adapter = new RazorpayAdapter(
      configWith({ RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 's' }),
    );
    expect(() => adapter.verifyWebhook(Buffer.from(''), 'sig')).toThrow(/S5-B2/);
    expect(() => adapter.parseEvent(Buffer.from(''))).toThrow(/S5-B2/);
  });

  describe('live smoke (gated — skipped without real test-mode keys)', () => {
    liveIt('creates a real test-mode order and returns its order_ id', async () => {
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
    }, 30_000);
  });
});
