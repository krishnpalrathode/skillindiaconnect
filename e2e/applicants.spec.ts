import { test, expect } from './fixtures/constrained';
import type { Page } from '@playwright/test';

// Applicants pipeline (Screen 18) — runs under BOTH 'desktop' and
// 'android-constrained'. The pipeline + a transition additionally run on a
// Slow-3G `constrainedPage` (optimistic move renders instantly, reconciliation
// resolves, no infinite spinner).
//
// Fixtures (S4-0 + F3): employer@example.com owns job-1 (Amir SHORTLISTED, Rajan
// PENDING) and job-2 (Priya PENDING — hidden phone, showPhone=false).

const LOCALE = 'en';
const PWD = 'input[type="password"]';

async function loginAsEmployer(page: Page) {
  await page.goto(`/${LOCALE}/employer-login`);
  await page.getByLabel(/work email/i).fill('employer@example.com');
  await page.locator(PWD).fill('any-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('login'), { timeout: 20_000 });
}

test.describe('Applicants pipeline', () => {
  test('pipeline loads, shortlist then select round-trips (slow-3G)', async ({
    constrainedPage: page,
  }) => {
    await loginAsEmployer(page);
    await page.goto(`/${LOCALE}/employer/jobs/job-1/applicants`);

    await expect(page.getByRole('heading', { name: /applicants/i })).toBeVisible({
      timeout: 20_000,
    });
    // Both applicants render (match-sorted).
    await expect(page.getByText('Rajan Patel')).toBeVisible({ timeout: 20_000 });

    // Shortlist the PENDING applicant (Rajan) — one tap, optimistic move.
    await page.getByRole('button', { name: /shortlist rajan/i }).click();

    // Select the SHORTLISTED applicant (Amir) → the confirm names the one-time WhatsApp.
    await page.getByRole('button', { name: /select amir/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(/notified on whatsapp/i);
    await dialog.getByRole('button', { name: /^select$/i }).click();

    // Amir reconciles to SELECTED (terminal — its action buttons disappear).
    await expect(page.getByRole('button', { name: /select amir/i })).toHaveCount(0, {
      timeout: 20_000,
    });
  });

  test('the hidden-phone applicant renders phoneless', async ({ page }) => {
    await loginAsEmployer(page);
    await page.goto(`/${LOCALE}/employer/jobs/job-2/applicants`);

    await expect(page.getByText('Priya Sharma')).toBeVisible({ timeout: 20_000 });
    // Priya's phone (+919812345678) is hidden (showPhone=false) → never rendered.
    await expect(page.getByText(/9812345678/)).toHaveCount(0);
  });

  test('a rejected applicant carries candidate-visible feedback', async ({ page }) => {
    await loginAsEmployer(page);
    await page.goto(`/${LOCALE}/employer/jobs/job-1/applicants`);
    await expect(page.getByText('Rajan Patel')).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: /reject rajan/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(/visible to the candidate/i);
    await dialog.getByLabel(/feedback/i).fill('We went with more experienced masons.');
    await dialog.getByRole('button', { name: /^reject$/i }).click();

    // Rajan reconciles to REJECTED (terminal).
    await expect(page.getByRole('button', { name: /reject rajan/i })).toHaveCount(0, {
      timeout: 20_000,
    });
  });
});
