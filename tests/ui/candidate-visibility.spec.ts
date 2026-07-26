import { test, expect, type Page } from '@playwright/test';

// S3-F3 — Candidate-side visibility loop: the live Profile Views KPI + the
// PROFILE_VIEWED / PASSPORT_EXPIRY notifications.
// Runs under BOTH 'desktop' and 'android-constrained' Playwright projects.
// MSW (NEXT_PUBLIC_API_MOCKING=enabled) serves all /api/v1/* calls; Amir's
// fixture feed is seeded with one PROFILE_VIEWED + one PASSPORT_EXPIRY, and one
// seeded profile view (Gulf Builders Arabia).
//
// BROWSER-WALK gate: console 404s are monitored on the dashboard; the flagged
// endpoint GET /candidates/me/profile-views must resolve in-browser.

const LOCALE = 'en';
const LOGIN_URL = `/${LOCALE}/login`;
const DASHBOARD_URL = `/${LOCALE}/dashboard`;
const NOTIFICATIONS_URL = `/${LOCALE}/notifications`;
const PWD = 'input[type="password"]';

async function loginAsCandidate(page: Page) {
  await page.goto(LOGIN_URL);
  await page.getByLabel(/email address/i).fill('amir@example.com');
  await page.locator(PWD).fill('any-password');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
}

function installApi404Monitor(page: Page): () => string[] {
  const notFound: string[] = [];
  page.on('response', (response) => {
    if (response.status() === 404 && response.url().includes('/api/v1/')) {
      notFound.push(`404 ${response.url()}`);
    }
  });
  return () => notFound;
}

test.describe('S3-F3 — Candidate visibility', () => {
  test('dashboard shows the live Profile Views KPI + recent viewers, no API 404s', async ({
    page,
  }, testInfo) => {
    const getNotFound = installApi404Monitor(page);
    await loginAsCandidate(page);
    await page.goto(DASHBOARD_URL);

    // Live KPI (last 30 days) — the flagged endpoint resolved in-browser
    await expect(page.getByText('Profile Views')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('last 30 days')).toBeVisible();
    await expect(page.getByRole('link', { name: /profile views, last 30 days/i })).toBeVisible();

    // Recent viewers surface — company name only
    await expect(page.getByRole('heading', { name: /recent profile views/i })).toBeVisible();
    await expect(page.getByText('Gulf Builders Arabia').first()).toBeVisible();

    await testInfo.attach('dashboard-visibility', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    expect(getNotFound()).toEqual([]);
  });

  test('both notification types render with the correct copy', async ({ page }) => {
    await loginAsCandidate(page);
    await page.goto(NOTIFICATIONS_URL);

    await expect(page.getByText(/viewed your profile/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/expires in 7 days/i)).toBeVisible();
  });

  test('passport-expiry notification navigates to the profile Documents section', async ({
    page,
  }) => {
    await loginAsCandidate(page);
    await page.goto(NOTIFICATIONS_URL);

    await page.getByText(/expires in 7 days/i).click();

    await expect(page).toHaveURL(/\/profile(#documents)?$/, { timeout: 10_000 });
    await expect(page.getByRole('region', { name: /documents/i })).toBeVisible({ timeout: 10_000 });
  });

  test('the profile-viewed notification can be marked read', async ({ page }) => {
    await loginAsCandidate(page);
    await page.goto(NOTIFICATIONS_URL);

    // The PROFILE_VIEWED item is unread — mark-all-read clears the unread markers
    await expect(page.getByText(/viewed your profile/i)).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /mark all as read/i }).click();

    await expect(page.getByRole('button', { name: /mark all as read/i })).toHaveCount(0);
  });
});
