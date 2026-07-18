import { test, expect } from './fixtures/constrained';
import type { Page } from '@playwright/test';

// Apply flow (Screen 10) E2E — runs under BOTH the 'desktop' and
// 'android-constrained' projects (playwright.config.ts). The eligible end-to-end
// path additionally runs on a Slow-3G + 4×-CPU `constrainedPage` so the submit
// resolves (no infinite spinner) under the candidate-device budget.
//
// Fixtures (S4-0 + F1 enrichment):
//  - apply-ok@example.com — ELIGIBLE (canApply=true), applied to NOTHING → applies
//    to job-2, sees the reveal, and "Applied" on revisit.
//  - amir@example.com     — INELIGIBLE (completion < threshold), NOT applied to
//    job-6 → the eligibility checklist → a fix link to /profile.

const LOCALE = 'en';
const PWD = 'input[type="password"]';

async function loginAs(page: Page, email: string) {
  await page.goto(`/${LOCALE}/login`);
  await page.getByLabel(/email address/i).fill(email);
  await page.locator(PWD).fill('any-password');
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20_000 });
}

test.describe('Apply flow', () => {
  test('eligible candidate applies end to end under slow-3G → reveal → "Applied" on revisit', async ({
    constrainedPage: page,
  }) => {
    await loginAs(page, 'apply-ok@example.com');
    await page.goto(`/${LOCALE}/jobs/job-2`);

    const applyCta = page.getByRole('button', { name: /apply now/i });
    await expect(applyCta).toBeEnabled({ timeout: 20_000 });
    await applyCta.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/cover letter/i).fill('I have strong Gulf masonry experience.');
    await dialog.getByRole('button', { name: /submit application/i }).click();

    // Success reveal — score + humanId + My Applications link (no infinite spinner).
    await expect(page.getByText(/you're a \d+% match/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/AP-\d{4}-\d+/)).toBeVisible();
    await expect(page.getByRole('link', { name: /track in my applications/i })).toHaveAttribute(
      'href',
      `/${LOCALE}/applications`,
    );

    // Revisit → the entry now reads "Applied" (survives revisit via the feed).
    await page.goto(`/${LOCALE}/jobs/job-2`);
    await expect(page.getByRole('link', { name: /applied/i })).toBeVisible({ timeout: 20_000 });
  });

  test('ineligible candidate sees the checklist and follows a fix link to the profile', async ({
    page,
  }) => {
    await loginAs(page, 'amir@example.com');
    await page.goto(`/${LOCALE}/jobs/job-6`);

    const cta = page.getByRole('button', { name: /complete your profile to apply/i });
    await expect(cta).toBeEnabled({ timeout: 20_000 });
    await cta.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/your profile is \d+% complete/i)).toBeVisible();

    const fix = dialog.getByRole('link', { name: /^fix$/i }).first();
    await expect(fix).toBeVisible();
    await fix.click();

    await expect(page).toHaveURL(new RegExp(`/${LOCALE}/profile`));
  });
});
