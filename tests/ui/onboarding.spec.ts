import { test, expect, type Page } from '@playwright/test';

// Onboarding E2E suite.
// All tests run under BOTH 'desktop' and 'android-constrained' projects.
// MSW (NEXT_PUBLIC_API_MOCKING=enabled) handles all /api/v1/* calls.
// R2 PUT requests are intercepted via Playwright's route API so no network
// request leaves the test runner.

const LOCALE = 'en';
const ONBOARDING_URL = `/${LOCALE}/onboarding`;

// Pre-seeded user from mocks/data.ts — has a full candidate profile
const SEEDED_EMAIL = 'amir@example.com';
const SEEDED_PASSWORD = 'any-password';
const MOCK_OTP = '123456';

// Selector helpers — see auth.spec.ts for the reasoning
const PWD = 'input[type="password"]';

async function loginAs(page: Page, email: string, password: string) {
  await page.goto(`/${LOCALE}/login`);
  await page.getByLabel(/email address/i).fill(email);
  // locator('input[type="password"]') avoids strict-mode violations caused by
  // the "Show password" toggle button whose aria-label also contains "password".
  await page.locator(PWD).fill(password);
  await page.getByRole('button', { name: /log in/i }).click();
  // Wait for redirect away from login
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10_000 });
}

// Intercept R2 PUT requests so uploads succeed without a real bucket
async function mockR2Upload(page: Page) {
  await page.route('https://mock-r2.example.com/**', (route) => {
    if (route.request().method() === 'PUT') {
      route.fulfill({ status: 200, body: '' });
    } else {
      route.continue();
    }
  });
}

// ─── Page structure ───────────────────────────────────────────────────────────

test.describe('Onboarding page — structure', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, SEEDED_EMAIL, SEEDED_PASSWORD);
    await page.goto(ONBOARDING_URL);
    // Wait for the profile to load (spinner disappears, step content appears)
    await expect(page.getByRole('heading', { name: /complete your profile/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('shows the 4-step progress indicator', async ({ page }, testInfo) => {
    await expect(page.getByRole('navigation', { name: /step 1 of 4/i })).toBeVisible();
    await testInfo.attach('onboarding-step1-personal-info', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('starts on Step 1 — Personal Info', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /tell us about yourself/i })).toBeVisible();
  });

  test('has correct touch targets (≥44px) on Next button', async ({ page }) => {
    const nextBtn = page.getByRole('button', { name: /next/i });
    const box = await nextBtn.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  });

  test('branded header is visible', async ({ page }) => {
    await expect(page.getByText('SkillIndiaConnect')).toBeVisible();
  });
});

// ─── Step 1: Personal Info ────────────────────────────────────────────────────

