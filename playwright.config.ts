import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,

  /**
   * CI concurrency.
   *
   * Was `1`, which serialised 170 tests × 2 projects = 340 runs onto a single
   * worker. `50%` lets Playwright size itself to the runner it actually gets
   * (GitHub's hosted Linux runners are 2 vCPU on private repos, 4 on public),
   * which is Playwright's own default heuristic — one browser per two cores,
   * leaving headroom for the Next server and the API that share this box.
   *
   * A hard number is deliberately avoided: over-subscribing a 2-vCPU runner
   * makes the suite SLOWER (browsers thrash) and turns timing-sensitive tests
   * into flakes, which then cost 3× each through `retries: 2`.
   *
   * The bigger lever is SHARDING across jobs — see the `shard` matrix in
   * .github/workflows/ci.yml, where each shard gets its own runner AND its own
   * Postgres/Redis, so shards cannot interfere with each other.
   */
  workers: process.env['CI'] ? '50%' : undefined,

  // `blob` in CI so sharded runs can be merged into one report; html locally.
  reporter: process.env['CI'] ? 'blob' : 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'android-constrained',
      // Pixel-class mobile device: smaller viewport, mobile UA
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    command: 'pnpm --filter @skillindiaconnect/web dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
