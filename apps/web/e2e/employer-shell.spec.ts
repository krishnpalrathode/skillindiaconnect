import { test, expect, type Page } from '@playwright/test';

/**
 * Employer portal shell E2E suite — S2-F0.
 *
 * Both 'desktop' and 'android-constrained' Playwright projects run all tests.
 * MSW handles all /api/v1/* calls (NEXT_PUBLIC_API_MOCKING=enabled).
 *
 * BROWSER-WALK gate (the S1-flagged endpoint class):
 *   GET /employers/me/company MUST resolve without a 404 in the browser.
 *   Every test that loads the employer shell verifies this implicitly — the
 *   company name from the fixture appears in the header if the call succeeded.
 */

const LOCALE = 'en';
const DASHBOARD_URL = `/${LOCALE}/employer/dashboard`;

// Seeded fixture credentials (data.ts)
const APPROVED_EMAIL = 'employer@example.com';
const PENDING_EMAIL = 'employer-pending@example.com';
const CANDIDATE_EMAIL = 'amir@example.com';
const ANY_PASSWORD = 'any-password';

async function loginAs(page: Page, email: string) {
  await page.goto(`/${LOCALE}/login`);
  await page.getByLabel(/email address/i).fill(email);
  await page.locator('input[type="password"]').fill(ANY_PASSWORD);
  await page.getByRole('button', { name: /log in/i }).click();
}

async function loginAsEmployer(page: Page, email = APPROVED_EMAIL) {
  await loginAs(page, email);
  // Wait until we land somewhere that isn't /login
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 });
}

// ─── BROWSER-WALK GATE ────────────────────────────────────────────────────────

test.describe('BROWSER-WALK: GET /employers/me/company resolves (no 404)', () => {
  test('company name appears in header after employer login', async ({ page }) => {
    // Capture any /api/v1/employers/me/company requests to verify no 404
    const apiErrors: string[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/api/v1/employers/me/company') && response.status() === 404) {
        apiErrors.push(`404 on GET /employers/me/company: ${response.url()}`);
      }
    });

    await loginAsEmployer(page);
    await page.goto(DASHBOARD_URL);

    // Company name from the approved fixture must be visible in the header
    await expect(page.getByTestId('header-company-name')).toHaveText('Gulf Builders Arabia', {
      timeout: 10_000,
    });

    // Assert no 404 was received
    expect(apiErrors).toHaveLength(0);

    await page.screenshot({ path: 'e2e/screenshots/employer-shell-browser-walk.png' });
  });
});

// ─── Guard: non-employer cannot access employer routes ────────────────────────

test.describe('EmployerRouteGuard', () => {
  test('redirects candidate away from employer dashboard', async ({ page }) => {
    await loginAs(page, CANDIDATE_EMAIL);
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10_000 });

    // Try to navigate to the employer dashboard
    await page.goto(DASHBOARD_URL);

    // Should be redirected away (back to candidate profile or login)
    await page.waitForURL((url) => !url.pathname.includes('/employer/dashboard'), {
      timeout: 10_000,
    });
    expect(page.url()).not.toContain('/employer/dashboard');
  });

  test('unauthenticated user is redirected to login', async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    await page.waitForURL((url) => url.pathname.includes('/login'), { timeout: 10_000 });
    expect(page.url()).toContain('/login');
  });
});

// ─── Employer shell — sidebar + header + nav ──────────────────────────────────

test.describe('Employer shell — sidebar nav + header', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsEmployer(page);
    await page.goto(DASHBOARD_URL);
    await expect(page.getByTestId('header-company-name')).toBeVisible({ timeout: 10_000 });
  });

  test('sidebar nav renders all expected items', async ({ page }) => {
    // On desktop the sidebar is visible directly; on mobile check after opening drawer
    const viewport = page.viewportSize();
    const isMobile = viewport ? viewport.width < 1024 : false;

    if (isMobile) {
      await page.getByRole('button', { name: /open navigation menu/i }).click();
      await expect(page.getByRole('dialog', { name: /employer navigation/i })).toBeVisible();
    }

    const nav = page.getByRole('navigation', { name: /employer navigation/i });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: /dashboard/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /my jobs/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /candidates/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /subscription/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /company profile/i })).toBeVisible();
  });

  test('company name shows in header', async ({ page }) => {
    await expect(page.getByTestId('header-company-name')).toHaveText('Gulf Builders Arabia');
  });

  test('notifications bell is present', async ({ page }) => {
    await expect(page.getByRole('button', { name: /notifications/i })).toBeVisible();
  });

  test('"Post a Job" is ENABLED for approved company', async ({ page }) => {
    const viewport = page.viewportSize();
    if (viewport && viewport.width < 1024) {
      await page.getByRole('button', { name: /open navigation menu/i }).click();
    }

    const nav = page.getByRole('navigation', { name: /employer navigation/i });
    await expect(nav.getByRole('link', { name: /post a job/i })).toBeVisible();
  });
});

