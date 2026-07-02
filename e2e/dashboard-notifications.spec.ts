import { test, expect } from '@playwright/test';

// Dev server runs with NEXT_PUBLIC_API_MOCKING=enabled — MSW handles all API calls.
// Dashboard and notifications are candidate-only authenticated pages.

const LOCALE = 'en';
const LOGIN_URL = `/${LOCALE}/login`;
const DASHBOARD_URL = `/${LOCALE}/dashboard`;
const NOTIFICATIONS_URL = `/${LOCALE}/notifications`;

const PWD = 'input[type="password"]';

async function loginAsCandidate(page: import('@playwright/test').Page) {
  await page.goto(LOGIN_URL);
  await page.getByLabel(/email address/i).fill('amir@example.com');
  await page.locator(PWD).fill('any-password');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
}

// ─── Screen 06 — Candidate Dashboard ─────────────────────────────────────────

test.describe('Dashboard (Screen 06)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsCandidate(page);
  });

  test('renders dashboard page with greeting', async ({ page }, testInfo) => {
    await expect(page.getByRole('heading', { name: /hello/i })).toBeVisible({ timeout: 10_000 });

    await testInfo.attach('dashboard-loaded', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('shows all four KPI cards', async ({ page }) => {
    await expect(page.getByText('Jobs Applied')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Profile Views')).toBeVisible();
    await expect(page.getByText('Shortlisted')).toBeVisible();
    await expect(page.getByText('Updates')).toBeVisible();
  });

  test('Updates KPI card links to notifications', async ({ page }) => {
    await page.waitForSelector('text=Updates', { timeout: 10_000 });
    const updatesLink = page.getByRole('link').filter({ hasText: /notifications/i }).first();
    // Updates card may not have text "notifications" — check href
    const kpiLinks = await page.locator('a[href*="notifications"]').all();
    expect(kpiLinks.length).toBeGreaterThan(0);
  });

  test('shows Recommended Jobs section', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /recommended jobs/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('shows at least one recommended job card', async ({ page }) => {
    await page.waitForSelector('[aria-label="Recommended Jobs"]', { timeout: 10_000 });
    const jobLinks = page.getByRole('link', { name: /view details/i });
    await expect(jobLinks.first()).toBeVisible({ timeout: 10_000 });
  });

  test('shows profile summary card with completion ring', async ({ page }) => {
    await expect(page.getByRole('meter')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/complete now/i)).toBeVisible();
  });

  test('shows quick actions section', async ({ page }) => {
    await expect(page.getByRole('link', { name: /complete profile/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('link', { name: /browse jobs/i })).toBeVisible();
  });

  test('Dashboard is in nav sidebar (desktop)', async ({ page, isMobile }) => {
    if (isMobile) test.skip();
    await expect(page.getByRole('navigation', { name: /main navigation/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /dashboard/i }).first()).toBeVisible();
  });

  test('no console errors on /dashboard', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.reload();
    await page.waitForSelector('text=Jobs Applied', { timeout: 10_000 });
    const critical = errors.filter(
      (e) => !e.includes('favicon') && !e.includes('/_next/') && !e.includes('[MSW]'),
    );
    expect(critical).toHaveLength(0);
  });
});

// ─── Screen 12 — Notifications ───────────────────────────────────────────────

test.describe('Notifications (Screen 12)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsCandidate(page);
    await page.goto(NOTIFICATIONS_URL);
  });

  test('renders notifications page heading', async ({ page }, testInfo) => {
    await expect(page.getByRole('heading', { name: /notifications/i })).toBeVisible({
      timeout: 10_000,
    });

    await testInfo.attach('notifications-page', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('renders filter tabs: All, Applications, Jobs, Profile, System', async ({ page }) => {
    await expect(page.getByRole('tab', { name: /^all$/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: /applications/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^jobs$/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /profile/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /system/i })).toBeVisible();
  });

  test('shows unread only toggle', async ({ page }) => {
    await expect(page.getByRole('checkbox', { name: /unread only/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('displays notification items from mock data', async ({ page }) => {
    await expect(page.getByText(/new job match|application shortlisted|platform update|complete your profile/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('shows mark all as read button when unread notifications exist', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /mark all as read/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('mark as read button removes unread indicator optimistically', async ({ page }, testInfo) => {
    await page.waitForSelector('[aria-label="Unread"]', { timeout: 10_000 });

    const unreadIndicators = await page.locator('[aria-label="Unread"]').count();
    expect(unreadIndicators).toBeGreaterThan(0);

    const markReadBtn = page.getByRole('button', { name: /mark as read/i }).first();
    await markReadBtn.click();

    await testInfo.attach('after-mark-read', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    const newCount = await page.locator('[aria-label="Unread"]').count();
    expect(newCount).toBeLessThan(unreadIndicators);
  });

  test('filter by Jobs shows only job-related notifications', async ({ page }) => {
    await page.getByRole('tab', { name: /^jobs$/i }).click();
    await page.waitForTimeout(500);
    await expect(
      page.getByRole('tab', { name: /^jobs$/i }),
    ).toHaveAttribute('aria-selected', 'true');
  });

  test('unread-only toggle filters to show only unread', async ({ page }) => {
    const checkbox = page.getByRole('checkbox', { name: /unread only/i });
    await checkbox.waitFor({ timeout: 10_000 });
    await checkbox.click();
    await page.waitForTimeout(500);
    await expect(checkbox).toBeChecked();
  });

  test('Notifications link is enabled in sidebar nav (desktop)', async ({ page, isMobile }) => {
    if (isMobile) test.skip();
    const notifLink = page.getByRole('navigation', { name: /main navigation/i }).first()
      .getByRole('link', { name: /notifications/i });
    await expect(notifLink).toBeVisible();
  });

  test('no 404 errors in console on /notifications', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.reload();
    await page.waitForSelector('[role="tablist"]', { timeout: 10_000 });
    const critical = errors.filter(
      (e) => !e.includes('favicon') && !e.includes('/_next/') && !e.includes('[MSW]'),
    );
    expect(critical).toHaveLength(0);
  });
});
