import { test, expect, type Page } from '@playwright/test';

// S3-F2 — Employer dashboard (real swap) + candidate browse + candidate view.
// Runs under BOTH 'desktop' and 'android-constrained' Playwright projects
// (recruiters on phones are common in this market).
// MSW (NEXT_PUBLIC_API_MOCKING=enabled) handles all /api/v1/* calls and encodes
// the privacy behaviors (omitted phone/religion, invisible-404, browse exclusion).
//
// BROWSER-WALK gate (flagged endpoint GET /employers/candidates/{id}): console
// 404s are monitored on the happy path; opening a real candidate must resolve
// with no /api/v1/ 404s. The invisible-candidate case (an EXPECTED 404) is
// asserted separately, without the monitor.

const LOCALE = 'en';
const EMPLOYER_LOGIN_URL = `/${LOCALE}/employer-login`;
const DASHBOARD_URL = `/${LOCALE}/employer/dashboard`;
const CANDIDATES_URL = `/${LOCALE}/employer/candidates`;

const EMPLOYER_APPROVED_EMAIL = 'employer@example.com';
const PASSWORD = 'any-password';
const PWD = 'input[type="password"]';

// Candidate fixtures (keyed by user id in the mock db)
const AMIR_ID = 'mock-user-candidate-1'; // showPhone = true
const PRIYA_ID = 'mock-user-no-wa'; // showPhone = false
const HIDDEN_ID = 'mock-user-candidate-hidden'; // profileVisible = false → 404

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function login(page: Page) {
  await page.goto(EMPLOYER_LOGIN_URL);
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });
  await page.getByLabel(/work email/i).fill(EMPLOYER_APPROVED_EMAIL);
  await page.locator(PWD).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
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

// ─── Dashboard (real swap) ──────────────────────────────────────────────────────

test.describe('S3-F2 — Employer dashboard', () => {
  test('shows live KPIs and honest-zero application metrics', async ({ page }) => {
    await login(page);
    await page.goto(DASHBOARD_URL);

    // Live KPI labels present
    await expect(page.getByText(/active jobs/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/total job views/i)).toBeVisible();

    // Honest-zero affordance for application metrics (not hidden, not fabricated)
    await expect(page.getByText(/available once applications open/i).first()).toBeVisible();
  });
});

// ─── Candidate browse + view (browser-walk gate) ────────────────────────────────

test.describe('S3-F2 — Candidate browse & view', () => {
  test('browse → open candidate → view renders, no API 404s (browser-walk)', async ({
    page,
  }, testInfo) => {
    const getNotFound = installApi404Monitor(page);
    await login(page);
    await page.goto(CANDIDATES_URL);

    // Cards render
    await expect(page.getByRole('link', { name: /amir khan/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: /rajan patel/i })).toBeVisible();

    // Open a candidate
    await page.getByRole('link', { name: /amir khan/i }).click();

    // View renders: header + documents status
    await expect(page.getByRole('heading', { name: 'Amir Khan', level: 1 })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('region', { name: /documents/i })).toBeVisible();
    // Amir has showPhone = true → phone row present
    await expect(page.getByText('+919876543210')).toBeVisible();

    await testInfo.attach('candidate-view', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    // BROWSER-WALK gate: no /api/v1/ 404s on the happy path
    expect(getNotFound()).toEqual([]);
  });

  test('category filter narrows the result set', async ({ page }) => {
    await login(page);
    await page.goto(CANDIDATES_URL);

    await expect(page.getByRole('link', { name: /rajan patel/i })).toBeVisible({ timeout: 15_000 });

    // Rajan is the construction candidate; filtering should keep him and drop others
    await page.getByLabel(/category/i).selectOption('cat-construction');

    await expect(page.getByRole('link', { name: /rajan patel/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /amir khan/i })).toHaveCount(0);
  });

  test('privacy mirror — a showPhone=false candidate renders no phone row', async ({ page }) => {
    await login(page);
    await page.goto(`${CANDIDATES_URL}/${PRIYA_ID}`);

    await expect(page.getByRole('heading', { name: 'Priya Sharma', level: 1 })).toBeVisible({
      timeout: 15_000,
    });
    // No phone LABEL and no phone value — omission, not a "hidden" placeholder
    await expect(page.getByText('Phone', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/hidden by candidate/i)).toHaveCount(0);
  });

  test('invisible candidate URL resolves to the not-found page', async ({ page }) => {
    await login(page);
    await page.goto(`${CANDIDATES_URL}/${HIDDEN_ID}`);

    // One not-found page for invisible and nonexistent alike (a 404 is expected
    // here, so the 404 monitor is intentionally not installed).
    await expect(page.getByText(/isn't available/i)).toBeVisible({ timeout: 15_000 });
  });

  test('candidate view documents are status-only (nothing to open)', async ({ page }) => {
    await login(page);
    await page.goto(`${CANDIDATES_URL}/${AMIR_ID}`);

    const docs = page.getByRole('region', { name: /documents/i });
    await expect(docs).toBeVisible({ timeout: 15_000 });
    // No links/buttons inside the documents card — access is S5 Pro-gated
    await expect(docs.getByRole('link')).toHaveCount(0);
    await expect(docs.getByRole('button')).toHaveCount(0);
  });
});
