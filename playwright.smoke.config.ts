import { defineConfig, devices } from '@playwright/test';

/**
 * POST-DEPLOY SMOKE — the tiny, read-only suite that runs against an ALREADY
 * DEPLOYED environment (Vercel/Railway), NOT a locally-started server. It
 * answers one question: "did the last deploy actually come up?" See
 * docs/testing-architecture.md (§5, the post-deploy stage).
 *
 * There is deliberately NO `webServer` here — the target is remote. Point it at
 * a deployment with the SMOKE_BASE_URL env var; the post-deploy-smoke workflow
 * supplies it from a repo Variable (or a workflow_dispatch input).
 */
const baseURL = process.env['SMOKE_BASE_URL'];

export default defineConfig({
  testDir: './tests/smoke',
  forbidOnly: !!process.env['CI'],
  // A flaky network to a live URL shouldn't page anyone on the first blip.
  retries: 1,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
});
