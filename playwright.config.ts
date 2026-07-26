import { defineConfig, devices } from '@playwright/test';

/**
 * UI-REGRESSION suite (Category A) — Playwright driving the web app against
 * MSW mock handlers. This is the fast, deterministic, infra-free layer that
 * runs on every PR; it proves UI behaviour given known API responses, NOT that
 * the real backend produces them (that is the API-integration layer, and — post
 * client handoff — a small real-stack e2e config). See
 * docs/testing-architecture.md.
 *
 * MSW is forced ON via `webServer.env` below, so the suite is deterministic in
 * CI and locally WITHOUT the old `.env.local` flip-and-restore ritual.
 */
export default defineConfig({
  testDir: './tests/ui',
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
    // Playwright OWNS the web server for this suite (never reuse an existing
    // one). Reuse is unsafe here: a dev server started outside this config —
    // e.g. `pnpm dev` with .env.local mocking DISABLED — would be silently
    // reused and MSW would be off, which is exactly the non-determinism this
    // suite must not have. Fresh server every run → `env` below always applies.
    reuseExistingServer: false,
    timeout: 120_000,
    // Force MSW on for the spawned dev server. An environment variable wins
    // over apps/web/.env.local, so this is authoritative regardless of local
    // config — the whole reason the suite is deterministic here.
    env: { NEXT_PUBLIC_API_MOCKING: 'enabled' },
  },
});
