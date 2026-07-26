import { test, expect } from './fixtures/constrained';
import type { Page } from '@playwright/test';

// Step-4 export hub (S7-F1) E2E — runs under BOTH the 'desktop' and
// 'android-constrained' projects (playwright.config.ts). The generate→download
// path additionally runs on a Slow-3G + 4×-CPU `constrainedPage` so the async
// poll resolves (no infinite spinner) under the candidate-device budget.
//
// The resume PDF renders worker-side and the mock delays the READY flip for a
// few status polls (RESUME_GENERATION_POLL_THRESHOLD) — so this walks the real
// polling UX, not an instant download. With S7-B1/B2 live the signed url yields
// a real Chromium-rendered PDF; against the shared mocks the url is a stub, so
// we assert the flow REACHES the READY state (proof generate+status resolved).

const LOCALE = 'en';
const PWD = 'input[type="password"]';
// Amir Khan — a candidate with phone, a passport document, experience + skills
// (a rich preview). userId is stable in the shared fixtures.
const AMIR_EMAIL = 'amir@example.com';
const AMIR_USER_ID = 'mock-user-candidate-1';

async function loginAs(page: Page, email: string) {
  await page.goto(`/${LOCALE}/login`);
  await page.getByLabel(/email address/i).fill(email);
  await page.locator(PWD).fill('any-password');
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20_000 });
}

/** Land directly on Step 4 by seeding the resumable-step key the stepper reads. */
async function gotoStep4(page: Page) {
  await page.addInitScript((userId) => {
    try {
      sessionStorage.setItem(`sic_onboarding_step_${userId}`, '4');
    } catch {
      /* private mode — the step just won't persist */
    }
  }, AMIR_USER_ID);
  // A READY resume tries to open the signed url in a new tab; close any popup so
  // the (stub) url can't leave a dangling page.
  page.on('popup', (p) => p.close().catch(() => undefined));
  await page.goto(`/${LOCALE}/onboarding`);
}

test.describe('Resume export hub (Step 4)', () => {
  test('preview renders, Download runs the async generate→poll→READY flow, Save & Continue → /dashboard', async ({
    page,
  }) => {
    await loginAs(page, AMIR_EMAIL);
    await gotoStep4(page);

    // The live PREVIEW is present and labelled as a preview (not the artifact).
    await expect(page.getByText(/download the PDF for the final document/i)).toBeVisible({
      timeout: 20_000,
    });

    // Download → the honest generating state → then READY (no false-instant).
    await page.getByRole('button', { name: /download pdf/i }).click();
    await expect(page.getByText(/generating your resume/i)).toBeVisible();
    await expect(page.getByText(/your resume is ready/i)).toBeVisible({ timeout: 20_000 });

    // Onboarding still completes — the resume was optional, and this proves the
    // Save & Continue → /dashboard flow is intact even after generating.
    await page.getByRole('button', { name: /save & continue/i }).click();
    await page.waitForURL((url) => url.pathname.includes('/dashboard'), { timeout: 20_000 });
  });

  test('onboarding completes WITHOUT generating a resume (resume is non-blocking)', async ({
    page,
  }) => {
    await loginAs(page, AMIR_EMAIL);
    await gotoStep4(page);

    await expect(page.getByText(/download the PDF for the final document/i)).toBeVisible({
      timeout: 20_000,
    });

    // Skip Download entirely — Save & Continue must still reach /dashboard.
    await page.getByRole('button', { name: /save & continue/i }).click();
    await page.waitForURL((url) => url.pathname.includes('/dashboard'), { timeout: 20_000 });
  });

  test('constrained: generate→READY resolves under Slow-3G without a hung spinner', async ({
    constrainedPage: page,
  }) => {
    await loginAs(page, AMIR_EMAIL);
    await gotoStep4(page);

    await expect(page.getByText(/download the PDF for the final document/i)).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: /download pdf/i }).click();
    await expect(page.getByText(/generating your resume/i)).toBeVisible({ timeout: 30_000 });
    // The poll must SETTLE (READY) — never an infinite spinner under throttling.
    await expect(page.getByText(/your resume is ready/i)).toBeVisible({ timeout: 40_000 });
  });
});
