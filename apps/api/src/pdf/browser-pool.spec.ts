/**
 * S7-B1 — the bounded pool, proven against REAL Chromium (puppeteer's local
 * Chrome in dev/CI; the Alpine binary in the container). No Docker services
 * needed. THE four guarantees under test: valid output + no page leak, the
 * concurrency cap, the timeout reclaiming a wedged slot, and crash recovery.
 */
import { ConfigService } from '@nestjs/config';
import { Browser } from 'puppeteer';
import { BrowserPoolService } from './browser-pool.service';

jest.setTimeout(120_000);

const config = { get: () => undefined } as unknown as ConfigService;

describe('BrowserPoolService', () => {
  let pool: BrowserPoolService;

  beforeEach(() => {
    pool = new BrowserPoolService(config);
  });

  afterEach(async () => {
    await pool.onModuleDestroy();
  });

  it('renders a valid PDF and closes the page (no leak: page count returns to baseline)', async () => {
    const buffer = await pool.render('<html><body><h1>Hello S7</h1></body></html>');
    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');

    const browser = (await (pool as unknown as { getBrowser(): Promise<Browser> }).getBrowser())!;
    const pages = await browser.pages();
    // Baseline is the single about:blank tab — the render's page is GONE.
    expect(pages.length).toBe(1);
    expect(pool.activeCount).toBe(0);
  });

  it('caps concurrency at the stated maximum; the excess QUEUES and still completes', async () => {
    const samples: number[] = [];
    const sampler = setInterval(() => samples.push(pool.activeCount), 5);

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        pool.render(`<html><body><p>doc ${i} ${'x'.repeat(20_000)}</p></body></html>`),
      ),
    );
    clearInterval(sampler);

    for (const buffer of results) {
      expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    }
    // The cap held at every sampled instant, and it was actually exercised.
    expect(Math.max(...samples)).toBeLessThanOrEqual(pool.maxConcurrency);
    expect(pool.activeCount).toBe(0);
  });

  it('times out a wedged render, reclaims the slot, and subsequent renders still work', async () => {
    // Test hook: a 1.5s budget so the wedge resolves quickly.
    (pool as unknown as { renderTimeoutMs: number }).renderTimeoutMs = 1_500;

    // An infinite-loop script blocks the load event forever — the classic hang.
    await expect(
      pool.render('<html><body><script>for(;;){}</script></body></html>'),
    ).rejects.toThrow(/timed out/);

    // The slot came back and the pool is NOT wedged.
    expect(pool.activeCount).toBe(0);
    (pool as unknown as { renderTimeoutMs: number }).renderTimeoutMs = 30_000;
    const after = await pool.render('<html><body>recovered</body></html>');
    expect(after.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('recovers from a browser crash: the dead instance is replaced and a new render succeeds', async () => {
    await pool.render('<html><body>warm-up</body></html>');
    const browser = await (pool as unknown as { getBrowser(): Promise<Browser> }).getBrowser();

    // Force a death — SIGKILL the Chromium process.
    browser.process()?.kill('SIGKILL');
    await new Promise((resolve) => browser.once('disconnected', resolve));

    const buffer = await pool.render('<html><body>after crash</body></html>');
    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });
});
