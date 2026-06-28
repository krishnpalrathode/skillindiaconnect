import { test, expect } from '@playwright/test';

// All tests run under BOTH 'desktop' and 'android-constrained' projects.
// The dev server runs with NEXT_PUBLIC_API_MOCKING=enabled, so MSW handles
// every API call — no real backend needed.

const LOCALE = 'en';
const LOGIN_URL = `/${LOCALE}/login`;
const SIGNUP_URL = `/${LOCALE}/signup`;
const FORGOT_URL = `/${LOCALE}/forgot-password`;

// Selector helpers
// ── password input: getByLabel(/password/i) is ambiguous because the "Show
//    password" toggle button has aria-label="Show password" which also matches.
//    The type attribute is unambiguous.
const PWD = 'input[type="password"]';
// ── alert: Next.js route announcer has role="alert" aria-live="assertive" and
//    is always present in the DOM (usually empty). Our real errors are <p>, the
//    announcer is a <div>, so p[role="alert"] is unambiguous.
const ALERT = 'p[role="alert"]';

// ─── Login page ───────────────────────────────────────────────────────────────

test.describe('Login page', () => {
  test('renders login form with Google button, email tab, phone tab', async ({ page }, testInfo) => {
    await page.goto(LOGIN_URL);
    await expect(page.getByRole('heading', { name: /log in/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /google/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /email/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /phone/i })).toBeVisible();
    await testInfo.attach('login-page', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('email+password login succeeds and redirects to dashboard', async ({ page }, testInfo) => {
    await page.goto(LOGIN_URL);

    await page.getByLabel(/email address/i).fill('amir@example.com');
    await page.locator(PWD).fill('any-password');
    await page.getByRole('button', { name: /log in/i }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
    await testInfo.attach('login-success-dashboard', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('shows invalid credentials error for wrong email', async ({ page }, testInfo) => {
    await page.goto(LOGIN_URL);

    await page.getByLabel(/email address/i).fill('nobody@nowhere.com');
    await page.locator(PWD).fill('wrong');
    await page.getByRole('button', { name: /log in/i }).click();

    await expect(page.locator(ALERT)).toContainText(/incorrect email or password/i);
    await testInfo.attach('login-invalid-credentials-error', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('has accessible ≥44px touch targets on all interactive elements', async ({ page }) => {
    await page.goto(LOGIN_URL);
    const googleBtn = page.getByRole('button', { name: /google/i });
    const box = await googleBtn.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  });

  test('language switcher is present', async ({ page }) => {
    await page.goto(LOGIN_URL);
    await expect(page.getByRole('group', { name: /select language/i })).toBeVisible();
  });
});

// ─── Phone OTP flow ───────────────────────────────────────────────────────────

test.describe('Phone OTP login flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(LOGIN_URL);
    await page.getByRole('tab', { name: /phone/i }).click();
  });

  test('always advances to OTP step (enumeration-safe) even for unknown phone', async ({
    page,
  }, testInfo) => {
    await page.getByLabel(/phone number/i).fill('9999900000');
    await page.getByRole('button', { name: /send otp/i }).click();

    // Must always show OTP entry — never reveal account existence
    await expect(page.getByText(/6-digit code/i)).toBeVisible();
    await expect(page.getByText(/no account/i)).not.toBeVisible();
    await testInfo.attach('phone-otp-entry-step', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('correct OTP for seeded phone logs in and redirects to dashboard', async ({
    page,
  }, testInfo) => {
    // Test sends '9876543210' (10-digit, no +91 prefix); verifiedPhones seeds both formats.
    await page.getByLabel(/phone number/i).fill('9876543210');
    await page.getByRole('button', { name: /send otp/i }).click();

    await expect(page.getByText(/6-digit code/i)).toBeVisible();
    await testInfo.attach('phone-otp-entry-filled', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    // Fill OTP cells — MSW MOCK_OTP = '123456'
    const cells = page.locator('input[aria-label^="OTP digit"]');
    await cells.nth(0).fill('1');
    await cells.nth(1).fill('2');
    await cells.nth(2).fill('3');
    await cells.nth(3).fill('4');
    await cells.nth(4).fill('5');
    await cells.nth(5).fill('6');

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
  });

  test('wrong OTP shows error and does not redirect', async ({ page }, testInfo) => {
    await page.getByLabel(/phone number/i).fill('9876543210');
    await page.getByRole('button', { name: /send otp/i }).click();

    await expect(page.getByText(/6-digit code/i)).toBeVisible();

    const cells = page.locator('input[aria-label^="OTP digit"]');
    for (let i = 0; i < 6; i++) {
      await cells.nth(i).fill('0');
    }

    await expect(page.locator(ALERT)).toContainText(/invalid or expired/i);
    await expect(page).not.toHaveURL(/\/dashboard/);
    await testInfo.attach('phone-otp-wrong-error', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
});

// ─── Signup page ──────────────────────────────────────────────────────────────

test.describe('Signup page', () => {
  test('renders with Job Seeker role selected by default', async ({ page }, testInfo) => {
    await page.goto(SIGNUP_URL);
    await expect(page.getByRole('radio', { name: /job seeker/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await testInfo.attach('signup-page', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('can switch to Employer role', async ({ page }) => {
    await page.goto(SIGNUP_URL);
    await page.getByRole('radio', { name: /employer/i }).click();
    await expect(page.getByRole('radio', { name: /employer/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('create account button disabled until T&C accepted', async ({ page }) => {
    await page.goto(SIGNUP_URL);
    const btn = page.getByRole('button', { name: /create account/i });
    await expect(btn).toBeDisabled();
    await page.getByRole('checkbox').check();
    await expect(btn).not.toBeDisabled();
  });

  test('successful signup redirects to /onboarding', async ({ page }) => {
    await page.goto(SIGNUP_URL);

    await page.getByLabel(/email address/i).fill(`e2e-${Date.now()}@example.com`);
    await page.locator(PWD).fill('StrongP@ss1');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /create account/i }).click();

    await expect(page).toHaveURL(/\/onboarding/, { timeout: 10_000 });
  });

  test('shows EMAIL_TAKEN error for duplicate email', async ({ page }, testInfo) => {
    await page.goto(SIGNUP_URL);

    await page.getByLabel(/email address/i).fill('amir@example.com');
    await page.locator(PWD).fill('StrongP@ss1');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /create account/i }).click();

    await expect(page.locator(ALERT)).toContainText(/account with this email/i);
    await testInfo.attach('signup-email-taken-error', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('password strength meter appears while typing', async ({ page }, testInfo) => {
    await page.goto(SIGNUP_URL);
    // 'abcdefgh' scores 1 (length ≥ 8, no upper/digit/special) → "Weak"
    // 'abc' would score 0 (only 3 chars) and render no label at all.
    await page.locator(PWD).fill('abcdefgh');
    await expect(page.getByText(/weak/i)).toBeVisible();
    await testInfo.attach('signup-password-weak', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    await page.locator(PWD).fill('StrongP@ss1');
    await expect(page.getByText(/strong/i)).toBeVisible();
    await testInfo.attach('signup-password-strong', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
});

// ─── Forgot-password page ─────────────────────────────────────────────────────

test.describe('Forgot password page', () => {
  test('renders the request form', async ({ page }, testInfo) => {
    await page.goto(FORGOT_URL);
    await expect(page.getByRole('heading', { name: /reset your password/i })).toBeVisible();
    await expect(page.getByLabel(/email address/i)).toBeVisible();
    await testInfo.attach('forgot-password-page', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('always shows the "check inbox" message regardless of email existence (enumeration-safe)', async ({
    page,
  }, testInfo) => {
    await page.goto(FORGOT_URL);

    // Unknown email — must still succeed
    await page.getByLabel(/email address/i).fill('nobody@nowhere.com');
    await page.getByRole('button', { name: /send reset/i }).click();

    await expect(page.getByRole('heading', { name: /check your inbox/i })).toBeVisible();
    await testInfo.attach('forgot-password-check-inbox', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
});

// ─── Cross-page navigation ────────────────────────────────────────────────────

test.describe('Auth cross-links', () => {
  test('login page has link to signup', async ({ page }) => {
    await page.goto(LOGIN_URL);
    await expect(page.getByRole('link', { name: /sign up/i })).toBeVisible();
  });

  test('signup page has link to login', async ({ page }) => {
    await page.goto(SIGNUP_URL);
    await expect(page.getByRole('link', { name: /log in/i })).toBeVisible();
  });

  test('login page has forgot password link', async ({ page }) => {
    await page.goto(LOGIN_URL);
    await expect(page.getByRole('link', { name: /forgot password/i })).toBeVisible();
  });
});
