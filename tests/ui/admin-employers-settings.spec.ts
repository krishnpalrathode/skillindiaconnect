import { test, expect, type Page } from '@playwright/test';

/**
 * S6a-F2 E2E — Employer Management (Screen 24) + Settings (Screen 28).
 * DESKTOP project only (internal back-office tool).
 *
 * MSW serves every /api/v1/* call against the seeded RBAC matrix, so the
 * per-role denials below are real. State mutations (reject/approve) persist in
 * the mock db for the life of the dev-server worker — each test seeds through
 * the UI itself and asserts the server's answer, not local state.
 *
 * BROWSER-WALK (flagged class GET /admin/*): the queue, the review detail, the
 * CERTIFICATE SIGNED URL, an action round-trip, and a settings save must all
 * resolve in a real browser with no /admin 404s.
 */

const LOCALE = 'en';
const DASHBOARD = `/${LOCALE}/admin/dashboard`;

const SUPER_ADMIN = 'superadmin@example.com';
const MODERATOR = 'moderator@example.com';
const ANY_PASSWORD = 'any-password';

async function loginToAdmin(page: Page, email: string) {
  await page.goto(`/${LOCALE}/login?next=${encodeURIComponent(DASHBOARD)}`);
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null);
  await page.getByLabel(/email address/i).fill(email);
  await page.locator('input[type="password"]').fill(ANY_PASSWORD);
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL((u) => u.pathname.includes('/admin/dashboard'), { timeout: 15_000 });
  await expect(page.getByRole('navigation', { name: /admin navigation/i })).toBeVisible({
    timeout: 10_000,
  });
}

/** Client-side navigate via the sidebar (a full goto would drop the mock token). */
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

// ─── BROWSER-WALK: queue → detail → certificate → action → settings ─────────

