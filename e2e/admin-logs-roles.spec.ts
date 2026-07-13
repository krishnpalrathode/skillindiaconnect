import { test, expect, type Page } from '@playwright/test';

/**
 * S6a-F3 E2E — System Logs (Screen 29) + RBAC Matrix Editor (Screen 27).
 * DESKTOP project only (internal back-office tool).
 *
 * BROWSER-WALK (flagged class GET /admin/*): the log explorer loads real rows
 * with no /admin 404s, the filter chips find the S2-B5 blocked-publish event,
 * its meta expands, an export downloads an actual CSV file; the matrix renders
 * with the SUPER_ADMIN column locked and a cell flip round-trips through the
 * plain-language confirm.
 *
 * The closing test is the point of the whole sprint: a permission GRANTED in
 * Screen 27 takes effect for that role — the moderator's next session sees (and
 * successfully uses) the export button that the seed denies them. Mock db state
 * persists per browser context, so the grant and the proof share one context.
 */

const LOCALE = 'en';
const DASHBOARD = `/${LOCALE}/admin/dashboard`;

const SUPER_ADMIN = 'superadmin@example.com';
const MODERATOR = 'moderator@example.com';

async function login(page: Page, email: string) {
  await page.goto(`/${LOCALE}/login?next=${encodeURIComponent(DASHBOARD)}`);
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null);
  await page.getByLabel(/email address/i).fill(email);
  await page.locator('input[type="password"]').fill('any-password');
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL((u) => u.pathname.includes('/admin/dashboard'), { timeout: 15_000 });
  await expect(page.getByRole('navigation', { name: /admin navigation/i })).toBeVisible({
    timeout: 10_000,
  });
}

/** Client-side logout+login keeps the SAME context (and thus the same mock db). */
async function switchUser(page: Page, email: string) {
  await page.getByRole('button', { name: /log out/i }).click();
  await page.waitForURL((u) => u.pathname.includes('/login'), { timeout: 10_000 });
  await page.getByLabel(/email address/i).fill(email);
  await page.locator('input[type="password"]').fill('any-password');
  await page.getByRole('button', { name: /log in/i }).click();
}

async function navTo(page: Page, label: string | RegExp) {
  await page
    .getByRole('navigation', { name: /admin navigation/i })
    .getByRole('link', { name: label })
    .click();
}

test.beforeEach(({ page }, testInfo) => {
  const width = testInfo.project.use.viewport?.width ?? 1280;
  test.skip(width < 1024, 'Admin console is desktop-only.');
});

// ─── BROWSER-WALK: the log explorer ──────────────────────────────────────────

test('logs: filter to the blocked-publish event, expand its meta, export a CSV', async ({
  page,
}) => {
  const notFound: string[] = [];
  page.on('response', (r) => {
    if (r.status() === 404 && r.url().includes('/api/v1/admin/')) {
      notFound.push(`404: ${r.url()}`);
    }
  });

  await login(page, SUPER_ADMIN);
  await navTo(page, 'Audit log');

  // Rows load; the default-window disclosure is present (no date range set).
  await expect(page.getByRole('table')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/showing the last 30 days/i)).toBeVisible();

  // Filter: module=Jobs chip + status=BLOCKED → the S2-B5 worker-protection
  // blocked publish surfaces.
  await page.getByRole('button', { name: 'Jobs', exact: true }).click();
  await page.getByRole('combobox', { name: 'Status' }).selectOption('BLOCKED');
  await expect(page.getByText('job.publish.blocked')).toBeVisible({ timeout: 10_000 });

  // Expand the meta: redacted-at-write details, rendered as stored.
  await page.getByRole('button', { name: /show details for job\.publish\.blocked/i }).click();
  await expect(page.getByText(/failedRules/)).toBeVisible();
  await expect(page.getByText(/sensitive fields removed at write time/i)).toBeVisible();

  // The keyset walk ends honestly (the filtered set fits one page).
  await expect(page.getByText(/end of results/i)).toBeVisible();

  // Export downloads an actual file, scoped to the current filters.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /export these \d+\+ results/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  await expect(page.getByText(/exports are themselves recorded/i)).toBeVisible();

  expect(notFound).toHaveLength(0);
  await page.screenshot({ path: 'e2e/screenshots/admin-logs-browser-walk.png' });
});

