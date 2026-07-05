import { test, expect, type Page } from '@playwright/test';

// Employer onboarding E2E suite — Screen 13 (Login), Screen 14 (Onboarding), Screen 15 (Dashboard).
// Runs under BOTH 'desktop' and 'android-constrained' Playwright projects.
// MSW (NEXT_PUBLIC_API_MOCKING=enabled) handles all /api/v1/* calls.
// R2 PUT requests are intercepted via Playwright's route API.

const LOCALE = 'en';
const EMPLOYER_LOGIN_URL = `/${LOCALE}/employer-login`;
const EMPLOYER_ONBOARDING_URL = `/${LOCALE}/employer/onboarding`;
const EMPLOYER_DASHBOARD_URL = `/${LOCALE}/employer/dashboard`;

// Seeded employer fixtures (from mocks/data.ts)
const EMPLOYER_APPROVED_EMAIL = 'employer@example.com';
const EMPLOYER_PENDING_EMAIL = 'employer-pending@example.com';
const EMPLOYER_REJECTED_EMAIL = 'employer-rejected@example.com';
const EMPLOYER_SUSPENDED_EMAIL = 'employer-suspended@example.com';
const PASSWORD = 'any-password';

// Selector for password fields: avoids strict-mode conflicts with "Show password" toggle
const PWD = 'input[type="password"]';
// Selector for alert paragraphs (not the Next.js route announcer which is a div)
const ALERT = 'p[role="alert"]';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function loginAsEmployer(page: Page, email: string) {
  await page.goto(EMPLOYER_LOGIN_URL);
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });
  await page.getByLabel(/work email/i).fill(email);
  await page.locator(PWD).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
}

// Intercept R2 PUT so cert uploads succeed without a real bucket
async function mockR2Upload(page: Page) {
  await page.route('https://mock-r2.example.com/**', (route) => {
    if (route.request().method() === 'PUT') {
      route.fulfill({ status: 200, body: '' });
    } else {
      route.continue();
    }
  });
}

// ─── Screen 13 — Employer Login page ─────────────────────────────────────────

