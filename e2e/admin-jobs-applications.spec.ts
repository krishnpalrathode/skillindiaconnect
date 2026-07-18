import { test, expect, type Page } from '@playwright/test';

/**
 * S6b-F2 E2E — Jobs moderation + Application Management (Screen 26).
 * DESKTOP project only (internal back-office tool).
 *
 * BROWSER-WALK (flagged class GET /admin/*): the jobs queue + review detail +
 * the application explorer render with NO /admin 404s; an approve round-trips
 * to ACTIVE; AT LEAST ONE GATE FAILURE IS TRIGGERED LIVE and renders its
 * explainer — including the cross-screen story: Screen 28 flips a
 * worker-protection rule and Screen 26's explainer immediately names one
 * fewer rule. An override + a note + a resend round-trip on Screen 26.
 *
 * Mock db state is per browser context — the approval/reject/override in one
 * test cannot leak into another.
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

function watch404s(page: Page): string[] {
  const notFound: string[] = [];
  page.on('response', (r) => {
    if (r.status() === 404 && r.url().includes('/api/v1/admin/')) {
      notFound.push(`404: ${r.url()}`);
    }
  });
  return notFound;
}

test.beforeEach(({ page }, testInfo) => {
  const width = testInfo.project.use.viewport?.width ?? 1280;
  test.skip(width < 1024, 'Admin console is desktop-only.');
});

// ─── BROWSER-WALK 1: dashboard queue → filtered list → review → approve ──────

test('jobs: the dashboard queue lands filtered, the review detail renders, an approve goes live', async ({
  page,
}) => {
  const notFound = watch404s(page);
  await login(page, ADMIN);

  // The dashboard's queue card deep-links WITH the filter — count = destination.
  await page.getByRole('link', { name: /jobs awaiting review/i }).click();
  await page.waitForURL((u) => u.search.includes('status=PENDING_REVIEW'), { timeout: 10_000 });

  // Landed FILTERED: the three pending fixtures, none of the active jobs.
  const table = page.getByRole('table');
  await expect(table).toBeVisible({ timeout: 15_000 });
  await expect(table.getByText('Site Supervisor (Awaiting Review)')).toBeVisible();
  await expect(
    table.getByText('Warehouse Loader (Awaiting Review — non-compliant)'),
  ).toBeVisible();
  await expect(table.getByText('General Labourer — Local Sites')).toHaveCount(0);
  // The in-screen queue banner states the same fact.
  await expect(page.getByText(/3 jobs awaiting review/i)).toBeVisible();

  // Open the compliant one — the job AS CANDIDATES WOULD SEE IT + admin facts.
  await table.getByRole('link', { name: /open site supervisor/i }).click();
  await expect(
    page.getByRole('heading', { name: 'Site Supervisor (Awaiting Review)' }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('As candidates would see it')).toBeVisible();
  await expect(page.getByText(/supervise a residential build crew/i)).toBeVisible();
  // The protection readout — all three included on this one.
  await expect(page.getByText('Included')).toHaveCount(3);
  // The re-run is stated before any click.
  await expect(page.getByText(/approval re-runs the publish gates/i)).toBeVisible();

  // Approve → confirm → live.
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve and publish' }).click();
  await expect(page.getByText(/approved — the job is now live/i)).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText('Active', { exact: true })).toBeVisible({ timeout: 10_000 });

  // Flags: a named switch that persists (the backend owns the cache bump).
  const urgent = page.getByRole('switch', { name: 'Urgent' });
  await expect(urgent).toHaveAttribute('aria-checked', 'false');
  await urgent.click();
  await expect(page.getByRole('switch', { name: 'Urgent' })).toHaveAttribute(
    'aria-checked',
    'true',
    { timeout: 10_000 },
  );

  expect(notFound).toHaveLength(0);
  await page.screenshot({ path: 'e2e/screenshots/admin-jobs-browser-walk.png' });
});

// ─── BROWSER-WALK 2: THE LIVE GATE FAILURE + the Screen 28 cross-screen story ─

test('gate failure LIVE: the explainer names the rules, Screen 28 changes them, reject resolves it', async ({
  page,
}) => {
  const notFound = watch404s(page);
  await login(page, SUPER_ADMIN);

  // Straight to the non-compliant pending job.
  await page
    .getByRole('navigation', { name: /admin navigation/i })
    .getByRole('link', { name: 'Jobs' })
    .click();
  const table = page.getByRole('table');
  await expect(table).toBeVisible({ timeout: 15_000 });
  await table.getByRole('link', { name: /open warehouse loader/i }).click();
  await expect(
    page.getByRole('heading', { name: /warehouse loader/i }),
  ).toBeVisible({ timeout: 10_000 });
  // The panel already shows the protection truth: two benefits missing.
  await expect(page.getByText('Missing')).toHaveCount(2);

  // Approve attempt 1 → the explainer NAMES BOTH live rules from the meta.
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve and publish' }).click();
  const alert = page.getByRole('alert');
  await expect(alert.getByText('A worker-protection rule blocks this job')).toBeVisible({
    timeout: 10_000,
  });
  await expect(alert.getByText(/health insurance required/i)).toBeVisible();
  await expect(alert.getByText(/transportation required/i)).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/admin-jobs-gate-failure.png' });

  // THE CROSS-SCREEN STORY: Screen 28 flips "Require transportation" OFF…
  await page
    .getByRole('navigation', { name: /admin navigation/i })
    .getByRole('link', { name: 'Settings' })
    .click();
  await page.getByRole('tab', { name: /worker protection/i }).click();
  await page.getByRole('switch', { name: /require transportation/i }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  const coreDialog = page.getByRole('dialog');
  await expect(coreDialog.getByText(/weakens worker protection/i)).toBeVisible();
  await coreDialog.getByRole('button', { name: /turn it off/i }).click();
  await expect(page.getByText('Saved.')).toBeVisible({ timeout: 10_000 });

  // …and Screen 26's SAME approval now fails naming ONE fewer rule — the
  // gates read the LIVE settings, not a submission-time snapshot.
  await page
    .getByRole('navigation', { name: /admin navigation/i })
    .getByRole('link', { name: 'Jobs' })
    .click();
  await expect(page.getByRole('table')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('table').getByRole('link', { name: /open warehouse loader/i }).click();
  await expect(page.getByRole('heading', { name: /warehouse loader/i })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve and publish' }).click();
  const alert2 = page.getByRole('alert');
  await expect(alert2.getByText(/health insurance required/i)).toBeVisible({ timeout: 10_000 });
  await expect(alert2.getByText(/transportation required/i)).toHaveCount(0);

  // The remedy, INLINE: reject with an employer-visible reason.
  await alert2.getByRole('button', { name: /reject with a reason/i }).click();
  const rejectDialog = page.getByRole('dialog');
  await expect(rejectDialog.getByText(/this reason is shown to the employer/i)).toBeVisible();
  const confirmReject = rejectDialog.getByRole('button', { name: 'Reject job' });
  await expect(confirmReject).toBeDisabled(); // mandatory reason
  await rejectDialog
    .getByLabel('Reason')
    .fill('Health insurance must be included before this job can go live.');
  await confirmReject.click();
  await expect(page.getByText(/rejected — the job returned/i)).toBeVisible({ timeout: 10_000 });
  // The refetched truth: DRAFT, with the employer-visible reason on record.
  await expect(page.getByText('Draft', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/health insurance must be included/i)).toBeVisible();

  expect(notFound).toHaveLength(0);
});

// ─── BROWSER-WALK 3: the application explorer — resend, override, note ────────

test('applications: override indicator → detail → resend with reason → override → note', async ({
  page,
}) => {
  const notFound = watch404s(page);
  await login(page, ADMIN);

  await page
    .getByRole('navigation', { name: /admin navigation/i })
    .getByRole('link', { name: 'Applications' })
    .click();
  const table = page.getByRole('table');
  await expect(table).toBeVisible({ timeout: 15_000 });

  // The override indicator sits on the overridden row (seeded on AP-2026-3).
  const overriddenRow = table.locator('tr', { hasText: 'AP-2026-3' });
  await expect(overriddenRow.getByText('Admin override')).toBeVisible();

  // Open it — the FULL record.
  await table.getByRole('link', { name: /open application AP-2026-3/i }).click();
  await expect(page.getByRole('heading', { name: 'AP-2026-3' })).toBeVisible({ timeout: 10_000 });
  // The timeline shows the override WITH its reason — the admin-only content.
  await expect(page.getByText(/Candidate reinstated after internal review/)).toBeVisible();
  // The notification state: the automated WhatsApp already fired.
  await expect(page.getByText(/^Sent /)).toBeVisible();

  // RESEND (on the SELECTED application): reason mandatory, honest copy.
  await page.getByRole('button', { name: /resend whatsapp/i }).click();
  const resendDialog = page.getByRole('dialog');
  await expect(
    resendDialog.getByText(/sends a whatsapp message to amir khan's phone/i),
  ).toBeVisible();
  await expect(
    resendDialog.getByText(/original notification date won't change/i),
  ).toBeVisible();
  const sendBtn = resendDialog.getByRole('button', { name: 'Send WhatsApp' });
  await expect(sendBtn).toBeDisabled();
  await resendDialog.getByLabel('Reason').fill('Candidate reported the message never arrived.');
  await sendBtn.click();
  await expect(page.getByText(/queued for delivery/i)).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Done' }).click();

  // OVERRIDE: the dialog tells the visibility truth; the timeline then shows it.
  await page.getByRole('button', { name: /change status/i }).click();
  const overrideDialog = page.getByRole('dialog');
  await expect(
    overrideDialog.getByText(/candidate sees only a neutral entry/i),
  ).toBeVisible();
  await overrideDialog.getByLabel('New status').selectOption('SHORTLISTED');
  const confirmOverride = overrideDialog.getByRole('button', { name: 'Change status' });
  await expect(confirmOverride).toBeDisabled(); // mandatory reason
  await overrideDialog
    .getByLabel('Reason')
    .fill('Employer selected by mistake — moving back while they re-interview.');
  await confirmOverride.click();
  // Refetched (not optimistic): the new override entry with ITS reason.
  await expect(
    page.getByText(/moving back while they re-interview/i),
  ).toBeVisible({ timeout: 10_000 });

  // NOTE: labeled internal, and it round-trips.
  await expect(
    page.getByText('Internal — never shown to the candidate or employer.'),
  ).toBeVisible();
  await page
    .getByPlaceholder(/add a note for the admin team/i)
    .fill('Called the employer; they will re-interview this week.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(
    page.getByText('Called the employer; they will re-interview this week.'),
  ).toBeVisible({ timeout: 10_000 });

  expect(notFound).toHaveLength(0);
  await page.screenshot({ path: 'e2e/screenshots/admin-applications-browser-walk.png' });
});