// ─── BROWSER-WALK: the matrix ────────────────────────────────────────────────

test('matrix: SUPER_ADMIN column locked; a flip round-trips through the confirm', async ({
  page,
}) => {
  const notFound: string[] = [];
  page.on('response', (r) => {
    if (r.status() === 404 && r.url().includes('/api/v1/admin/')) {
      notFound.push(`404: ${r.url()}`);
    }
  });

  await login(page, SUPER_ADMIN);
  await navTo(page, 'Roles & permissions');

  const table = page.getByRole('table');
  await expect(table).toBeVisible({ timeout: 15_000 });

  // The SUPER_ADMIN column renders locked, with the reason in the name.
  await expect(
    page.getByRole('img', { name: /^SUPER_ADMIN, read the audit log: allowed — locked/i }),
  ).toBeVisible();

  // Flip MODERATOR/logs.export (seeded OFF — the two-key boundary) through the
  // plain-language confirm.
  await page
    .getByRole('checkbox', { name: /^MODERATOR, export the audit log: not allowed/i })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/allow moderator to export the audit log\?/i)).toBeVisible();
  await expect(dialog.getByText(/takes effect immediately/i)).toBeVisible();
  await dialog.getByRole('button', { name: /allow it/i }).click();

  // The refetched grid shows the server's new truth.
  await expect(
    page.getByRole('checkbox', { name: /^MODERATOR, export the audit log: allowed/i }),
  ).toBeVisible({ timeout: 10_000 });

  expect(notFound).toHaveLength(0);
  await page.screenshot({ path: 'e2e/screenshots/admin-roles-browser-walk.png' });
});

// ─── THE closing proof: a Screen-27 grant takes effect for the role ──────────

test('a permission granted in the matrix takes effect: the moderator gains (and uses) export', async ({
  page,
}) => {
  await login(page, SUPER_ADMIN);

  // Baseline sanity is seeded: MODERATOR lacks logs.export. Grant it.
  await navTo(page, 'Roles & permissions');
  await page
    .getByRole('checkbox', { name: /^MODERATOR, export the audit log: not allowed/i })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: /allow it/i }).click();
  await expect(
    page.getByRole('checkbox', { name: /^MODERATOR, export the audit log: allowed/i }),
  ).toBeVisible({ timeout: 10_000 });

  // Same context (same mock db): become the moderator.
  await switchUser(page, MODERATOR);
  await page.waitForURL((u) => u.pathname.includes('/admin/dashboard'), { timeout: 15_000 });
  await navTo(page, 'Audit log');
  await expect(page.getByRole('table')).toBeVisible({ timeout: 15_000 });

  // The button the seed denies them is now THERE — the nav/gates derive from
  // the live permission set, not the role name — and it actually works.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /export these \d+\+ results/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
});

// ─── MODERATOR baseline: reduced surface ─────────────────────────────────────

test('moderator baseline: no Roles nav item, no export button on the logs screen', async ({
  page,
}) => {
  await login(page, MODERATOR);

  // roles.view is seeded OFF for MODERATOR → the nav item does not exist.
  await expect(
    page
      .getByRole('navigation', { name: /admin navigation/i })
      .getByRole('link', { name: 'Roles & permissions' }),
  ).toHaveCount(0);

  // They hold logs.view (the screen renders) but not logs.export (no button).
  await navTo(page, 'Audit log');
  await expect(page.getByRole('table')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /export these/i })).toHaveCount(0);
});
