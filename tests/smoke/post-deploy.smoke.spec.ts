import { test, expect } from '@playwright/test';

/**
 * POST-DEPLOY SMOKE — runs against a LIVE deployed URL (SMOKE_BASE_URL), never
 * a local server or MSW. Read-only and minimal by design: it proves the
 * deployment is actually serving, and (optionally) that the API is reachable.
 * It is NOT a functional suite — that is the UI-regression (MSW) and, later,
 * the real-stack E2E layer. See docs/testing-architecture.md.
 */

test('landing page is live and renders', async ({ page }) => {
  const response = await page.goto('/');
  // The deployment responded at all (any redirect to /<locale> still 2xx/3xx).
  expect(response, 'no response from SMOKE_BASE_URL — is it set and reachable?').toBeTruthy();
  expect(response!.ok()).toBeTruthy();

  await expect(page.getByRole('heading', { name: 'Skill India Connect' })).toBeVisible();
});

test('API health endpoint responds (only when SMOKE_API_URL is set)', async ({ request }) => {
  const apiUrl = process.env['SMOKE_API_URL'];
  test.skip(!apiUrl, 'SMOKE_API_URL not provided — API health check skipped.');

  // /health is unversioned (not under /api/v1) — see main.api.ts setGlobalPrefix exclude.
  const res = await request.get(`${apiUrl}/health`);
  expect(res.ok(), `GET ${apiUrl}/health returned ${res.status()}`).toBeTruthy();
});
