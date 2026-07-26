import { test, expect, type Page } from '@playwright/test';

/**
 * Screen 19 — Plans + checkout E2E suite (S5-F1).
 *
 * Runs under BOTH 'desktop' and 'android-constrained' Playwright projects.
 * MSW (NEXT_PUBLIC_API_MOCKING=enabled) handles all /api/v1/* calls; the
 * webhook EFFECT is simulated by the delayed CREATED→PAID order flip (the
 * order goes PAID only after several polls of GET /billing/orders/{id}), so the
 * constrained run proves the polling survives real latency without a false
 * success or an infinite spinner.
 *
 * NAVIGATION: the MSW auth session lives in-memory (the mock login sets no
 * refresh cookie), so a full-page reload drops it. We therefore navigate
 * CLIENT-SIDE — login lands on the dashboard, then the sidebar "Subscription"
 * link (a Next <Link>) carries us in without a reload, token intact. The GST
 * company-type display is proven in the component tests.
 *
 * BROWSER-WALK gate: any 404 for an /api/v1/ request fails the walk.
 */

const LOCALE = 'en';
const EMPLOYER_LOGIN_URL = `/${LOCALE}/employer-login`;

const EMPLOYER_EMAIL = 'employer@example.com';
const PASSWORD = 'any-password';
const PWD = 'input[type="password"]';

function installApi404Monitor(page: Page): () => string[] {
  const notFound: string[] = [];
  page.on('response', (response) => {
    const url = response.url();
    // The AuthProvider fires doRefresh() on the very first paint — if that
    // happens before the MSW service worker controls the page, the request
    // falls through to a 404 and self-corrects on the next tick. It's a harness
    // startup race, not a billing/app defect, so it's excluded from the walk.
    if (url.includes('/api/v1/auth/refresh')) return;
    if (response.status() === 404 && url.includes('/api/v1/')) {
      notFound.push(`404 ${url}`);
    }
  });
  return () => notFound;
}

/** Login, land on the dashboard, then open Screen 19 via client-side nav. */
async function loginAndOpenSubscription(page: Page) {
  await page.goto(EMPLOYER_LOGIN_URL);
  // MSW intercepts via a service worker started on the client — wait for it to
  // CONTROL the page before the login POST, or the request falls through to a
  // 404 ("Something went wrong").
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, {
    timeout: 15_000,
  });
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });
  await page.getByLabel(/work email/i).fill(EMPLOYER_EMAIL);
  await page.locator(PWD).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();

  // The form pushes to the dashboard client-side (in-memory token preserved).
  await page.waitForURL(/\/employer\/dashboard/, { timeout: 15_000 });

  // On the constrained (mobile) project the sidebar is behind a menu button
  // that opens a role="dialog" drawer; on desktop the nav link is always
  // present in the persistent sidebar. Either way we follow the client-side
  // <Link> (no reload, token intact).
  const menuButton = page.getByRole('button', { name: /open navigation menu/i });
  let openedViaDrawer = false;
  try {
    // Visible only on the constrained (mobile) viewport; times out on desktop.
    await menuButton.waitFor({ state: 'visible', timeout: 3000 });
    await menuButton.click();
    const drawer = page.getByRole('dialog', { name: /navigation/i });
    await expect(drawer).toBeVisible({ timeout: 10_000 });
    await drawer.getByRole('link', { name: /^Subscription$/ }).click();
    openedViaDrawer = true;
  } catch {
    // Desktop — the persistent sidebar link is always present.
  }
  if (!openedViaDrawer) {
    await page.getByRole('link', { name: /^Subscription$/ }).click({ timeout: 15_000 });
  }
  await page.waitForURL(/\/employer\/subscription/, { timeout: 15_000 });
}

test.describe('Screen 19 — plans + checkout', () => {
  test('BROWSER-WALK: /subscription renders plans with no API 404s', async ({ page }) => {
    const get404s = installApi404Monitor(page);
    await loginAndOpenSubscription(page);

    await expect(page.getByRole('radiogroup')).toBeVisible({ timeout: 15_000 });
    // The three plans render as radio options (name is unambiguous vs the
    // "Upgrade to Pro Monthly" button text).
    await expect(page.getByRole('radio', { name: 'Pro Monthly' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Pro Yearly' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Free' })).toBeVisible();

    expect(get404s(), get404s().join('\n')).toHaveLength(0);
  });

  test('launch checkout (mock) → confirming → confirmed after the delayed flip', async ({
    page,
  }) => {
    const get404s = installApi404Monitor(page);
    await loginAndOpenSubscription(page);

    await page.getByRole('button', { name: /upgrade to pro monthly/i }).click({ timeout: 15_000 });

    // Mock path: the "Simulate payment" affordance stands in for the gateway.
    const simulate = page.getByRole('button', { name: /simulate payment/i });
    await expect(simulate).toBeVisible({ timeout: 15_000 });

    // The order is CREATED until the simulated webhook flips it — so the
    // confirming state must appear FIRST (never an instant success).
    await simulate.click();
    await expect(page.getByText(/confirming your payment/i)).toBeVisible();
    await expect(page.getByText(/you're on pro/i)).toHaveCount(0);

    // After the delayed flip (several polls), success renders — webhook-truth.
    await expect(page.getByText(/you're on pro/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /post a job/i })).toBeVisible();

    expect(get404s(), get404s().join('\n')).toHaveLength(0);
  });
});