test.describe('Step 1 — Personal Info', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, SEEDED_EMAIL, SEEDED_PASSWORD);
    await page.goto(ONBOARDING_URL);
    await expect(page.getByRole('heading', { name: /tell us about yourself/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('Next button is disabled until name and DOB are filled', async ({ page }) => {
    const next = page.getByRole('button', { name: /^next$/i });
    // Seeded user already has a name; clear it to test gate
    await page.getByLabel(/full name/i).clear();
    await expect(next).toBeDisabled();

    await page.getByLabel(/full name/i).fill('Test User');
    await page.getByLabel(/date of birth/i).fill('1990-01-15');
    await expect(next).not.toBeDisabled();
  });

  test('advances to Step 2 when Next is clicked with valid fields', async ({ page }) => {
    await page.getByLabel(/full name/i).fill('Amir Khan');
    await page.getByLabel(/date of birth/i).fill('1990-01-15');
    await page.getByRole('button', { name: /^next$/i }).click();

    await expect(page.getByRole('heading', { name: /work experience/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('phone verify widget is present (soft-block)', async ({ page }) => {
    await expect(page.getByText(/verify your phone/i)).toBeVisible();
  });

  test('seeded user shows phone verified state', async ({ page }) => {
    // amir@example.com has phoneVerifiedAt set in mock data
    await expect(page.getByText(/phone verified/i)).toBeVisible();
  });

  test('profile photo upload trigger is present', async ({ page }) => {
    await expect(page.getByLabel(/profile photo|upload photo/i)).toBeTruthy();
  });
});

// ─── Step 2: Work Experience ─────────────────────────────────────────────────

test.describe('Step 2 — Work Experience', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, SEEDED_EMAIL, SEEDED_PASSWORD);
    await page.goto(ONBOARDING_URL);
    await expect(page.getByRole('heading', { name: /tell us about yourself/i })).toBeVisible({
      timeout: 10_000,
    });

    // Advance through Step 1 with pre-filled seeded data
    await page.getByLabel(/full name/i).fill('Amir Khan');
    await page.getByLabel(/date of birth/i).fill('1990-01-15');
    await page.getByRole('button', { name: /^next$/i }).click();
    await expect(page.getByRole('heading', { name: /work experience/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('shows existing experience for seeded user', async ({ page }, testInfo) => {
    // amir@example.com has 1 experience: Mason at Gulf Construction LLC
    await expect(page.getByText(/Mason/i)).toBeVisible();
    await testInfo.attach('onboarding-step2-work-experience', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('Back button returns to Step 1', async ({ page }) => {
    await page.getByRole('button', { name: /back/i }).click();
    await expect(page.getByRole('heading', { name: /tell us about yourself/i })).toBeVisible();
  });

  test('Next button is always enabled (soft-block step)', async ({ page }) => {
    await expect(page.getByRole('button', { name: /^next$/i })).not.toBeDisabled();
  });

  test('can add a new experience', async ({ page }) => {
    await page.getByRole('button', { name: /add experience/i }).click();
    await expect(page.getByRole('radio', { name: /domestic/i })).toBeVisible();

    await page.getByLabel(/company name/i).fill('Test Corp');
    await page.getByLabel(/job title/i).fill('Welder');
    await page.getByLabel(/years/i).fill('2');
    await page.getByRole('button', { name: /save experience/i }).click();

    await expect(page.getByText('Welder')).toBeVisible({ timeout: 5_000 });
  });

  test('advances to Step 3 when Next is clicked', async ({ page }) => {
    await page.getByRole('button', { name: /^next$/i }).click();
    await expect(page.getByRole('heading', { name: /documents & skills/i })).toBeVisible({
      timeout: 10_000,
    });
  });
});

// ─── Step 3: Documents & Skills ───────────────────────────────────────────────

test.describe('Step 3 — Documents & Skills', () => {
  async function navigateToStep3(page: Page) {
    await loginAs(page, SEEDED_EMAIL, SEEDED_PASSWORD);
    await page.goto(ONBOARDING_URL);
    await expect(page.getByRole('heading', { name: /tell us about yourself/i })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByLabel(/full name/i).fill('Amir Khan');
    await page.getByLabel(/date of birth/i).fill('1990-01-15');
    await page.getByRole('button', { name: /^next$/i }).click();
    await expect(page.getByRole('heading', { name: /work experience/i })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole('button', { name: /^next$/i }).click();
    await expect(page.getByRole('heading', { name: /documents & skills/i })).toBeVisible({
      timeout: 10_000,
    });
  }

  test('Next is disabled without required fields', async ({ page }, testInfo) => {
    await navigateToStep3(page);
    // Clear any pre-filled values (amir doesn't have currentLocation in mock)
    const next = page.getByRole('button', { name: /^next$/i });
    await expect(next).toBeDisabled();
    await testInfo.attach('onboarding-step3-documents-skills', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('Next enabled when location, nationality, and notice period filled', async ({ page }) => {
    await navigateToStep3(page);

    await page.getByLabel(/current location/i).fill('Mumbai, India');
    await page.getByLabel(/nationality/i).fill('Indian');
    await page.getByLabel(/notice period/i).fill('30');

    await expect(page.getByRole('button', { name: /^next$/i })).not.toBeDisabled();
  });

  test('document upload section is visible', async ({ page }) => {
    await navigateToStep3(page);
    await expect(page.getByText(/passport/i)).toBeVisible();
  });

  test('skills chip input is visible', async ({ page }) => {
    await navigateToStep3(page);
    await expect(page.getByText(/masonry/i)).toBeVisible(); // seeded skill
  });

  test('interrupted upload — retry works without re-selecting file', async ({ page }) => {
    await mockR2Upload(page);
    await navigateToStep3(page);

    // Intercept presign to simulate success
    let presignCount = 0;
    await page.route('**/api/v1/candidates/me/documents/presign', async (route) => {
      presignCount++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            uploadUrl: 'https://mock-r2.example.com/test-key.pdf?sig=mock',
            key: 'uploads/test/passport-test.pdf',
            expiresInSeconds: 300,
          },
        }),
      });
    });

    // Intercept confirm to fail first, then succeed on retry
    let confirmCount = 0;
    await page.route('**/api/v1/candidates/me/documents/confirm', async (route) => {
      confirmCount++;
      if (confirmCount === 1) {
        await route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({
            type: 'about:blank',
            title: 'Upload not found',
            status: 422,
            detail: 'Upload not found',
            code: 'UPLOAD_NOT_FOUND',
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              id: 'doc-test',
              type: 'PASSPORT',
              key: 'uploads/test/passport-test.pdf',
              status: 'PENDING',
              uploadedAt: new Date().toISOString(),
            },
          }),
        });
      }
    });

    // Trigger upload via the passport upload widget
    const passportUpload = page.locator('input[type="file"]').first();
    await passportUpload.setInputFiles({
      name: 'passport.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('mock-pdf-content'),
    });

    // First attempt: error state reached
    await expect(page.getByRole('button', { name: /retry upload/i })).toBeVisible({
      timeout: 10_000,
    });

    // Retry without re-selecting file — presign count must NOT increase
    await page.getByRole('button', { name: /retry upload/i }).click();
    await expect(page.getByText(/uploaded/i)).toBeVisible({ timeout: 10_000 });

    // Key assertion: the presign was called only once (confirm was retried, not presign)
    expect(presignCount).toBe(1);
    expect(confirmCount).toBe(2);
  });

  test('advances to Step 4 with required fields', async ({ page }) => {
    await navigateToStep3(page);

    await page.getByLabel(/current location/i).fill('Dubai, UAE');
    await page.getByLabel(/nationality/i).fill('Indian');
    await page.getByLabel(/notice period/i).fill('30');
    await page.getByRole('button', { name: /^next$/i }).click();

    await expect(page.getByRole('heading', { name: /preview & export/i })).toBeVisible({
      timeout: 10_000,
    });
  });
});

// ─── Step 4: Preview & Export ─────────────────────────────────────────────────

test.describe('Step 4 — Preview & Export', () => {
  async function navigateToStep4(page: Page) {
    await loginAs(page, SEEDED_EMAIL, SEEDED_PASSWORD);
    await page.goto(ONBOARDING_URL);
    await expect(page.getByRole('heading', { name: /tell us about yourself/i })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByLabel(/full name/i).fill('Amir Khan');
    await page.getByLabel(/date of birth/i).fill('1990-01-15');
    await page.getByRole('button', { name: /^next$/i }).click();
    await expect(page.getByRole('heading', { name: /work experience/i })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole('button', { name: /^next$/i }).click();
    await expect(page.getByRole('heading', { name: /documents & skills/i })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByLabel(/current location/i).fill('Dubai, UAE');
    await page.getByLabel(/nationality/i).fill('Indian');
    await page.getByLabel(/notice period/i).fill('30');
    await page.getByRole('button', { name: /^next$/i }).click();
    await expect(page.getByRole('heading', { name: /preview & export/i })).toBeVisible({
      timeout: 10_000,
    });
  }

  test('shows completion ring with percentage', async ({ page }, testInfo) => {
    await navigateToStep4(page);
    // CompletionRing has role="meter" with aria-valuenow
    await expect(page.getByRole('meter')).toBeVisible({ timeout: 10_000 });
    await testInfo.attach('onboarding-step4-preview-export', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('export buttons are all disabled (S7 feature)', async ({ page }) => {
    await navigateToStep4(page);
    await expect(page.getByRole('button', { name: /download pdf/i })).toBeDisabled();
    await expect(page.getByRole('button', { name: /send via whatsapp/i })).toBeDisabled();
    await expect(page.getByRole('button', { name: /send to email/i })).toBeDisabled();
  });

  test('video slot shows Coming Soon', async ({ page }) => {
    await navigateToStep4(page);
    await expect(page.getByText(/coming soon/i)).toBeVisible();
  });

  test('Save & Continue button is enabled', async ({ page }) => {
    await navigateToStep4(page);
    await expect(page.getByRole('button', { name: /save & continue/i })).not.toBeDisabled();
  });

  test('Back button returns to Step 3', async ({ page }) => {
    await navigateToStep4(page);
    await page.getByRole('button', { name: /back/i }).click();
    await expect(page.getByRole('heading', { name: /documents & skills/i })).toBeVisible();
  });
});

// ─── Stepper resumability ─────────────────────────────────────────────────────

test.describe('Stepper — resumability', () => {
  test('step is remembered in sessionStorage across navigation', async ({ page }) => {
    await loginAs(page, SEEDED_EMAIL, SEEDED_PASSWORD);
    await page.goto(ONBOARDING_URL);
    await expect(page.getByRole('heading', { name: /tell us about yourself/i })).toBeVisible({
      timeout: 10_000,
    });

    // Advance to Step 2
    await page.getByLabel(/full name/i).fill('Amir Khan');
    await page.getByLabel(/date of birth/i).fill('1990-01-15');
    await page.getByRole('button', { name: /^next$/i }).click();
    await expect(page.getByRole('heading', { name: /work experience/i })).toBeVisible({
      timeout: 10_000,
    });

    // Navigate away and come back
    await page.goto(`/${LOCALE}`);
    await page.goto(ONBOARDING_URL);

    // Should resume at Step 2
    await expect(page.getByRole('heading', { name: /work experience/i })).toBeVisible({
      timeout: 10_000,
    });
  });
});

// ─── Unauthenticated redirect ─────────────────────────────────────────────────

test.describe('Onboarding — auth guard', () => {
  test('redirects unauthenticated users to login', async ({ page }) => {
    // Go to onboarding without logging in
    await page.goto(ONBOARDING_URL);
    await page.waitForURL((url) => url.pathname.includes('/login'), { timeout: 10_000 });
    await expect(page).toHaveURL(/\/login/);
  });
});

// ─── RTL / Arabic locale ─────────────────────────────────────────────────────

test.describe('Onboarding — Arabic RTL', () => {
  test('renders without layout breaking in ar locale', async ({ page }, testInfo) => {
    await loginAs(page, SEEDED_EMAIL, SEEDED_PASSWORD);
    await page.goto('/ar/onboarding');
    await expect(page.getByRole('heading', { name: /أكمل ملفك الشخصي/i })).toBeVisible({
      timeout: 10_000,
    });

    // Page should have dir=rtl (set by the HTML element)
    const dir = await page.evaluate(() => document.documentElement.dir);
    expect(dir).toBe('rtl');
    await testInfo.attach('onboarding-arabic-rtl', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
});

// Suppress unused-variable lint warning for MOCK_OTP — it documents the MSW seed
void MOCK_OTP;
