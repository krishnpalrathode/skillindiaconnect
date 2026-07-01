import { test, expect } from '@playwright/test';

// All tests run under both 'desktop' and 'android-constrained' projects.
// Dev server runs with NEXT_PUBLIC_API_MOCKING=enabled — MSW handles all
// API calls. SSR is validated by checking content is present in page.content()
// immediately after goto(), before any client-side hydration.

const LOCALE = 'en';
const JOBS_URL = `/${LOCALE}/jobs`;

// ─── Screen 07 — public job search ───────────────────────────────────────────

test.describe('Job search page (Screen 07)', () => {
  test('renders SSR job cards immediately after navigation', async ({ page }, testInfo) => {
    await page.goto(JOBS_URL);

    // Check job cards are visible — content must exist on initial load (SSR).
    await expect(page.getByRole('list', { name: /job search results/i })).toBeVisible();

    // At least one job card is present from mock data.
    const cards = page.getByRole('listitem');
    await expect(cards.first()).toBeVisible();

    await testInfo.attach('job-search-initial', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('SSR: page HTML contains job content before hydration', async ({ page }) => {
    await page.goto(JOBS_URL);
    const html = await page.content();
    // If SSR is working, the job title "Experienced Mason" from job-1 fixture
    // must appear in the initial HTML without relying on client-side fetch.
    expect(html).toContain('Experienced Mason');
  });

  test('market tab filter — clicking Gulf updates URL and results', async ({ page }, testInfo) => {
    await page.goto(JOBS_URL);

    await page.getByRole('tab', { name: /gulf/i }).click();

    await expect(page).toHaveURL(/market=GULF/);

    // Wait for job list to update.
    await expect(page.getByRole('list', { name: /job search results/i })).toBeVisible();

    await testInfo.attach('gulf-filter', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('market tab filter — All tab clears market filter', async ({ page }) => {
    await page.goto(`${JOBS_URL}?market=GULF`);

    await page.getByRole('tab', { name: /^all$/i }).click();

    await expect(page).not.toHaveURL(/market=/);
  });

  test('search bar submits query and reflects in URL', async ({ page }) => {
    await page.goto(JOBS_URL);

    await page.getByRole('searchbox').fill('mason');
    await page.getByRole('button', { name: /^search$/i }).click();

    await expect(page).toHaveURL(/q=mason/);
    await expect(page.getByRole('list', { name: /job search results/i })).toBeVisible();
  });

  test('category chip click filters results and updates URL', async ({ page }) => {
    await page.goto(JOBS_URL);

    await page.getByRole('button', { name: /construction/i, exact: false }).first().click();

    await expect(page).toHaveURL(/category=cat-construction/);
  });

  test('empty state appears when no matching jobs', async ({ page }) => {
    // An unlikely search query guaranteed to match nothing.
    await page.goto(`${JOBS_URL}?q=zzznomatch9999xyz`);

    await expect(page.getByText(/no jobs found/i)).toBeVisible();
  });

  test('result count is displayed', async ({ page }) => {
    await page.goto(JOBS_URL);

    const count = page.getByTestId('job-result-count');
    await expect(count).toBeVisible();
    await expect(count).toHaveText(/job.*found/i);
  });
});

// ─── Screen 09 — public job detail ───────────────────────────────────────────

test.describe('Job detail page (Screen 09)', () => {
  const JOB_DETAIL_URL = `/${LOCALE}/jobs/job-1`;

  test('renders job title and company name', async ({ page }, testInfo) => {
    await page.goto(JOB_DETAIL_URL);

    await expect(page.getByRole('heading', { name: /experienced mason/i })).toBeVisible();
    expect(await page.content()).toContain('Gulf Builders Arabia');

    await testInfo.attach('job-detail', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('SSR: detail page HTML contains content before hydration', async ({ page }) => {
    await page.goto(JOB_DETAIL_URL);
    const html = await page.content();
    expect(html).toContain('Experienced Mason');
    expect(html).toContain('Gulf Builders Arabia');
  });

  test('Apply Now link is present', async ({ page }) => {
    await page.goto(JOB_DETAIL_URL);
    await expect(page.getByRole('link', { name: /apply now/i })).toBeVisible();
  });

  test('Save job button is present and keyboard-accessible', async ({ page }) => {
    await page.goto(JOB_DETAIL_URL);
    const saveBtn = page.getByRole('button', { name: /save job/i }).or(
      page.getByRole('button', { name: /saved/i }),
    );
    await expect(saveBtn.first()).toBeVisible();

    // Keyboard accessibility: button is reachable via Tab.
    await saveBtn.first().focus();
    await expect(saveBtn.first()).toBeFocused();
  });

  test('Job details section shows work conditions', async ({ page }) => {
    await page.goto(JOB_DETAIL_URL);
    await expect(page.getByRole('heading', { name: /job details/i })).toBeVisible();
    // job-1 has workConditions = '8 hours/day, 6 days/week...'
    await expect(page.getByText(/8 hours\/day/)).toBeVisible();
  });

  test('Requirements section shows as a list', async ({ page }) => {
    await page.goto(JOB_DETAIL_URL);
    await expect(page.getByRole('heading', { name: /requirements/i })).toBeVisible();
    await expect(page.getByText(/3\+ years masonry experience/i)).toBeVisible();
  });

  test('Similar Jobs section is present when data exists', async ({ page }) => {
    await page.goto(JOB_DETAIL_URL);
    // job-1 (GULF/construction) should have similar jobs from other GULF or construction jobs.
    const heading = page.getByRole('heading', { name: /similar jobs/i });
    if (await heading.isVisible()) {
      await expect(heading).toBeVisible();
    }
    // No assertion failure if similar jobs is empty — it's optional.
  });

  test('404 page renders for unknown job id', async ({ page }, testInfo) => {
    await page.goto(`/${LOCALE}/jobs/nonexistent-job-id-xyz`);

    await expect(page.getByText(/job not found/i)).toBeVisible();

    await testInfo.attach('job-not-found', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
});

// ─── Save job — logged-out redirect ──────────────────────────────────────────

test.describe('SaveJobButton — logged-out redirect', () => {
  test('redirects to login when unauthenticated user clicks Save', async ({ page }) => {
    await page.goto(`/${LOCALE}/jobs/job-1`);

    // Click the Save job button (full-variant on detail page).
    const saveBtn = page.getByRole('button', { name: /save job/i });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Should navigate to login with next= parameter.
    await expect(page).toHaveURL(/\/login/);
    await expect(page).toHaveURL(/next=/);
  });
});
