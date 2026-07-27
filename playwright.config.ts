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
    // CI vs local, deliberately different:
    //   CI    → BUILD once with MSW baked in, then serve via `next start`.
    //   local → `next dev` for fast iteration.
    // Why the CI split: a cold `next dev` on a 2-vCPU runner compiles each route
    // on first hit AND the root layout's two `next/font/google` families fetch
    // from fonts.googleapis.com at request time — together that blows past the
    // 30s navigation timeout and every `page.goto` fails (observed in CI run
    // 30216780076). `next build` fetches+self-hosts the fonts at build time and
    // pre-compiles all routes, so `next start` serves instantly and
    // deterministically. Building with NEXT_PUBLIC_API_MOCKING=enabled (via
    // `env` below) bakes MSW into the bundle — this build is a TEST artifact,
    // never deployed, so the "no MSW in production" rule is not violated.
    command: process.env['CI']
      ? 'pnpm --filter @skillindiaconnect/web build && pnpm --filter @skillindiaconnect/web start'
      : 'pnpm --filter @skillindiaconnect/web dev',
    url: 'http://localhost:3000',
    // Playwright OWNS the web server (never reuse an existing one): a server
    // started outside this config — e.g. `pnpm dev` with .env.local mocking
    // DISABLED — would be silently reused and MSW off. Fresh server every run →
    // `env` below always applies.
    reuseExistingServer: false,
    // The CI build (Next production build on a 2-vCPU runner) runs inside this
    // command — give it generous room; a high ceiling costs nothing when the
    // server comes up sooner.
    timeout: process.env['CI'] ? 420_000 : 120_000,
    // Force MSW on. An environment variable wins over apps/web/.env.local, and
    // — in CI — is inlined by `next build` into the client bundle so MockSetup
    // starts the worker, and read by instrumentation.ts so the Node-side MSW
    // server intercepts SSR fetches too.
    env: { NEXT_PUBLIC_API_MOCKING: 'enabled' },
  },
});
