import { defineConfig, devices } from '@playwright/test';

/**
 * S8-H4 audit runner. Separate from the e2e config so the audit can be run on
 * its own and so its two projects mean "desktop" vs "the phone the users
 * actually have" rather than e2e's feature matrix.
 *
 * `reuseExistingServer` — the audit is normally driven against an already
 * running dev server with MSW enabled.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:3000', trace: 'off', screenshot: 'off' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // The constrained Android profile — the device class these users carry.
    { name: 'android-constrained', use: { ...devices['Pixel 5'] } },
  ],
});
