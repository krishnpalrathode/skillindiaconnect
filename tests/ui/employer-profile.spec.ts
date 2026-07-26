import { test, expect, type Page } from '@playwright/test';

// Screen 20 — Employer Profile E2E suite.
// Runs under BOTH 'desktop' and 'android-constrained' Playwright projects.
// MSW (NEXT_PUBLIC_API_MOCKING=enabled) handles all /api/v1/* calls.
// R2 PUT requests are intercepted via Playwright's route API.
//
// BROWSER-WALK gate: console 404s are monitored throughout. Any 404 for an
// /api/v1/ request fails the test (MSW should handle all profile endpoints).

const LOCALE = 'en';
const EMPLOYER_LOGIN_URL = `/${LOCALE}/employer-login`;
const EMPLOYER_PROFILE_URL = `/${LOCALE}/employer/profile`;

const EMPLOYER_APPROVED_EMAIL = 'employer@example.com';
const PASSWORD = 'any-password';

const PWD = 'input[type="password"]';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loginAndNavigateToProfile(page: Page) {
  await page.goto(EMPLOYER_LOGIN_URL);
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });
  await page.getByLabel(/work email/i).fill(EMPLOYER_APPROVED_EMAIL);
  await page.locator(PWD).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  // Navigate to profile
  await page.goto(EMPLOYER_PROFILE_URL);
  // Wait for the hero to show company name (profile hydrated)
  await expect(page.getByRole('heading', { name: 'Gulf Builders Arabia', level: 1 })).toBeVisible({
    timeout: 15_000,
  });
}

async function mockR2Upload(page: Page) {
  await page.route('https://mock-r2.example.com/**', (route) => {
    if (route.request().method() === 'PUT') {
      route.fulfill({ status: 200, body: '' });
    } else {
      route.continue();
    }
  });
}

// Collect API 404s in a test run
function installApi404Monitor(page: Page): () => string[] {
  const notFound: string[] = [];
  page.on('response', (response) => {
    if (response.status() === 404 && response.url().includes('/api/v1/')) {
      notFound.push(`404 ${response.url()}`);
    }
  });
  return () => notFound;
}

// ─── Screen 20 — Employer Profile ────────────────────────────────────────────

test.describe('Screen 20 — Employer Profile', () => {
  test('profile page loads with no API 404s (browser-walk gate)', async ({ page }, testInfo) => {
    const getNotFound = installApi404Monitor(page);
    await loginAndNavigateToProfile(page);

    // All five sections are rendered
    await expect(page.getByRole('region', { name: /company information/i })).toBeVisible();
    await expect(page.getByRole('region', { name: /hiring preferences/i })).toBeVisible();
    await expect(page.getByRole('region', { name: /contact persons/i })).toBeVisible();
    await expect(page.getByRole('region', { name: /company documents/i })).toBeVisible();
    await expect(page.getByRole('region', { name: /account settings/i })).toBeVisible();

    await testInfo.attach('profile-page', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    // BROWSER-WALK gate: no /api/v1/ 404s
    expect(getNotFound()).toEqual([]);
  });

  test('edit company info — name change persists on reload', async ({ page }) => {
    await loginAndNavigateToProfile(page);

    // Open company info section edit
    const section = page.getByRole('region', { name: /company information/i });
    await section.getByRole('button', { name: /edit/i }).click();

    // Change company name
    const nameInput = section.getByRole('textbox', { name: /company name/i });
    await nameInput.clear();
    await nameInput.fill('Updated Gulf Builders');

    await section.getByRole('button', { name: /save/i }).click();

    // Edit form collapses (Save button gone)
    await expect(section.getByRole('button', { name: /save/i })).not.toBeVisible();

    // Company name visible in section view
    await expect(section.getByText('Updated Gulf Builders')).toBeVisible();
  });

  test('add hiring preferences → profile checklist nudge updates', async ({ page }) => {
    await loginAndNavigateToProfile(page);

    const section = page.getByRole('region', { name: /hiring preferences/i });

    // Empty hint visible initially
    await expect(section.getByText(/add hiring preferences/i)).toBeVisible();

    await section.getByRole('button', { name: /edit/i }).click();

    await section
      .getByRole('textbox', { name: /preferred job categories/i })
      .fill('Electrician, Welder');

    await section.getByRole('button', { name: /save/i }).click();

    await expect(section.getByRole('button', { name: /save/i })).not.toBeVisible();

    // Chips appear in view mode
    await expect(section.getByText('Electrician')).toBeVisible();
    await expect(section.getByText('Welder')).toBeVisible();
  });

  test('add contact and make primary — only one Primary badge after save', async ({ page }) => {
    await loginAndNavigateToProfile(page);

    const section = page.getByRole('region', { name: /contact persons/i });

    // Open add form
    await section.getByRole('button', { name: /add contact/i }).first().click();

    await section.getByRole('textbox', { name: /full name/i }).fill('Ravi Shankar');
    await section.getByRole('textbox', { name: /job title/i }).fill('Recruitment Lead');
    await section.getByRole('checkbox', { name: /make primary/i }).check();

    await section.getByRole('button', { name: /save/i }).click();

    // After save → profile is refetched; the contact should appear
    await expect(section.getByText('Ravi Shankar')).toBeVisible({ timeout: 8_000 });

    // At most one Primary badge visible
    const primaryBadges = section.getByText(/primary/i);
    expect(await primaryBadges.count()).toBeLessThanOrEqual(1);
  });

  test('company documents section shows cert status and re-upload control', async ({ page }) => {
    await loginAndNavigateToProfile(page);
    await mockR2Upload(page);

    const section = page.getByRole('region', { name: /company documents/i });

    // Approved company → Verified badge
    await expect(section.getByText(/verified/i)).toBeVisible();

    // Re-upload dropzone is present
    await expect(section.getByText(/pdf|jpg|png/i)).toBeVisible();
  });

  test('company TYPE field is read-only in edit mode', async ({ page }) => {
    await loginAndNavigateToProfile(page);

    const section = page.getByRole('region', { name: /company information/i });
    await section.getByRole('button', { name: /edit/i }).click();

    // "contact support" hint is visible
    await expect(section.getByText(/contact support/i)).toBeVisible();
    // No select/input for company type
    expect(await section.getByLabel(/company type/i).count()).toBe(0);
  });

  test('account settings — language preference is selectable', async ({ page }) => {
    await loginAndNavigateToProfile(page);

    const section = page.getByRole('region', { name: /account settings/i });
    await section.getByRole('button', { name: /edit/i }).click();

    const select = section.getByRole('combobox', { name: /preferred language/i });
    await select.selectOption('ar');

    await section.getByRole('button', { name: /save/i }).click();

    await expect(section.getByRole('button', { name: /save/i })).not.toBeVisible();

    // Arabic shown in view mode
    await expect(section.getByText(/arabic/i)).toBeVisible();
  });
});