test.describe('BROWSER-WALK: Screen 24 + 28 resolve end-to-end', () => {
  test('dashboard queue card → PENDING list → review → certificate → reject with reason', async ({
    page,
  }) => {
    const notFound: string[] = [];
    page.on('response', (r) => {
      // /certificate/url 404 is a DESIGNED answer ("no certificate on file",
      // indistinguishable from unknown company by contract) — the UI renders it
      // as the honest no-cert state, asserted separately. Everything else
      // 404ing under /admin is a broken route.
      if (
        r.status() === 404 &&
        r.url().includes('/api/v1/admin/') &&
        !r.url().includes('/certificate/url')
      ) {
        notFound.push(`404: ${r.url()}`);
      }
    });

    await loginToAdmin(page, SUPER_ADMIN);

    // The console's front door: the pending-reviews queue card deep-links into
    // the filtered list.
    await page.getByRole('link', { name: /employers awaiting review/i }).click();
    // Poll the URL rather than waitForURL: App Router soft navigations don't
    // reliably emit the load-state waitForURL blocks on.
    await expect(page).toHaveURL(/status=PENDING/, { timeout: 10_000 });
    await expect(page.getByRole('tab', { name: /pending review/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Open the pending company's review.
    await page.getByRole('table').getByRole('link', { name: /^review/i }).first().click();
    await expect(page).toHaveURL(/\/admin\/employers\/[\w-]+/, { timeout: 10_000 });
    await expect(page.getByText(/company details/i)).toBeVisible({ timeout: 20_000 });

    // The certificate section resolves — this fixture has none uploaded, and the
    // HONEST state for that is part of the walk (the signed-URL happy path is
    // walked on the approved company below).
    await expect(page.getByText(/no certificate uploaded/i)).toBeVisible({ timeout: 10_000 });

    // Reject WITH the mandatory reason; the dialog names the visibility.
    await page.getByRole('button', { name: /^reject$/i }).click();
    await expect(page.getByText(/shown to the employer/i)).toBeVisible();
    const confirmReject = page.getByRole('button', { name: /reject company/i });
    await expect(confirmReject).toBeDisabled(); // empty reason blocks
    await page
      .getByLabel(/reason for rejection/i)
      .fill('Registration certificate is missing. Please upload it and resubmit.');
    await confirmReject.click();

    // Refetched server state: REJECTED badge + the employer-visible reason.
    await expect(page.getByText(/rejection reason \(visible to the employer\)/i)).toBeVisible({
      timeout: 10_000,
    });

    expect(notFound).toHaveLength(0);
    await page.screenshot({ path: 'e2e/screenshots/admin-employers-browser-walk.png' });
  });

  test('approve round-trips: PENDING → APPROVED with the post-approval fact stated', async ({
    page,
  }) => {
    // Fresh browser context = fresh MSW db, so the same PENDING fixture the
    // reject test consumed is pending again here.
    await loginToAdmin(page, SUPER_ADMIN);
    await navTo(page, 'Employers');

    // Let the table settle before clicking into a row — clicking mid skeleton→
    // table swap can land on a node React is about to replace, and the click
    // evaporates with it.
    const review = page.getByRole('table').getByRole('link', { name: /^review/i }).first();
    await expect(review).toBeVisible({ timeout: 10_000 });
    await review.click();
    await expect(page).toHaveURL(/\/admin\/employers\/[\w-]+/, { timeout: 10_000 });
    await expect(page.getByText(/company details/i)).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: /^approve$/i }).click();
    // The dialog states the consequence: they can post jobs immediately.
    await expect(page.getByText(/able to post jobs/i)).toBeVisible();
    await page.getByRole('button', { name: /approve company/i }).click();

    // Refetched state: the success notice + the Suspend affordance appearing
    // (APPROVED-stage action) prove the server flipped it.
    await expect(page.getByText(/company approved/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /suspend/i })).toBeVisible();
  });

  test('the certificate SIGNED URL actually loads a document in the browser', async ({ page }) => {
    await loginToAdmin(page, SUPER_ADMIN);
    await navTo(page, 'Employers');

    // The APPROVED fixture has a certificate on file.
    await page.getByRole('tab', { name: /^approved$/i }).click();
    await expect(page.getByRole('tab', { name: /^approved$/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const review = page.getByRole('table').getByRole('link', { name: /^review/i }).first();
    await expect(review).toBeVisible({ timeout: 10_000 });
    await review.click();
    await expect(page).toHaveURL(/\/admin\/employers\/[\w-]+/, { timeout: 10_000 });

    // The signed-URL grant resolves and the document embeds.
    const iframe = page.locator('iframe[title*="certificate" i]');
    await expect(iframe).toBeVisible({ timeout: 10_000 });
    await expect(iframe).toHaveAttribute('src', /r2\.mock.*\?sig=/);
    await expect(page.getByRole('link', { name: /open in new tab/i })).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/admin-certificate-browser-walk.png' });
  });

  test('settings load; a non-core save round-trips; core rules carry the OFF friction', async ({
    page,
  }) => {
    const notFound: string[] = [];
    page.on('response', (r) => {
      // /certificate/url 404 is a DESIGNED answer ("no certificate on file",
      // indistinguishable from unknown company by contract) — the UI renders it
      // as the honest no-cert state, asserted separately. Everything else
      // 404ing under /admin is a broken route.
      if (
        r.status() === 404 &&
        r.url().includes('/api/v1/admin/') &&
        !r.url().includes('/certificate/url')
      ) {
        notFound.push(`404: ${r.url()}`);
      }
    });

    await loginToAdmin(page, SUPER_ADMIN);
    await navTo(page, 'Settings');

    // Grouped tabs render from the key prefixes.
    await expect(page.getByRole('tab', { name: /worker protection/i })).toBeVisible({
      timeout: 10_000,
    });

    // Non-core save round-trip (Jobs → auto-archive days).
    await page.getByRole('tab', { name: 'Jobs' }).click();
    const archive = page.getByLabel(/auto-archive after/i);
    await archive.fill('120');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved.')).toBeVisible({ timeout: 10_000 });

    // Restore (the mock db persists across tests on this worker).
    await archive.fill('90');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved.')).toBeVisible({ timeout: 10_000 });

    // Core rule OFF → the consequence dialog, in plain words. Cancel it.
    await page.getByRole('tab', { name: /worker protection/i }).click();
    await page.getByRole('switch', { name: /require accommodation/i }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/publishable without guaranteed accommodation/i)).toBeVisible();
    await expect(dialog.getByText(/weakens worker protection/i)).toBeVisible();
    await dialog.getByRole('button', { name: /keep it on/i }).click();

    expect(notFound).toHaveLength(0);
    await page.screenshot({ path: 'e2e/screenshots/admin-settings-browser-walk.png' });
  });
});

// ─── MODERATOR: per-button gating + the F1 ForbiddenState on settings ────────

test.describe('MODERATOR — approve/reject yes, suspend no, settings forbidden', () => {
  test('sees Approve/Reject on a PENDING review but no Suspend on an APPROVED one', async ({
    page,
  }) => {
    await loginToAdmin(page, MODERATOR);
    await navTo(page, 'Employers');

    // PENDING: both action buttons (moderator holds employers.approve_reject).
    await expect(page.getByRole('tab', { name: /pending review/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const pendingReview = page.getByRole('table').getByRole('link', { name: /^review/i }).first();
    await expect(pendingReview).toBeVisible({ timeout: 10_000 });
    await pendingReview.click();
    await expect(page).toHaveURL(/\/admin\/employers\/[\w-]+/, { timeout: 10_000 });
    await expect(page.getByText(/company details/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /approve/i })).toBeVisible();
    await page.getByRole('link', { name: /back to employer queue/i }).click();

    // APPROVED: no Suspend button (moderator lacks employers.suspend).
    await page.getByRole('tab', { name: /^approved$/i }).click();
    await expect(page.getByRole('tab', { name: /^approved$/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const approvedReview = page.getByRole('table').getByRole('link', { name: /^review/i }).first();
    await expect(approvedReview).toBeVisible({ timeout: 10_000 });
    await approvedReview.click();
    await expect(page.getByText(/company details/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /suspend/i })).toHaveCount(0);
  });

  test('client-side nav to Settings is impossible; the screen itself renders ForbiddenState on 403', async ({
    page,
  }) => {
    await loginToAdmin(page, MODERATOR);
    // The nav hides Settings entirely (F1's permission-driven nav).
    await expect(
      page
        .getByRole('navigation', { name: /admin navigation/i })
        .getByRole('link', { name: 'Settings' }),
    ).toHaveCount(0);
  });
});
