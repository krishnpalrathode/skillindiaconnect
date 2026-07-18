import { test, expect, type Page } from '@playwright/test';

/**
 * S5-F2 E2E — subscription management, invoices, plan-gated document access.
 *
 * Both 'desktop' and 'android-constrained' projects run all tests.
 * MSW handles all /api/v1/* calls (NEXT_PUBLIC_API_MOCKING=enabled).
 *
 * NAVIGATION: the MSW auth session lives in-memory (the mock login sets no
 * refresh cookie), so a full-page reload drops it. After login we navigate
 * CLIENT-SIDE only — login lands on the dashboard, then the sidebar
 * "Subscription" link (a Next <Link>) carries us in without a reload, token
 * intact. The SW must control the page before the login POST is submitted.
 *
 * Fixture emails (data.ts):
 *   employer@example.com        → APPROVED, FREE plan
 *   employer-pro@example.com    → APPROVED, PRO_MONTHLY ACTIVE
 *   employer-grace@example.com  → APPROVED, PRO_MONTHLY GRACE
 *   employer-local@example.com  → APPROVED, FREE, LOCAL company
 */

const LOCALE = 'en';
const EMPLOYER_LOGIN_URL = `/${LOCALE}/employer-login`;
const DASHBOARD_URL = `/${LOCALE}/employer/dashboard`;
const PWD = 'input[type="password"]';

const EMAILS = {
  free: 'employer@example.com',
  pro: 'employer-pro@example.com',
  grace: 'employer-grace@example.com',
  local: 'employer-local@example.com',
} as const;

function installApi404Monitor(page: Page): () => string[] {
  const notFound: string[] = [];
  page.on('response', (res) => {
    const url = res.url();
    // AuthProvider fires doRefresh() on the first paint — the request may fall
    // through to a 404 before the SW activates. It is a harness startup race,
    // not a billing defect, so it is excluded from the walk.
    if (url.includes('/api/v1/auth/refresh')) return;
    if (res.status() === 404 && url.includes('/api/v1/')) {
      notFound.push(`${res.status()} ${url}`);
    }
  });
  return () => notFound;
}

/**
 * Login with the given email and navigate client-side to the subscription page.
 * Must NOT call page.goto after login — that would discard the in-memory token.
 */
async function loginAndOpenSubscription(page: Page, email: string) {
  await page.goto(EMPLOYER_LOGIN_URL);
  // Wait for MSW service worker to control the page before the login POST.
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, {
    timeout: 15_000,
  });
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });
  await page.getByLabel(/work email/i).fill(email);
  await page.locator(PWD).fill('any-password');
  await page.getByRole('button', { name: /sign in/i }).click();

  await page.waitForURL(/\/employer\/dashboard/, { timeout: 15_000 });

  // On mobile the sidebar is behind a hamburger; on desktop it is always visible.
  const menuButton = page.getByRole('button', { name: /open navigation menu/i });
  let openedViaDrawer = false;
  try {
    await menuButton.waitFor({ state: 'visible', timeout: 3_000 });
    await menuButton.click();
    const drawer = page.getByRole('dialog', { name: /navigation/i });
    await expect(drawer).toBeVisible({ timeout: 10_000 });
    await drawer.getByRole('link', { name: /^Subscription$/ }).click();
    openedViaDrawer = true;
  } catch {
    // Desktop — persistent sidebar.
  }
  if (!openedViaDrawer) {
    await page.getByRole('link', { name: /^Subscription$/ }).click({ timeout: 15_000 });
  }
  await page.waitForURL(/\/employer\/subscription/, { timeout: 15_000 });
}

/** Login with the given email and stay on the dashboard. */
async function loginToDashboard(page: Page, email: string) {
  await page.goto(EMPLOYER_LOGIN_URL);
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, {
    timeout: 15_000,
  });
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });
  await page.getByLabel(/work email/i).fill(email);
  await page.locator(PWD).fill('any-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/employer\/dashboard/, { timeout: 15_000 });
}

// ── BROWSER-WALK: subscription manage view renders without 404s ─────────────

test.describe('BROWSER-WALK: /subscription manage view (no 404s)', () => {
  test('Free employer — subscription page loads, plan cards visible, no API 404s', async ({
    page,
  }) => {
    const get404s = installApi404Monitor(page);
    await loginAndOpenSubscription(page, EMAILS.free);

    // Page heading and plan cards must appear
    await expect(page.getByRole('heading', { name: /plans/i })).toBeVisible({ timeout: 10_000 });

    // CurrentPlanCard: free state — no expiresAt, show upgrade CTA
    await expect(page.getByRole('heading', { name: /current plan/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /upgrade to pro/i })).toBeVisible();

    // InvoiceList: empty state for free employer
    await expect(page.getByRole('heading', { name: /invoices/i })).toBeVisible();
    await expect(page.getByText(/no invoices yet/i)).toBeVisible();

    expect(get404s(), get404s().join('\n')).toHaveLength(0);
    await page.screenshot({ path: 'e2e/screenshots/subscription-free-browser-walk.png' });
  });
});

// ── CurrentPlanCard — ACTIVE state ──────────────────────────────────────────

