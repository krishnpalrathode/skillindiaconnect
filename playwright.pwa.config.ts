import { defineConfig, devices } from '@playwright/test';

/**
 * PWA / service-worker suite — deliberately its own config.
 *
 * It cannot live in the main UI suite (playwright.config.ts) because that one
 * forces MSW ON via `webServer.env`, and MSW registers its own service worker at
 * scope '/'. Our worker refuses to register when mocking is enabled, precisely
 * so the two never fight — which would make every assertion here vacuous.
 *
 * So: no `webServer`, MSW off, and it runs against a REAL stack (a local
 * `pnpm dev`, or a deployment via PWA_BASE_URL). Service-worker behaviour is
 * only meaningful against real responses anyway — the whole point is proving
 * that authenticated API traffic never reaches the cache.
 *
 *   pnpm dev                       # in another terminal
 *   pnpm exec playwright test -c playwright.pwa.config.ts
 */
export default defineConfig({
  testDir: './tests/pwa',
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env['PWA_BASE_URL'] ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  // Chromium only: service workers and beforeinstallprompt are Chrome features,
  // and the Play Store target is Android Chrome.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
