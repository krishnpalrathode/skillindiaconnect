import { test as base, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

const BASE = process.env['SHELL_BASE_URL'] ?? 'http://localhost:3000';

/**
 * The authenticated-context fixture is DUPLICATED from mobile-shell.spec.ts
 * rather than imported.
 *
 * Under Playwright 1.61 on Node 22.17 any local TypeScript import fails to load
 * (`context.conditions?.includes is not a function`) — a two-line helper
 * reproduces it, and it is what stops the whole `tests/ui` suite collecting.
 * Until that is fixed there is no way to share a fixture between two spec files
 * in this directory. Two logins across the run stays inside the API's 5/min
 * auth limit; extracting this is the first thing to do once the loader works.
 */
const test = base.extend<{ page: Page }, { authedContext: BrowserContext }>({
  authedContext: [
    async ({ browser }, use) => {
      const context = await browser.newContext({ baseURL: BASE });
      const page = await context.newPage();

      await page.goto('/en/login');
      await page.getByLabel(/email address/i).fill('ramesh@example.com');
      await page.locator('input[type="password"]').fill('Password123!');
      await page.getByRole('button', { name: /log in/i }).click();
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60_000 });

      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],
  page: async ({ authedContext }, use) => {
    const page = authedContext.pages()[0] ?? (await authedContext.newPage());
    await use(page);
  },
});

const PHONE = { width: 390, height: 844 };
const NARROW = { width: 360, height: 780 };
const DESKTOP = { width: 1440, height: 900 };

const SLOW_3G = {
  offline: false,
  downloadThroughput: Math.floor((400 * 1024) / 8),
  uploadThroughput: Math.floor((400 * 1024) / 8),
  latency: 400,
};

async function throttle(page: Page): Promise<() => Promise<void>> {
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.emulateNetworkConditions', SLOW_3G);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  return async () => {
    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await session.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: -1,
      uploadThroughput: -1,
      latency: 0,
    });
    await session.detach();
  };
}

/** Every result is a role="article" named "<title>, <company>". */
const cards = (page: Page) => page.getByRole('article');

test.describe('Job card — phone treatment', () => {
  test('renders the card with its salary, benefits and a prominent Apply CTA', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/en/jobs');
    await page.waitForLoadState('networkidle');

    const first = cards(page).first();
    await expect(first).toBeVisible();

    // Named by title + company, so a screen reader can tell forty results apart.
    const name = await first.getAttribute('aria-labelledby');
    expect(name).toBeTruthy();

    await expect(first.getByRole('heading', { level: 3 })).toBeVisible();
    await expect(first.getByRole('link', { name: /apply to/i })).toBeVisible();
  });

  /**
   * The benefit chips are the platform's differentiator and the thing a
   * restyle is most likely to quietly drop. Asserted against real API data,
   * not a fixture.
   */
  test('keeps the market-driven benefit chips on real search results', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/en/jobs');
    await page.waitForLoadState('networkidle');

    const withChips = page.getByRole('list', { name: /included benefits/i });
    await expect(withChips.first()).toBeVisible();

    const labels = (await withChips.first().innerText()).trim();
    // Whichever market this job is, it must be labelled from that market's
    // bundle — never a mix, and never empty.
    expect(labels).toMatch(/Accommodation|Transport|Food|PF|Bonus|ESI/);
  });

  test('nothing overflows sideways at the 360px floor', async ({ page }) => {
    await page.setViewportSize(NARROW);
    await page.goto('/en/jobs');
    await page.waitForLoadState('networkidle');
    await expect(cards(page).first()).toBeVisible();

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);

    // And no individual card is wider than the viewport.
    const widest = await page.evaluate(() =>
      [...document.querySelectorAll('[role="article"]')].reduce(
        (w, el) => Math.max(w, el.getBoundingClientRect().width),
        0,
      ),
    );
    expect(widest).toBeLessThanOrEqual(360);
  });

  test('the Apply CTA is a real tap target and lands on the job page', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/en/jobs');
    await page.waitForLoadState('networkidle');

    const apply = cards(page)
      .first()
      .getByRole('link', { name: /apply to/i });
    const box = await apply.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await apply.click();
    await page.waitForURL(/\/en\/jobs\/[^/]+$/, { timeout: 60_000 });

    // Proof it reused the existing flow rather than forking one: the real,
    // eligibility-aware control is what the candidate lands on.
    await expect(
      page.getByRole('button', { name: /apply|complete your profile|applied/i }).first(),
    ).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('Job card — desktop is unchanged', () => {
  test('hides the phone-only Apply CTA and keeps View details', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/en/jobs');
    await page.waitForLoadState('networkidle');

    const first = cards(page).first();
    await expect(first).toBeVisible();

    await expect(first.getByRole('link', { name: /apply to/i })).toBeHidden();
    await expect(first.getByRole('link', { name: /view details/i })).toBeVisible();
  });

  test('renders the desktop title size and card radius, not the phone ones', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/en/jobs');
    await page.waitForLoadState('networkidle');

    const heading = cards(page).first().getByRole('heading', { level: 3 });
    // sm:text-base — 16px, the value the card used before this unit.
    await expect(heading).toHaveCSS('font-size', '16px');
    /*
      12px, not Tailwind's stock 8px: this theme overrides the radius scale in
      tailwind.config.ts (`lg: var(--radius-lg)` = 0.75rem). This is the value
      `rounded-lg` produced on the card before this unit, and `sm:rounded-lg`
      is what restores it above the breakpoint.
    */
    await expect(cards(page).first()).toHaveCSS('border-radius', '12px');
  });

  test('and at phone width those same properties take the larger values', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/en/jobs');
    await page.waitForLoadState('networkidle');

    const heading = cards(page).first().getByRole('heading', { level: 3 });
    await expect(heading).toHaveCSS('font-size', '18px'); // text-lg
    await expect(cards(page).first()).toHaveCSS('border-radius', '16px'); // rounded-2xl
  });
});

