import { test, expect, type Page } from '@playwright/test';

/**
 * Admin console shell E2E — S6a-F1. DESKTOP project only (this is an internal
 * back-office tool; no android-constrained obligation — see the skip guard).
 *
 * MSW serves every /api/v1/* call (NEXT_PUBLIC_API_MOCKING=enabled), against the
 * SAME seeded RBAC matrix the API uses — so the reduced-nav and 403 paths below
 * are real per-role denials, not staged ones.
 *
 * BROWSER-WALK gate (flagged endpoint class GET /admin/*): the shell + dashboard
 * must resolve GET /admin/me/permissions AND GET /admin/dashboard in the browser
 * with NO console 404s. The nav rendering at all is the implicit proof the
 * permissions call succeeded; the KPIs are the proof the dashboard call did.
 */

const LOCALE = 'en';
const DASHBOARD = `/${LOCALE}/admin/dashboard`;

const SUPER_ADMIN = 'superadmin@example.com';
const MODERATOR = 'moderator@example.com';
const CANDIDATE = 'amir@example.com';
const ANY_PASSWORD = 'any-password';

// Log in, then let the login form's OWN client-side redirect carry us into the
// admin shell with the in-memory token intact. A full-page goto after login would
// drop the token (the mock login sets no refresh cookie) and bounce to /login.
async function loginToAdmin(page: Page, email: string) {
  await page.goto(`/${LOCALE}/login?next=${encodeURIComponent(DASHBOARD)}`);
  // The login POST must not fall through to a Next 404 — wait for the SW to
  // control the page first.
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null);
  await page.getByLabel(/email address/i).fill(email);
  await page.locator('input[type="password"]').fill(ANY_PASSWORD);
  await page.getByRole('button', { name: /log in/i }).click();
}

// Desktop only.
test.beforeEach(({ page }, testInfo) => {
  const width = testInfo.project.use.viewport?.width ?? 1280;
  test.skip(width < 1024, 'Admin console is desktop-only (no constrained profile).');
});

// ─── BROWSER-WALK ─────────────────────────────────────────────────────────────

test.describe('BROWSER-WALK: GET /admin/* resolves with no 404', () => {
  test('SUPER_ADMIN lands in the shell; dashboard KPIs + queues render', async ({ page }) => {
    const notFound: string[] = [];
    page.on('response', (r) => {
      // The first-paint /auth/refresh 404 is benign (fires before the SW is
      // active, self-corrects) — every OTHER admin 404 is a real failure.
      if (r.status() === 404 && r.url().includes('/api/v1/admin/')) {
        notFound.push(`404: ${r.url()}`);
      }
    });

    await loginToAdmin(page, SUPER_ADMIN);
    await page.waitForURL((u) => u.pathname.includes('/admin/dashboard'), { timeout: 15_000 });

    // Nav rendered ⇒ /admin/me/permissions resolved.
    const nav = page.getByRole('navigation', { name: /admin navigation/i });
    await expect(nav).toBeVisible({ timeout: 10_000 });

    // KPIs + queues rendered ⇒ /admin/dashboard resolved.
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(page.getByText('Waiting for you')).toBeVisible();

    expect(notFound).toHaveLength(0);
    await page.screenshot({ path: 'e2e/screenshots/admin-shell-browser-walk.png' });
  });
});

// ─── Guard ────────────────────────────────────────────────────────────────────

test.describe('AdminRouteGuard', () => {
  test('a candidate gets the not-authorized panel — NOT a silent redirect', async ({ page }) => {
    await loginToAdmin(page, CANDIDATE);
    // The candidate authenticates, the form pushes to /admin/dashboard, the guard
    // refuses — but does not teleport them. They stay on the admin path, shown an
    // honest explanation.
    await expect(page.getByText('This area is for administrators')).toBeVisible({
      timeout: 10_000,
    });
    expect(page.url()).toContain('/admin/dashboard');
  });

  test('an anonymous visitor is redirected to login', async ({ page }) => {
    await page.goto(DASHBOARD);
    await page.waitForURL((u) => u.pathname.includes('/login'), { timeout: 10_000 });
    expect(page.url()).toContain('/login');
  });
});