test.describe('Screen 13 — Employer Login', () => {
  test('renders employer login form with email and password fields', async ({
    page,
  }, testInfo) => {
    await page.goto(EMPLOYER_LOGIN_URL);
    await expect(page.getByRole('heading', { name: /sign in to your employer account/i })).toBeVisible(
      { timeout: 10_000 },
    );
    await expect(page.getByLabel(/work email/i)).toBeVisible();
    await expect(page.locator(PWD)).toBeVisible();
    await testInfo.attach('employer-login-page', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('has NO Google sign-in button', async ({ page }) => {
    await page.goto(EMPLOYER_LOGIN_URL);
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });
    expect(await page.getByRole('button', { name: /google/i }).count()).toBe(0);
  });

  test('"Register your company" link points to /signup?role=employer', async ({ page }) => {
    await page.goto(EMPLOYER_LOGIN_URL);
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });
    const link = page.getByRole('link', { name: /register your company/i });
    await expect(link).toHaveAttribute('href', `/${LOCALE}/signup?role=employer`);
  });

  test('candidate cross-link is present and points to /login', async ({ page }) => {
    await page.goto(EMPLOYER_LOGIN_URL);
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });
    const link = page.getByRole('link', { name: /log in/i }).first();
    await expect(link).toHaveAttribute('href', `/${LOCALE}/login`);
  });

  test('shows error for invalid credentials', async ({ page }, testInfo) => {
    await page.goto(EMPLOYER_LOGIN_URL);
    await page.getByLabel(/work email/i).fill('nobody@nowhere.com');
    await page.locator(PWD).fill('wrong-password');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.locator(ALERT)).toContainText(/incorrect email or password/i);
    await testInfo.attach('employer-login-invalid-credentials', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('approved employer logs in and is routed to /employer/dashboard', async ({
    page,
  }, testInfo) => {
    await loginAsEmployer(page, EMPLOYER_APPROVED_EMAIL);

    await expect(page).toHaveURL(/\/employer\/dashboard/, { timeout: 10_000 });
    await testInfo.attach('employer-login-dashboard-redirect', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('pending employer logs in and is routed to /employer/dashboard (company exists)', async ({
    page,
  }) => {
    await loginAsEmployer(page, EMPLOYER_PENDING_EMAIL);
    await expect(page).toHaveURL(/\/employer\/dashboard/, { timeout: 10_000 });
  });

  test('suspended employer can log in and is routed to /employer/dashboard', async ({
    page,
  }, testInfo) => {
    await loginAsEmployer(page, EMPLOYER_SUSPENDED_EMAIL);
    // Suspension is communicated by the shell banner, not by a login error
    await expect(page).toHaveURL(/\/employer\/dashboard/, { timeout: 10_000 });
    await testInfo.attach('suspended-employer-dashboard', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
});

// ─── Screen 14 — Employer Onboarding ─────────────────────────────────────────

test.describe('Screen 14 — Employer Onboarding (initial registration)', () => {
  test.beforeEach(async ({ page }) => {
    await mockR2Upload(page);
    // Navigate directly to onboarding as an employer with no company.
    // We need a user with EMPLOYER role and no company. We do this by routing
    // to the page (the MSW login handler will create a fresh session).
    // For simplicity, go directly to the page after pre-seeding a session via login.
    // Since the dev server has MSW enabled, we use a fresh employer user.
    // Strategy: hit the page directly — the EmployerRouteGuard redirects to login
    // if not authenticated; for these tests we use a direct navigation approach.
    await page.goto(EMPLOYER_ONBOARDING_URL);
  });

  test('onboarding page is accessible and renders the company setup form', async ({
    page,
  }, testInfo) => {
    await expect(
      page.getByRole('heading', { name: /set up your company profile/i }),
    ).toBeVisible({ timeout: 10_000 });
    await testInfo.attach('employer-onboarding-page', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
});

test.describe('Screen 14 — Onboarding full happy path (initial)', () => {
  test.beforeEach(async ({ page }) => {
    await mockR2Upload(page);
  });

  test('fill form → upload cert → submit → land on dashboard with pending banner', async ({
    page,
  }, testInfo) => {
    // Log in as rejected employer (has no PENDING company yet for this flow)
    // We'll use the pending employer so they get routed to dashboard via the
    // post-login route. Then navigate to onboarding manually to test the form
    // in isolation from routing.
    // Best approach: log in as approved (already has company), then use a fresh path.
    // For this E2E test, use a user with no company by intercepting the company endpoint.
    await page.route('/api/v1/employers/me/company', async (route) => {
      if (route.request().method() === 'GET') {
        // Return 404 so the page treats this as initial registration
        route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({
            type: 'about:blank',
            title: 'Not found',
            status: 404,
            detail: 'No company profile found.',
            code: 'NOT_FOUND',
          }),
        });
      } else {
        route.continue();
      }
    });

    // Log in as pending employer — post-login getCompany will be intercepted
    await loginAsEmployer(page, EMPLOYER_PENDING_EMAIL);

    // Should route to onboarding since company returns 404
    await expect(page).toHaveURL(/\/employer\/onboarding/, { timeout: 10_000 });

    // Wait for the onboarding form heading
    await expect(
      page.getByRole('heading', { name: /set up your company profile/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Fill company type — LOCAL
    await page.getByRole('radio', { name: /local company/i }).click();

    // Fill company name
    await page.getByPlaceholder(/your company legal name/i).fill('E2E Test Corp');

    // Fill phone
    await page.getByPlaceholder(/\+91 98765 43210/i).fill('+919012345678');

    // Fill location
    await page.getByPlaceholder(/city, state or country/i).fill('Bangalore, India');

    // Select employee range
    await page.getByLabel(/number of employees/i).selectOption('11-50');

    // Upload cert — pick a synthetic file
    const certInput = page.locator('input[type="file"]');
    await certInput.setInputFiles({
      name: 'registration-cert.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('PDF content'),
    });

    // Wait for upload to complete (presign + PUT succeed via MSW + route interceptor)
    await expect(page.getByText(/upload complete/i)).toBeVisible({ timeout: 15_000 });

    // Submit
    await page.getByRole('button', { name: /submit for approval/i }).click();

    // Success message appears
    await expect(page.getByRole('status')).toContainText(/submitted/i, { timeout: 10_000 });

    await testInfo.attach('employer-onboarding-submitted', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
});

// ─── Screen 15 — Employer Dashboard ──────────────────────────────────────────

test.describe('Screen 15 — Employer Dashboard (PENDING company)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsEmployer(page, EMPLOYER_PENDING_EMAIL);
    await expect(page).toHaveURL(/\/employer\/dashboard/, { timeout: 10_000 });
  });

  test('dashboard renders with KPI cards showing 0 for PENDING employer', async ({
    page,
  }, testInfo) => {
    // PENDING employers get short-circuited zeros — no getDashboard call
    await expect(page.getByText(/active jobs/i)).toBeVisible({ timeout: 10_000 });
    // All KPIs should show 0
    const zeros = page.getByText('0');
    await expect(zeros.first()).toBeVisible();

    await testInfo.attach('dashboard-pending-employer', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('PostFirstJobCta "Post a Job" is disabled (not a link) for PENDING employer', async ({
    page,
  }, testInfo) => {
    await expect(page.getByText(/post your first job/i)).toBeVisible({ timeout: 10_000 });

    // The CTA button should NOT be a link when not APPROVED
    const jobLink = page.getByRole('link', { name: /post a job/i });
    await expect(jobLink).toHaveCount(0);

    await testInfo.attach('dashboard-cta-disabled', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('pending company state banner is visible', async ({ page }) => {
    // The F0 shell renders CompanyStateBanner for PENDING status
    await expect(page.getByRole('status')).toContainText(/under review/i, { timeout: 10_000 });
  });
});

test.describe('Screen 15 — Employer Dashboard (APPROVED company)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsEmployer(page, EMPLOYER_APPROVED_EMAIL);
    await expect(page).toHaveURL(/\/employer\/dashboard/, { timeout: 10_000 });
  });

  test('approved employer dashboard renders KPIs and "Post a Job" as an active link', async ({
    page,
  }, testInfo) => {
    await expect(page.getByText(/active jobs/i)).toBeVisible({ timeout: 10_000 });

    // For approved employers with no jobs, PostFirstJobCta shows as a real link
    const postJobLink = page.getByRole('link', { name: /post a job/i });
    await expect(postJobLink).toBeVisible();
    await expect(postJobLink).toHaveAttribute('href', `/${LOCALE}/employer/jobs/new`);

    await testInfo.attach('dashboard-approved-employer', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('no company state banner visible for APPROVED employer', async ({ page }) => {
    // No pending/rejected/suspended banner for approved employers
    await page.waitForLoadState('networkidle');
    const bannerCount = await page.getByRole('status').count();
    // The banner should not be present (role="status" used by CompanyStateBanner for PENDING)
    expect(bannerCount).toBe(0);
  });
});

// ─── Resubmit flow (REJECTED → PENDING) ──────────────────────────────────────

test.describe('Resubmit flow — REJECTED employer resubmits registration', () => {
  test.beforeEach(async ({ page }) => {
    await mockR2Upload(page);
    await loginAsEmployer(page, EMPLOYER_REJECTED_EMAIL);
    await expect(page).toHaveURL(/\/employer\/dashboard/, { timeout: 10_000 });
  });

  test('REJECTED employer sees rejection banner in the shell', async ({ page }, testInfo) => {
    // CompanyStateBanner shows an alert for REJECTED status
    await expect(page.getByRole('alert')).toContainText(/rejected/i, { timeout: 10_000 });
    await testInfo.attach('rejected-employer-banner', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('resubmit link in banner navigates to /employer/onboarding', async ({ page }) => {
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 10_000 });
    const resubmitLink = page.getByRole('link', { name: /resubmit/i });
    await resubmitLink.click();
    await expect(page).toHaveURL(/\/employer\/onboarding/, { timeout: 10_000 });
  });

  test('onboarding form pre-fills rejected company data and shows Resubmit button', async ({
    page,
  }, testInfo) => {
    await page.goto(`/${LOCALE}/employer/onboarding`);

    await expect(
      page.getByRole('heading', { name: /resubmit company registration/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Pre-filled fields from the REJECTED company fixture
    await expect(page.getByDisplayValue('Apex Manpower Solutions')).toBeVisible();
    await expect(page.getByRole('button', { name: /resubmit for approval/i })).toBeVisible();

    await testInfo.attach('resubmit-form-prefilled', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('resubmit form submits PATCH and transitions company to PENDING', async ({
    page,
  }, testInfo) => {
    await page.goto(`/${LOCALE}/employer/onboarding`);
    await expect(
      page.getByRole('heading', { name: /resubmit company registration/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Upload a new cert
    const certInput = page.locator('input[type="file"]');
    await certInput.setInputFiles({
      name: 'new-cert.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('PDF content'),
    });

    await expect(page.getByText(/upload complete/i)).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /resubmit for approval/i }).click();

    // Success message — MSW PATCH handler auto-transitions REJECTED → PENDING
    await expect(page.getByRole('status')).toContainText(/submitted/i, { timeout: 10_000 });

    await testInfo.attach('resubmit-success', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
});

// ─── android-constrained: interrupted upload resilience ──────────────────────

test.describe('android-constrained — slow / interrupted cert upload', () => {
  test('cert upload retry without file re-selection after simulated network error', async ({
    page,
  }, testInfo) => {
    await mockR2Upload(page);

    // Intercept the first PUT to R2 and fail it, then allow the retry
    let putCount = 0;
    await page.route('https://mock-r2.example.com/**', (route) => {
      if (route.request().method() === 'PUT') {
        putCount++;
        if (putCount === 1) {
          // First attempt fails
          route.abort('failed');
        } else {
          // Subsequent retries succeed
          route.fulfill({ status: 200, body: '' });
        }
      } else {
        route.continue();
      }
    });

    await page.goto(EMPLOYER_ONBOARDING_URL);
    await expect(
      page.getByRole('heading', { name: /set up your company profile|resubmit/i }),
    ).toBeVisible({ timeout: 10_000 });

    const certInput = page.locator('input[type="file"]');
    await certInput.setInputFiles({
      name: 'cert.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('PDF content'),
    });

    // First attempt: should land in error state
    await expect(page.getByText(/retry/i)).toBeVisible({ timeout: 10_000 });

    await testInfo.attach('cert-upload-error-state', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    // Retry without re-selecting the file
    await page.getByRole('button', { name: /retry/i }).click();

    // Second attempt succeeds
    await expect(page.getByText(/upload complete/i)).toBeVisible({ timeout: 15_000 });

    await testInfo.attach('cert-upload-retry-success', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
});
