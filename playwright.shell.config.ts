import { defineConfig, devices } from '@playwright/test';

/**
 * Mobile app-shell suite (M1) — its own config, against a REAL stack.
 *
 * ── Why not the main UI config ───────────────────────────────────────────────
 * Two problems in `playwright.config.ts`'s path make it unusable here today,
 * and BOTH pre-date this unit (verified by running the existing `auth.spec.ts`
 * on a clean tree, where it fails identically):
 *
 *  1. Under Playwright 1.61 on Node 22.17, ANY local TypeScript import fails to
 *     load with `context.conditions?.includes is not a function`. A two-line
 *     helper reproduces it. Most specs in `tests/ui` import a fixture, so they
 *     do not collect at all.
 *  2. Even the specs that DO collect cannot sign in — MSW is not intercepting,
 *     so every API call resolves to "Something went wrong".
 *
 * Rather than paper over that, this suite takes the approach the PWA config
 * already proved works in this repo: no `webServer`, no MSW, run against a
 * local `pnpm dev`. The shell is chrome around real pages, so exercising it
 * against real responses is the more honest test anyway.
 *
 *   pnpm dev                        # in another terminal
 *   pnpm exec playwright test -c playwright.shell.config.ts
 *
 * Fold this back into the main UI suite once the loader and MSW issues above
 * are fixed — nothing here needs a separate config on its merits.
 */
export default defineConfig({
  testDir: './tests/shell',
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: 'list',
  // A cold `next dev` compiles each route on first hit; the shell assertions
  // themselves are fast, so the ceiling is almost entirely first-compile time.
  timeout: 120_000,
  use: {
    baseURL: process.env['SHELL_BASE_URL'] ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  // Chromium only: the Play Store target is Android Chrome, and every
  // breakpoint assertion sets its own viewport explicitly.
  //
  // One worker, deliberately. The suite shares a single authenticated browser
  // context (see the fixture in mobile-shell.spec.ts) because the real API
  // rate-limits auth and rotates refresh tokens; parallel workers would each
  // want their own login and reintroduce both problems.
  workers: 1,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