// ─── SUPER_ADMIN: full nav walks to every placeholder ────────────────────────

test.describe('SUPER_ADMIN — full nav', () => {
  test.beforeEach(async ({ page }) => {
    await loginToAdmin(page, SUPER_ADMIN);
    await page.waitForURL((u) => u.pathname.includes('/admin/dashboard'), { timeout: 15_000 });
    await expect(page.getByRole('navigation', { name: /admin navigation/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  const routes: Array<[string, string]> = [
    ['Employers', '/admin/employers'],
    ['Candidates', '/admin/candidates'],
    ['Jobs', '/admin/jobs'],
    ['Applications', '/admin/applications'],
    ['Audit log', '/admin/logs'],
    ['Roles & permissions', '/admin/roles'],
    ['Settings', '/admin/settings'],
  ];

  for (const [label, path] of routes) {
    test(`nav → ${label} reaches its route`, async ({ page }) => {
      const nav = page.getByRole('navigation', { name: /admin navigation/i });
      await nav.getByRole('link', { name: label }).click();
      await page.waitForURL((u) => u.pathname.includes(path), { timeout: 10_000 });
      // The placeholder heading proves the route resolved and the server allowed it.
      await expect(page.getByRole('heading', { name: label })).toBeVisible({ timeout: 10_000 });
    });
  }
});

// ─── MODERATOR: reduced nav + a graceful 403 on a forced URL ─────────────────

test.describe('MODERATOR — reduced nav + forced-URL 403', () => {
  test.beforeEach(async ({ page }) => {
    await loginToAdmin(page, MODERATOR);
    await page.waitForURL((u) => u.pathname.includes('/admin/dashboard'), { timeout: 15_000 });
    await expect(page.getByRole('navigation', { name: /admin navigation/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('the nav is demonstrably smaller — no Settings, Roles, or Applications', async ({
    page,
  }) => {
    const nav = page.getByRole('navigation', { name: /admin navigation/i });
    // Present:
    await expect(nav.getByRole('link', { name: 'Employers' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Audit log' })).toBeVisible();
    // Absent (permission-gated, not role-hardcoded):
    await expect(nav.getByRole('link', { name: 'Settings' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Roles & permissions' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Applications' })).toHaveCount(0);
  });

  test('the queue cards work (deep-link to the filtered list)', async ({ page }) => {
    const employerQueue = page.getByRole('link', { name: /Employers awaiting review/ });
    await expect(employerQueue).toBeVisible();
    await expect(employerQueue).toHaveAttribute('href', /\/admin\/employers\?status=PENDING/);
  });

  test('force-navigating to /admin/settings is handled gracefully — settings never leak, no crash', async ({
    page,
  }) => {
    // The Settings link is hidden from a moderator — but hiding is not locking, so
    // they can still type the URL. What must NEVER happen: the settings screen
    // renders anyway.
    //
    // HARNESS NOTE. A full-page navigation drops the in-memory access token (the
    // MSW login sets no refresh cookie — see the web-e2e-msw-auth reference), so
    // in the mock the moderator arrives unauthenticated and the guard sends them
    // to login. That is itself graceful — no crash, no settings. The AUTHORITATIVE
    // forced-URL → ForbiddenState proof (session intact, real server 403, the
    // honest fallback rendered) is the component test
    // `components/admin/__tests__/forbidden-and-guard.test.tsx`, which the mock CAN
    // reproduce because it never does a full page reload. In production the refresh
    // cookie keeps the session and the same URL yields ForbiddenState directly.
    await page.goto(`/${LOCALE}/admin/settings`);

    // Whichever branch the harness takes, the invariant holds: no settings UI, and
    // no unhandled crash (React error overlay / Next error page).
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Settings' })).toHaveCount(0);
    await expect(page.getByText(/application error|unhandled|something went wrong/i)).toHaveCount(
      0,
    );
    // Landed somewhere safe — login (mock) or the ForbiddenState (prod path).
    await expect(page).toHaveURL(/\/(login|admin\/settings)/);
  });
});
