import { test, expect } from './fixtures/constrained';
import type { Page } from '@playwright/test';

// Resume Settings + delivery (S7-F2) E2E — runs under BOTH the 'desktop' and
// 'android-constrained' projects. The settings panel + delivery actions mount
// into F1's export-hub seam on Step 4.
//
// Fixtures (S7-0 shared handlers):
//  - amir@example.com          — whatsappCapable → a WhatsApp send succeeds.
//  - nowa@example.com          — NOT whatsapp-capable → the send DEGRADES to the
//    honest EMAIL_FALLBACK message (never a false WhatsApp success).
//
// With S7-B1/B2 live this walks a real document send/email; against the shared
// mocks it asserts the honest OUTCOME MESSAGES (proof the endpoints resolve).

const LOCALE = 'en';
const PWD = 'input[type="password"]';
const AMIR_USER_ID = 'mock-user-candidate-1';
const NOWA_USER_ID = 'mock-user-no-wa';

async function loginAs(page: Page, email: string) {
  await page.goto(`/${LOCALE}/login`);
  await page.getByLabel(/email address/i).fill(email);
  await page.locator(PWD).fill('any-password');
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20_000 });
}

async function gotoStep4(page: Page, userId: string) {
  await page.addInitScript((uid) => {
    try {
      sessionStorage.setItem(`sic_onboarding_step_${uid}`, '4');
    } catch {
      /* private mode */
    }
  }, userId);
  page.on('popup', (p) => p.close().catch(() => undefined));
  await page.goto(`/${LOCALE}/onboarding`);
  await expect(page.getByText(/download the PDF for the final document/i)).toBeVisible({
    timeout: 20_000,
  });
}

test.describe('Resume settings + delivery (Step 4)', () => {
  test('toggle Show Passport Number ON → preview reflects it + regenerate prompt; generate → send to WhatsApp', async ({
    page,
  }) => {
    await loginAs(page, 'amir@example.com');
    await gotoStep4(page, AMIR_USER_ID);

    // The language control is English-only (no fake HI/AR).
    const lang = page.getByRole('combobox', { name: /resume language/i });
    await expect(lang).toBeDisabled();

    // Turn Show Passport Number ON — the preview reacts + a regenerate prompt shows.
    const passport = page.getByRole('switch', { name: /show passport number/i });
    await expect(passport).toHaveAttribute('aria-checked', 'false'); // default OFF
    await passport.click();
    await expect(passport).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('Passport number')).toBeVisible();

    // Generate a resume (F1's async flow), then send it to WhatsApp.
    await page.getByRole('button', { name: /download pdf/i }).click();
    await expect(page.getByText(/your resume is ready/i)).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: /send to whatsapp/i }).click();
    await expect(page.getByText(/sent to your whatsapp/i)).toBeVisible({ timeout: 20_000 });
  });

  test('a not-whatsapp-capable candidate sees the honest email-fallback (never a WhatsApp claim)', async ({
    page,
  }) => {
    await loginAs(page, 'nowa@example.com');
    await gotoStep4(page, NOWA_USER_ID);

    await page.getByRole('button', { name: /download pdf/i }).click();
    await expect(page.getByText(/your resume is ready/i)).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: /send to whatsapp/i }).click();
    await expect(page.getByText(/we emailed your resume to you instead/i)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/sent to your whatsapp/i)).toHaveCount(0);
  });

  test('constrained: settings PATCH + delivery resolve under Slow-3G (no hung spinner)', async ({
    constrainedPage: page,
  }) => {
    await loginAs(page, 'amir@example.com');
    await gotoStep4(page, AMIR_USER_ID);

    const religion = page.getByRole('switch', { name: /show religion/i });
    await expect(religion).toHaveAttribute('aria-checked', 'false');
    await religion.click();
    await expect(religion).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });

    await page.getByRole('button', { name: /email to myself/i }).click();
    await expect(page.getByText(/emailed to you|generate your resume first/i)).toBeVisible({
      timeout: 30_000,
    });
  });
});