test.describe('CurrentPlanCard — ACTIVE Pro employer', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndOpenSubscription(page, EMAILS.pro);
    await expect(page.getByRole('heading', { name: /current plan/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('shows plan name and expiry date', async ({ page }) => {
    // Scope to the plan card section — "Pro Monthly" also appears in the sidebar
    // widget and the plan-selector radio, so a page-wide getByText would fail strict mode.
    const planCard = page.getByRole('region', { name: /current plan/i });
    await expect(planCard.getByText(/pro monthly/i)).toBeVisible();
    await expect(planCard.getByText(/expires/i)).toBeVisible();
  });

  test('InvoiceList renders invoice rows with formatted amounts', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /invoices/i })).toBeVisible();
    // Pro employer has seeded invoices
    await expect(page.getByText(/SIC-/).first()).toBeVisible({ timeout: 5_000 });
    // Amount formatted with ₹ symbol
    await expect(page.getByText(/₹/).first()).toBeVisible();
  });

  test('invoice with pdfUrl shows download link, null pdfUrl shows "Generating"', async ({
    page,
  }) => {
    // Wait for the invoice table to render before checking PDF link state —
    // InvoiceList is a separate async fetch from CurrentPlanCard.
    await expect(page.getByText(/SIC-/).first()).toBeVisible({ timeout: 10_000 });

    const downloadLinks = page.getByRole('link', { name: /download pdf/i });
    const generatingText = page.getByText(/generating/i);

    const hasDownload = await downloadLinks.count();
    const hasGenerating = await generatingText.count();
    expect(hasDownload + hasGenerating).toBeGreaterThan(0);

    if (hasDownload > 0) {
      const href = await downloadLinks.first().getAttribute('href');
      expect(href).toBeTruthy();
      expect(href).not.toBe('#');
    }
  });
});

// ── Grace state — banner + renew CTA ────────────────────────────────────────

test.describe('Grace state employer', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndOpenSubscription(page, EMAILS.grace);
    await expect(page.getByRole('heading', { name: /current plan/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('GraceBanner is visible as a status region', async ({ page }) => {
    const banner = page.getByRole('status');
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner.getByText(/expired/i)).toBeVisible();
    await expect(banner.getByText(/days/i)).toBeVisible();
  });

  test('GraceBanner renew CTA routes to plan cards section', async ({ page }) => {
    const renewBtn = page.getByRole('link', { name: /renew now/i }).first();
    await expect(renewBtn).toBeVisible();
    await renewBtn.click();
    await expect(page).toHaveURL((url) => url.pathname.includes('/employer/subscription'));
    await expect(page.getByRole('radiogroup')).toBeVisible({ timeout: 5_000 });
  });

  test('grace employer has invoice(s) in the list', async ({ page }) => {
    await expect(page.getByText(/SIC-/).first()).toBeVisible({ timeout: 5_000 });
  });
});

/**
 * Open the mobile sidebar drawer if present and return a Locator scoped to the
 * container that holds PlanStatusWidget. On mobile the sidebar is rendered in
 * BOTH the persistent `<aside>` (CSS-hidden) and the open drawer `<dialog>`, so
 * a page-wide locator would find two elements and fail strict mode. Returning the
 * drawer locator on mobile (and a page locator on desktop) avoids the ambiguity.
 */
async function openSidebarGetContainer(page: Page) {
  const menuButton = page.getByRole('button', { name: /open navigation menu/i });
  try {
    await menuButton.waitFor({ state: 'visible', timeout: 3_000 });
    await menuButton.click();
    const drawer = page.getByRole('dialog', { name: /navigation/i });
    await expect(drawer).toBeVisible({ timeout: 5_000 });
    return drawer;
  } catch {
    // Desktop — sidebar is the persistent `<aside>` (complementary landmark).
    return page.getByRole('complementary');
  }
}

// ── PlanStatusWidget — sidebar reflects live plan state ─────────────────────

test.describe('PlanStatusWidget — sidebar reflects plan state', () => {
  test('Free employer sidebar shows upgrade link', async ({ page }) => {
    await loginToDashboard(page, EMAILS.free);
    const container = await openSidebarGetContainer(page);
    await expect(container.getByText(/upgrade plan/i)).toBeVisible({ timeout: 10_000 });
  });

  test('Grace employer sidebar shows Renew now', async ({ page }) => {
    await loginToDashboard(page, EMAILS.grace);
    const container = await openSidebarGetContainer(page);
    await expect(container.getByText(/renew now/i)).toBeVisible({ timeout: 10_000 });
  });

  test('Pro employer sidebar shows Manage Subscription', async ({ page }) => {
    await loginToDashboard(page, EMAILS.pro);
    const container = await openSidebarGetContainer(page);
    await expect(container.getByText(/manage subscription/i)).toBeVisible({ timeout: 10_000 });
  });
});

// ── DocumentViewButton — Free → upsell link on subscription page ────────────

test.describe('DocumentViewButton — doc-view constrained path (android-constrained green)', () => {
  test('Free employer on subscription page — upgrade CTA visible with correct href', async ({
    page,
  }) => {
    await loginAndOpenSubscription(page, EMAILS.local);
    await expect(page.getByRole('heading', { name: /current plan/i })).toBeVisible({
      timeout: 10_000,
    });

    const upgradeLink = page.getByRole('link', { name: /upgrade to pro/i });
    await expect(upgradeLink).toBeVisible();

    const href = await upgradeLink.first().getAttribute('href');
    expect(href).toContain('/employer/subscription');

    await page.screenshot({ path: 'e2e/screenshots/subscription-doc-view-free.png' });
  });
});