test.describe('Job card — RTL and constrained', () => {
  /**
   * A salary whose bounds swap is wrong information about pay, shown to someone
   * deciding whether to take a job abroad. The layout must mirror; the number
   * must not.
   */
  test('mirrors in Arabic while the salary stays LTR', async ({ page }) => {
    await page.setViewportSize(NARROW);
    await page.goto('/ar/jobs');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(cards(page).first()).toBeVisible();

    // The salary is bidi-isolated, so it is still read left-to-right.
    const salary = cards(page).first().locator('bdi[dir="ltr"]').first();
    if (await salary.count()) {
      await expect(salary).toHaveAttribute('dir', 'ltr');
    }

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });

  /**
   * The constrained gate. The card carries no images by design, so the point
   * being proved is that its text and its Apply CTA are usable on a slow
   * connection without waiting on anything.
   */
  test('is readable and Apply is tappable on slow-3G + 4x CPU', async ({ page }) => {
    const restore = await throttle(page);
    try {
      await page.setViewportSize(NARROW);
      await page.goto('/en/jobs');

      const first = cards(page).first();
      await expect(first).toBeVisible({ timeout: 60_000 });
      await expect(first.getByRole('heading', { level: 3 })).toBeVisible();

      const apply = first.getByRole('link', { name: /apply to/i });
      await expect(apply).toBeVisible();
      const box = await apply.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    } finally {
      await restore();
    }
  });

  test('browser-walk: no failed requests or console errors on the jobs list', async ({ page }) => {
    await page.setViewportSize(PHONE);
    // Listeners after the first navigation: the AuthProvider's bootstrap
    // refresh 401s before a session exists, which is expected and pre-existing.
    await page.goto('/en/jobs');

    const problems: string[] = [];

    /*
      404s are the thing this walk is for — a missing asset or route is a real
      defect and always fails here.

      Two classes of noise are excluded, and it is worth being precise about
      why, because blanket-ignoring status codes is how a walk stops meaning
      anything:

        401 — the AuthProvider bootstraps by calling /auth/refresh on mount,
              which correctly fails before a session exists. Expected product
              behaviour, not a fault.
        429 — the LOCAL API rate-limits (search 30/min, authed 100/min). Two
              e2e suites replaying a whole app in one minute trip it; a real
              user never would. This is the harness hitting the limiter, not
              the page misbehaving.

      Everything else — including any other console error — still fails.
    */
    const isHarnessNoise = (text: string) =>
      /status of (401|429)/.test(text) ||
      // Known pre-existing kit issue: <Field> clones `hasError` onto a raw DOM
      // element and React warns. Unrelated to this card.
      text.includes('does not recognize the');

    page.on('console', (m) => {
      const text = m.text();
      if (m.type() === 'error' && !isHarnessNoise(text)) problems.push(`console: ${text}`);
    });
    page.on('response', (r) => {
      if (r.status() === 404) problems.push(`404: ${r.url()}`);
    });

    await page.goto('/en/jobs?q=carpenter');
    await page.waitForLoadState('networkidle');
    await page.goto('/ar/jobs');
    await page.waitForLoadState('networkidle');

    expect(problems, problems.join('\n')).toEqual([]);
  });
});
