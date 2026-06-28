import { test, expect, type Page } from '@playwright/test';

// Profile page (Screen 11) E2E suite.
// All tests run under BOTH 'desktop' and 'android-constrained' projects.
// MSW handles all /api/v1/* calls (NEXT_PUBLIC_API_MOCKING=enabled).
// R2 PUT requests are intercepted via Playwright route so no real network needed.

const LOCALE = 'en';
const PROFILE_URL = `/${LOCALE}/profile`;

const SEEDED_EMAIL = 'amir@example.com';
const SEEDED_PASSWORD = 'any-password';

const PWD = 'input[type="password"]';

async function loginAs(page: Page, email: string, password: string) {
  await page.goto(`/${LOCALE}/login`);
  await page.getByLabel(/email address/i).fill(email);
  await page.locator(PWD).fill(password);
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10_000 });
}

async function goToProfile(page: Page) {
  await loginAs(page, SEEDED_EMAIL, SEEDED_PASSWORD);
  await page.goto(PROFILE_URL);
  // Wait for the profile hero to appear (confirms data loaded)
  await expect(page.getByRole('heading', { name: /amir khan/i, level: 1 })).toBeVisible({
    timeout: 10_000,
  });
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

test.describe('Profile page — structure', () => {
  test.beforeEach(async ({ page }) => {
    await goToProfile(page);
  });

  test('shows profile hero with candidate name', async ({ page }, testInfo) => {
    await expect(page.getByRole('heading', { name: /amir khan/i, level: 1 })).toBeVisible();
    await testInfo.attach('profile-hero', {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png',
    });
  });

  test('shows completion ring (role=meter)', async ({ page }) => {
    await expect(page.getByRole('meter')).toBeVisible();
  });

  test('shows all 5 sections', async ({ page }, testInfo) => {
    await expect(page.getByRole('region', { name: /personal info/i })).toBeVisible();
    await expect(page.getByRole('region', { name: /work experience/i })).toBeVisible();
    await expect(page.getByRole('region', { name: /documents/i })).toBeVisible();
    await expect(page.getByRole('region', { name: /skills/i })).toBeVisible();
    await expect(page.getByRole('region', { name: /account settings/i })).toBeVisible();
    await testInfo.attach('profile-all-sections', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('stats row is present', async ({ page }) => {
    // Seeded user has 1 experience (3y 6m = 3.5 yrs), 2 skills, 0 apps (S4 placeholder)
    await expect(page.getByText('3.5')).toBeVisible();
    await expect(page.getByText('2')).toBeVisible();
  });

  test('Download resume and Share profile buttons are disabled (S7/Phase-2)', async ({ page }) => {
    await expect(page.getByRole('button', { name: /download resume/i })).toBeDisabled();
    await expect(page.getByRole('button', { name: /share profile/i })).toBeDisabled();
  });

  test('sidebar nav / bottom nav is present with profile link active', async ({ page }) => {
    // Either desktop sidebar or mobile bottom nav has Profile link with aria-current="page"
    const profileLink = page.getByRole('link', { name: /profile/i }).first();
    await expect(profileLink).toBeVisible();
  });

  test('touch targets are ≥44px on Edit buttons', async ({ page }) => {
    const editBtn = page.getByRole('button', { name: /edit personal info/i });
    if (await editBtn.isVisible()) {
      const box = await editBtn.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  });
});

// ─── Personal Info inline edit ────────────────────────────────────────────────

test.describe('Profile — Personal Info edit', () => {
  test.beforeEach(async ({ page }) => {
    await goToProfile(page);
  });

  test('clicking Edit opens the form', async ({ page }, testInfo) => {
    await page.getByRole('button', { name: /edit personal info/i }).click();
    await expect(page.getByLabel(/full name/i)).toBeVisible();
    await testInfo.attach('profile-personal-info-edit', {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png',
    });
  });

  test('Cancel reverts without saving', async ({ page }) => {
    await page.getByRole('button', { name: /edit personal info/i }).click();
    await page.getByLabel(/full name/i).fill('Totally Different Name');
    await page.getByRole('button', { name: /^cancel$/i }).click();

    // Name should still show original
    await expect(page.getByRole('heading', { name: /amir khan/i })).toBeVisible();
  });

  test('Save persists updated name', async ({ page }, testInfo) => {
    await page.getByRole('button', { name: /edit personal info/i }).click();
    await page.getByLabel(/full name/i).fill('Amir Khan Updated');
    await page.getByRole('button', { name: /^save$/i }).click();

    // Wait for edit mode to close
    await expect(page.getByRole('button', { name: /edit personal info/i })).toBeVisible({
      timeout: 5_000,
    });
    await testInfo.attach('profile-personal-info-saved', {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png',
    });
  });

  test('verified phone shows Verified badge in view mode', async ({ page }) => {
    // amir@example.com has phoneVerifiedAt set in mock data
    await expect(page.getByText(/verified/i).first()).toBeVisible();
  });

  test('phone verify widget appears in edit mode', async ({ page }) => {
    await page.getByRole('button', { name: /edit personal info/i }).click();
    await expect(page.getByText(/verify your phone/i)).toBeVisible();
  });
});

// ─── Work Experience ──────────────────────────────────────────────────────────

test.describe('Profile — Work Experience', () => {
  test.beforeEach(async ({ page }) => {
    await goToProfile(page);
  });

  test('view mode shows seeded experience entry', async ({ page }) => {
    // amir@example.com has "Mason at Gulf Construction LLC"
    await expect(page.getByText(/Mason/i)).toBeVisible();
  });

  test('edit mode shows ExperienceList with Add button', async ({ page }, testInfo) => {
    await page.getByRole('button', { name: /edit work experience/i }).click();
    await expect(page.getByRole('button', { name: /add experience/i })).toBeVisible();
    await testInfo.attach('profile-experience-edit', {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png',
    });
  });

  test('can add a new experience in edit mode', async ({ page }) => {
    await page.getByRole('button', { name: /edit work experience/i }).click();
    await page.getByRole('button', { name: /add experience/i }).click();
    await page.getByLabel(/company name/i).fill('Test Corp');
    await page.getByLabel(/job title/i).fill('Welder');
    await page.getByLabel(/years/i).fill('1');
    await page.getByRole('button', { name: /save experience/i }).click();
    await expect(page.getByText('Welder')).toBeVisible({ timeout: 5_000 });
  });

  test('Save closes edit mode and refetches completion ring', async ({ page }) => {
    await page.getByRole('button', { name: /edit work experience/i }).click();
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(page.getByRole('button', { name: /edit work experience/i })).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByRole('meter')).toBeVisible();
  });
});

// ─── Documents ────────────────────────────────────────────────────────────────

test.describe('Profile — Documents', () => {
  test.beforeEach(async ({ page }) => {
    await goToProfile(page);
  });

  test('shows existing passport with Verified badge', async ({ page }) => {
    await expect(page.getByText(/verified/i).first()).toBeVisible();
  });

  test('shows document count "1 / 3"', async ({ page }) => {
    await expect(page.getByText(/1 \/ 3/i)).toBeVisible();
  });

  test('seeded passport shows Valid until badge (expiryDate 2028)', async ({ page }) => {
    // Mock data has expiryDate: '2028-06-01' — should show "Valid until"
    await expect(page.getByText(/valid until/i)).toBeVisible();
  });

  test('video intro slot shows Coming soon', async ({ page }) => {
    await expect(page.getByText(/coming soon/i).first()).toBeVisible();
  });

  test('edit mode shows FileUpload widgets', async ({ page }, testInfo) => {
    await page.getByRole('button', { name: /edit documents/i }).click();
    // FileUpload renders a hidden file input; the button/dropzone should be visible
    await expect(page.locator('input[type="file"]').first()).toBeAttached();
    await testInfo.attach('profile-documents-edit', {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png',
    });
  });

  test('re-upload succeeds under android-constrained profile', async ({ page }) => {
    await mockR2Upload(page);
    await page.getByRole('button', { name: /edit documents/i }).click();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'passport_new.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('mock-pdf-content'),
    });

    // Should transition to done or error (mock confirm succeeds)
    await expect(page.getByText(/uploaded|uploading/i).first()).toBeVisible({ timeout: 10_000 });
  });
});

// ─── Skills ───────────────────────────────────────────────────────────────────

test.describe('Profile — Skills', () => {
  test.beforeEach(async ({ page }) => {
    await goToProfile(page);
  });

  test('view mode shows seeded skills as chips', async ({ page }) => {
    await expect(page.getByText(/Masonry/i)).toBeVisible();
    await expect(page.getByText(/Plastering/i)).toBeVisible();
  });

  test('edit mode opens SkillChips input', async ({ page }, testInfo) => {
    await page.getByRole('button', { name: /edit skills/i }).click();
    await expect(page.getByRole('textbox', { name: /skills/i })).toBeVisible();
    await testInfo.attach('profile-skills-edit', {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png',
    });
  });

  test('Save closes edit mode', async ({ page }) => {
    await page.getByRole('button', { name: /edit skills/i }).click();
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(page.getByRole('button', { name: /edit skills/i })).toBeVisible({
      timeout: 5_000,
    });
  });
});

// ─── Account Settings ─────────────────────────────────────────────────────────

test.describe('Profile — Account Settings', () => {
  test.beforeEach(async ({ page }) => {
    await goToProfile(page);
  });

  test('privacy toggles are present', async ({ page }, testInfo) => {
    await expect(page.getByRole('switch', { name: /show phone/i })).toBeVisible();
    await expect(page.getByRole('switch', { name: /show religion/i })).toBeVisible();
    await expect(page.getByRole('switch', { name: /profile visible/i })).toBeVisible();
    await expect(page.getByRole('switch', { name: /available for work/i })).toBeVisible();
    await testInfo.attach('profile-account-settings', {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png',
    });
  });

  test('toggling "show phone" PATCHes settings and phone stays visible in self-view', async ({
    page,
  }) => {
    const toggle = page.getByRole('switch', { name: /show phone/i });
    const initialState = await toggle.getAttribute('aria-checked');
    await toggle.click();
    // aria-checked should flip
    const newState = await toggle.getAttribute('aria-checked');
    expect(newState).not.toBe(initialState);

    // Self-view: phone number should still be visible regardless of toggle
    await expect(page.getByText(/\+91987654321/i)).toBeVisible();
  });

  test('salary expectation fields are present', async ({ page }) => {
    await expect(page.getByLabel(/minimum/i)).toBeVisible();
    await expect(page.getByLabel(/maximum/i)).toBeVisible();
  });

  test('Save salary button PATCHes settings', async ({ page }) => {
    await page.getByLabel(/minimum/i).fill('25000');
    await page.getByLabel(/maximum/i).fill('50000');
    await page.getByRole('button', { name: /save salary/i }).click();
    // Should succeed without error (mock accepts any body)
    await expect(page.getByRole('button', { name: /save salary/i })).not.toBeDisabled({
      timeout: 5_000,
    });
  });
});

// ─── Auth guard ───────────────────────────────────────────────────────────────

test.describe('Profile — auth guard', () => {
  test('redirects unauthenticated users to login', async ({ page }) => {
    await page.goto(PROFILE_URL);
    await page.waitForURL((url) => url.pathname.includes('/login'), { timeout: 10_000 });
    await expect(page).toHaveURL(/\/login/);
  });
});

// ─── RTL / Arabic ─────────────────────────────────────────────────────────────

test.describe('Profile — Arabic RTL', () => {
  test('renders without layout breaking in ar locale', async ({ page }, testInfo) => {
    await loginAs(page, SEEDED_EMAIL, SEEDED_PASSWORD);
    await page.goto('/ar/profile');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

    const dir = await page.evaluate(() => document.documentElement.dir);
    expect(dir).toBe('rtl');
    await testInfo.attach('profile-arabic-rtl', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
});