// ─── Company state banners ────────────────────────────────────────────────────

test.describe('CompanyStateBanner — PENDING company', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsEmployer(page, PENDING_EMAIL);
    await page.goto(DASHBOARD_URL);
    // Wait for the shell to load (banner appears if company is PENDING)
    await page.waitForLoadState('networkidle');
  });

  test('shows under-review info banner', async ({ page }) => {
    await expect(page.getByRole('status')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/under review/i)).toBeVisible();
  });

  test('"Post a Job" is DISABLED (aria-disabled) for PENDING company', async ({ page }) => {
    const viewport = page.viewportSize();
    if (viewport && viewport.width < 1024) {
      await page.getByRole('button', { name: /open navigation menu/i }).click();
    }

    const nav = page.getByRole('navigation', { name: /employer navigation/i });
    await expect(nav.getByRole('button', { name: /post a job/i })).toHaveAttribute(
      'aria-disabled',
      'true',
      { timeout: 10_000 },
    );
  });
});

// ─── Nav walk — placeholder routes are reachable ─────────────────────────────

test.describe('Sidebar nav — placeholder routes are reachable', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsEmployer(page);
    await page.goto(DASHBOARD_URL);
    await expect(page.getByTestId('header-company-name')).toBeVisible({ timeout: 10_000 });
  });

  test('My Jobs placeholder loads', async ({ page }) => {
    const viewport = page.viewportSize();
    if (viewport && viewport.width < 1024) {
      await page.getByRole('button', { name: /open navigation menu/i }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
    }
    await page.getByRole('link', { name: /my jobs/i }).click();
    await page.waitForURL((url) => url.pathname.includes('/employer/jobs'), { timeout: 5_000 });
    await expect(page.getByRole('heading', { name: /my jobs/i })).toBeVisible({ timeout: 5_000 });
  });

  test('Candidates placeholder loads', async ({ page }) => {
    const viewport = page.viewportSize();
    if (viewport && viewport.width < 1024) {
      await page.getByRole('button', { name: /open navigation menu/i }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
    }
    await page.getByRole('link', { name: /candidates/i }).click();
    await page.waitForURL((url) => url.pathname.includes('/employer/candidates'), {
      timeout: 5_000,
    });
    await expect(page.getByRole('heading', { name: /candidates/i })).toBeVisible({
      timeout: 5_000,
    });
  });

  test('Subscription placeholder loads', async ({ page }) => {
    const viewport = page.viewportSize();
    if (viewport && viewport.width < 1024) {
      await page.getByRole('button', { name: /open navigation menu/i }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
    }
    await page.getByRole('link', { name: /subscription/i }).click();
    await page.waitForURL((url) => url.pathname.includes('/employer/subscription'), {
      timeout: 5_000,
    });
    await expect(page.getByRole('heading', { name: /subscription/i })).toBeVisible({
      timeout: 5_000,
    });
  });
});

// ─── Mobile: drawer opens and closes ─────────────────────────────────────────

test.describe('Mobile drawer', () => {
  test('opens and closes on mobile', async ({ page }) => {
    const viewport = page.viewportSize();
    // Only meaningful on mobile viewports
    if (!viewport || viewport.width >= 1024) {
      test.skip();
      return;
    }

    await loginAsEmployer(page);
    await page.goto(DASHBOARD_URL);
    await expect(page.getByTestId('header-company-name')).toBeVisible({ timeout: 10_000 });

    // Drawer is closed initially
    await expect(page.getByRole('dialog', { name: /navigation/i })).not.toBeVisible();

    // Open drawer
    await page.getByRole('button', { name: /open navigation menu/i }).click();
    await expect(page.getByRole('dialog', { name: /navigation/i })).toBeVisible();

    // Clicking backdrop closes drawer
    await page.mouse.click(5, page.viewportSize()!.height / 2);
    await expect(page.getByRole('dialog', { name: /navigation/i })).not.toBeVisible();
  });
});
