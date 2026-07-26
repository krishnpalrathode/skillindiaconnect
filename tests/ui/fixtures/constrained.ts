import { test as base, type Page } from '@playwright/test';

/**
 * Constrained-device throttling profile — encode ONCE here; all candidate-facing
 * specs import this fixture to opt in.
 *
 * Network: Slow 3G approximation
 *   downloadThroughput : 400 kb/s  → 51 200 bytes/s
 *   uploadThroughput   : 400 kb/s  → 51 200 bytes/s
 *   latency            : 400 ms RTT
 *
 * CPU: 4× slowdown relative to the host machine (mimics a low-end Android device).
 */

const SLOW_3G_CONDITIONS = {
  offline: false,
  downloadThroughput: Math.floor((400 * 1024) / 8), // 51 200 bytes/s
  uploadThroughput: Math.floor((400 * 1024) / 8), // 51 200 bytes/s
  latency: 400, // 400 ms additional RTT
};

const CPU_THROTTLE_RATE = 4; // 4× slowdown

export interface ConstrainedFixtures {
  constrainedPage: Page;
}

/**
 * `constrainedPage` — a `Page` with Slow-3G network + 4× CPU throttling applied
 * via CDP. Use it in specs that must meet the candidate-device perf budget.
 *
 * @example
 * import { test } from '../fixtures/constrained';
 * test('loads fast enough', async ({ constrainedPage }) => {
 *   await constrainedPage.goto('/');
 * });
 */
export const test = base.extend<ConstrainedFixtures>({
  constrainedPage: async ({ page }, use) => {
    const session = await page.context().newCDPSession(page);
    await session.send('Network.enable');
    await session.send('Network.emulateNetworkConditions', SLOW_3G_CONDITIONS);
    await session.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE_RATE });
    await use(page);
  },
});

export { expect } from '@playwright/test';
