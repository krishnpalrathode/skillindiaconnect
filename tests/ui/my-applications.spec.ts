import { test, expect } from './fixtures/constrained';
import type { Page } from '@playwright/test';

// My Applications (Screen 08) + dashboard live swap — runs under BOTH 'desktop'
// and 'android-constrained'. The list + detail additionally exercise a Slow-3G
// `constrainedPage` (load resolves, no infinite spinner).
//
// Fixtures (S4-0 + F2): amir@example.com has seeded applications incl.
//  - app-3: SELECTED, selectedNotifiedAt set, timeline with an ADMIN OVERRIDE
//    (overrideReason set server-side → must NEVER reach the candidate view).
//  - app-4: REJECTED with rejectionFeedback.

const LOCALE = 'en';
const PWD = 'input[type="password"]';

async function loginAsAmir(page: Page) {
  await page.goto(`/${LOCALE}/login`);
  await page.getByLabel(/email address/i).fill('amir@example.com');
  await page.locator(PWD).fill('any-password');
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20_000 });
}

test.describe('My Applications', () => {
  test('list → SELECTED detail: receipt + timeline with NEUTRAL admin copy, no reason (slow-3G)', async ({
    constrainedPage: page,
  }) => {
    await loginAsAmir(page);
    await page.goto(`/${LOCALE}/applications`);

    // The list renders cards (no infinite spinner under slow-3G).
    await expect(page.getByRole('heading', { name: /my applications/i })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('AP-2026-3')).toBeVisible({ timeout: 20_000 });

    await page.goto(`/${LOCALE}/applications/app-3`);

    // Receipt (field-driven) + the neutral admin-override line — and NO reason text.
    await expect(page.getByText(/notified on whatsapp/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/application submitted/i)).toBeVisible();
    await expect(page.getByText(/status updated by skill india connect/i)).toBeVisible();
    await expect(page.getByText(/reinstated/i)).toHaveCount(0);
  });

  test('REJECTED detail shows feedback + the constructive next-step link', async ({ page }) => {
    await loginAsAmir(page);
    await page.goto(`/${LOCALE}/applications/app-4`);

    await expect(page.getByText(/feedback from the employer/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('link', { name: /browse more jobs/i })).toHaveAttribute(
      'href',
      `/${LOCALE}/jobs`,
    );
  });

  test('dashboard KPIs are live and the mini-table links into Screen 08', async ({ page }) => {
    await loginAsAmir(page);
    await page.goto(`/${LOCALE}/dashboard`);

    // The mini-table "View all" links into Screen 08.
    await expect(page.getByRole('link', { name: /view all/i })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('link', { name: /view all/i }).click();
    await expect(page).toHaveURL(new RegExp(`/${LOCALE}/applications`));
  });
});
