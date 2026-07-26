import { test, expect, type Page } from '@playwright/test';

/**
 * S6b-F1 E2E — Candidate Management (Screen 25) + the purge gravity UI.
 * DESKTOP project only (internal back-office tool).
 *
 * BROWSER-WALK (flagged class GET /admin/*): the candidate list + detail render
 * with no /admin 404s; a document signed URL ACTUALLY OPENS in a new tab;
 * suspend/reactivate round-trip with a mandatory reason. As SUPER_ADMIN: the
 * purge dialog's type-to-confirm gating behaves (disabled until the exact name
 * AND a reason), and the purge completes into the PURGED tombstone state.
 *
 * Mock db state is per browser context — the purge in the SUPER_ADMIN test
 * cannot leak into the other tests.
 */

const LOCALE = 'en';
const DASHBOARD = `/${LOCALE}/admin/dashboard`;

const ADMIN = 'admin@example.com';
const SUPER_ADMIN = 'superadmin@example.com';

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

async function navToCandidates(page: Page) {
  await page
    .getByRole('navigation', { name: /admin navigation/i })
    .getByRole('link', { name: 'Candidates' })
    .click();
  await expect(page.getByRole('heading', { name: /candidate management/i })).toBeVisible({
    timeout: 10_000,
  });
}

test.beforeEach(({ page }, testInfo) => {
  const width = testInfo.project.use.viewport?.width ?? 1280;
  test.skip(width < 1024, 'Admin console is desktop-only.');
});

// ─── BROWSER-WALK: list, states, document URL, suspend round-trip ────────────

test('candidates: search, states, a document URL that really opens, suspend/reactivate', async ({
  page,
}) => {
  const notFound: string[] = [];
  page.on('response', (r) => {
    if (r.status() === 404 && r.url().includes('/api/v1/admin/')) {
      notFound.push(`404: ${r.url()}`);
    }
  });

  await login(page, ADMIN);
  await navToCandidates(page);

  // The account states render: the pending-deletion countdown is visible.
  const table = page.getByRole('table');
  await expect(table).toBeVisible({ timeout: 15_000 });
  await expect(table.getByText('Sunita Devi')).toBeVisible();
  await expect(table.getByText(/auto-purges in \d+ days/i)).toBeVisible();

  // Search by name (the admin can also search phone/email — same box).
  await page.getByLabel(/search candidates/i).fill('Vikram');
  await page.getByRole('button', { name: /^search$/i }).click();
  await expect(table.getByText('Vikram Singh')).toBeVisible({ timeout: 10_000 });

  // Open the detail — the admin view with contact details + the honest note.
  await page.getByRole('link', { name: /view candidate vikram singh/i }).click();
  await expect(page.getByRole('heading', { name: 'Vikram Singh' })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText('+919812345678')).toBeVisible();
  await expect(page.getByText(/document access is logged/i)).toBeVisible();
  await expect(page.getByText(/document views are logged/i)).toBeVisible();

  // ADMIN lacks candidates.delete → NO danger zone exists for them.
  await expect(page.getByText(/danger zone/i)).toHaveCount(0);

  // The audited document view: the grant is minted and a new tab REALLY opens
  // for it. (The mock R2 host doesn't resolve, so the popup's navigation may
  // fail — the signed URL and the open intent are what's being proven.)
  const [popup, grant] = await Promise.all([
    page.waitForEvent('popup'),
    page.waitForResponse(
      (r) => r.url().includes('/documents/PASSPORT/url') && r.status() === 200,
    ),
    page.getByRole('button', { name: /view passport/i }).click(),
  ]);
  const grantUrl = ((await grant.json()) as { data: { url: string } }).data.url;
  expect(grantUrl).toContain('sig=mock');
  // The tab opened (the mock host DNS-fails, so its final URL is a chrome
  // error page — the component test asserts window.open received the grant
  // URL with noopener; here the real-browser OPEN is the point).
  expect(popup).toBeTruthy();
  await popup.close();

  // Suspend with the mandatory reason; the copy names the consequence.
  await page.getByRole('button', { name: /suspend account/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/unable to log in and will not appear/i)).toBeVisible();
  await dialog.getByLabel(/reason for suspension/i).fill('e2e: verifying the suspend path');
  await dialog.getByRole('button', { name: /^suspend account$/i }).click();
  await expect(page.getByText('Suspended', { exact: true })).toBeVisible({ timeout: 10_000 });

  // Reactivate — back to Active (refetched truth, not optimism).
  await page.getByRole('button', { name: /reactivate account/i }).click();
  await expect(page.getByText('Active', { exact: true })).toBeVisible({ timeout: 10_000 });

  expect(notFound).toHaveLength(0);
  await page.screenshot({ path: 'e2e/screenshots/admin-candidates-browser-walk.png' });
});

// ─── THE PURGE: the gravity UI, end to end ───────────────────────────────────

test('purge: type-to-confirm gating, then the tombstone state', async ({ page }) => {
  await login(page, SUPER_ADMIN);
  await navToCandidates(page);

  await page.getByLabel(/search candidates/i).fill('Vikram');
  await page.getByRole('button', { name: /^search$/i }).click();
  await page.getByRole('link', { name: /view candidate vikram singh/i }).click();
  await expect(page.getByRole('heading', { name: 'Vikram Singh' })).toBeVisible({
    timeout: 10_000,
  });

  // SUPER_ADMIN sees the danger zone — separated, at the bottom.
  await expect(page.getByText(/danger zone/i)).toBeVisible();
  await page.getByRole('button', { name: /purge this account/i }).click();

  // The alertdialog states what is destroyed, what survives, irreversibility.
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText(/this permanently destroys/i)).toBeVisible();
  await expect(dialog.getByText(/applications remain as anonymous records/i)).toBeVisible();
  await expect(dialog.getByText(/this cannot be undone/i)).toBeVisible();

  const confirm = dialog.getByRole('button', { name: /purge permanently/i });
  await expect(confirm).toBeDisabled();

  // Reason alone is not consent…
  await dialog.getByLabel(/reason for purging/i).fill('e2e: verified erasure request');
  await expect(confirm).toBeDisabled();

  // …a near-miss name keeps it disabled…
  await dialog.getByLabel(/type the candidate's full name/i).fill('vikram singh');
  await expect(confirm).toBeDisabled();

  // …only the exact name enables it.
  await dialog.getByLabel(/type the candidate's full name/i).fill('Vikram Singh');
  await expect(confirm).toBeEnabled();
  await confirm.click();

  // The detail refetches into the PURGED tombstone.
  await expect(page.getByRole('heading', { name: 'Deleted user' })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText(/this account was purged on/i)).toBeVisible();
  await expect(page.getByText(/purge started/i)).toBeVisible();
  await expect(page.getByText(/documents were destroyed/i)).toBeVisible();
  // Nothing left to destroy — the danger zone is gone.
  await expect(page.getByText(/danger zone/i)).toHaveCount(0);
  await page.screenshot({ path: 'e2e/screenshots/admin-candidates-purged.png' });

  // The tombstone keeps its LIST row (the applications didn't vanish) — with no actions.
  await navToCandidates(page);
  const row = page.getByRole('table').getByText('Deleted user').first();
  await expect(row).toBeVisible({ timeout: 10_000 });
});
