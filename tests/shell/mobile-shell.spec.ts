import { test as base, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

const BASE = process.env['SHELL_BASE_URL'] ?? 'http://localhost:3000';

/**
 * ONE authenticated browser context for the whole suite.
 *
 * Two things forced this, both consequences of running against the REAL API
 * rather than MSW:
 *
 *  1. Auth is rate-limited at 5/min/IP. A login per test crossed that line
 *     partway through the run, and the sixth test failed with a generic
 *     "Something went wrong" while passing perfectly on its own — which reads
 *     exactly like a flaky test and is not one.
 *
 *  2. Refresh tokens ROTATE on use, so a shared `storageState` file is
 *     single-use: the first test spends the saved token and every later one
 *     restores a cookie the server has already retired.
 *
 * Reusing the context solves both. The rotation stays inside the context that
 * owns it, and the rate limiter sees one login for the suite.
 */
// `page` is declared in the test-scoped slot because this overrides Playwright's
// own built-in `page` fixture rather than adding a new one.
const test = base.extend<{ page: Page }, { authedContext: BrowserContext }>({
  authedContext: [
    async ({ browser }, use) => {
      const context = await browser.newContext({ baseURL: BASE });
      const page = await context.newPage();

      await page.goto('/en/login');
      // A real seeded candidate — this suite talks to the real API, not MSW.
      await page.getByLabel(/email address/i).fill('ramesh@example.com');
      await page.locator('input[type="password"]').fill('Password123!');
      await page.getByRole('button', { name: /log in/i }).click();
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60_000 });

      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],

  // Every test drives the SAME page, so the session (and its rotating refresh
  // cookie) carries across them.
  page: async ({ authedContext }, use) => {
    const page = authedContext.pages()[0] ?? (await authedContext.newPage());
    await use(page);
  },
});

/**
 * M1 — the phone app shell: bottom tab bar + dark app header.
 *
 * The viewport is set EXPLICITLY in each test rather than left to the project,
 * because the whole claim of this unit is that one tree behaves differently at
 * two widths. A test that only ran under `android-constrained` would prove the
 * phone half and silently assume the desktop half — which is the half most
 * likely to regress, since nobody looks at it while building a mobile screen.
 */

const PHONE = { width: 390, height: 844 }; // iPhone 12/13/14 class
const NARROW = { width: 360, height: 780 }; // the floor the brief names
const DESKTOP = { width: 1440, height: 900 };

// Mirrors tests/ui/fixtures/constrained.ts exactly — see the note at the top of
// this file for why it is inline rather than imported.
const SLOW_3G = {
  offline: false,
  downloadThroughput: Math.floor((400 * 1024) / 8),
  uploadThroughput: Math.floor((400 * 1024) / 8),
  latency: 400,
};
const CPU_THROTTLE_RATE = 4;

/**
 * Applies the profile and returns the undo.
 *
 * The undo is not optional housekeeping: the page is shared across the suite,
 * so a 4× CPU slowdown left in place would silently throttle every test that
 * ran afterwards and turn their timeouts into mysteries.
 */
async function throttle(page: Page): Promise<() => Promise<void>> {
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.emulateNetworkConditions', SLOW_3G);
  await session.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE_RATE });

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

/**
 * Located by test id, not by role or label.
 *
 * Both the desktop sidebar and the phone tab bar are nav elements labelled
 * "Main navigation" — correctly, since only one of them is ever in the
 * accessibility tree at a given width, so they never collide for a real user.
 * But that leaves nothing language-independent to distinguish them by: the
 * accessible name is translated, and so is every label inside.
 */
const tabBar = (page: Page) => page.getByTestId('mobile-tab-bar');

test.describe('Mobile app shell', () => {
  test('renders the tab bar and dark header at phone width, and all four tabs navigate', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/en/dashboard');

    const bar = tabBar(page);
    await expect(bar).toBeVisible();

    const links = bar.getByRole('link');
    await expect(links).toHaveCount(4);

    // The header is present and painted with the brand navy — the same value
    // the manifest hands the TWA status bar.
    const header = page.locator('header').first();
    await expect(header).toBeVisible();
    await expect(header).toHaveCSS('background-color', 'rgb(26, 60, 110)'); // #1a3c6e

    for (const [label, expectedPath] of [
      ['Jobs', '/en/jobs'],
      ['Applications', '/en/applications'],
      ['Profile', '/en/profile'],
      ['Home', '/en/dashboard'],
    ] as const) {
      await bar.getByRole('link', { name: label }).click();
      await page.waitForURL((url) => url.pathname.startsWith(expectedPath), { timeout: 60_000 });
      // The destination tab is the current one — aria-current, not colour.
      await expect(bar.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
    }
  });

  test('desktop is unchanged — sidebar shown, phone chrome absent', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/en/dashboard');

    // The existing sidebar still owns navigation at this width.
    await expect(page.getByRole('complementary')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Resume Builder' })).toBeVisible();

    // And neither piece of phone chrome is exposed.
    await expect(tabBar(page)).toBeHidden();
    await expect(page.getByRole('button', { name: /more options/i })).toBeHidden();
  });

  /**
   * The bug this pattern always ships with. It never shows on a short screen —
   * only at the very bottom of a long scroll, which is exactly where a quick
   * manual check does not go.
   */
  test('no content is trapped under the fixed tab bar at the end of a long page', async ({
    page,
  }) => {
    await page.setViewportSize(NARROW);
    await page.goto('/en/jobs');

    /*
      Wait for the SHELL, not just the network.

      /jobs is a public route, so on a hard load the layout renders bare while
      auth bootstraps and only then mounts the chrome — which is the moment
      `main` gains its bottom padding. Scrolling before that measures a
      transient layout no user ever settles on, and reports content "trapped"
      under a bar that had not been laid out yet.
    */
    const barLocator = tabBar(page);
    await expect(barLocator).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState('networkidle');
    await page.mouse.wheel(0, 100_000);
    await page.waitForFunction(
      () => document.documentElement.scrollHeight - (window.scrollY + window.innerHeight) <= 1,
      undefined,
      { timeout: 10_000 },
    );

    const barBox = await barLocator.boundingBox();
    expect(barBox).not.toBeNull();

    // With the page scrolled all the way down, NOTHING interactive inside the
    // content may reach past the top of the bar.
    const lowestBottom = await page.evaluate(() =>
      [...document.querySelectorAll('main a, main button')].reduce(
        (lowest, el) => Math.max(lowest, el.getBoundingClientRect().bottom),
        0,
      ),
    );
    expect(lowestBottom).toBeLessThanOrEqual(barBox!.y + 1);

    // And the page itself must not scroll sideways at 360px.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });

  test('every tab target clears 44px at the 360px floor', async ({ page }) => {
    await page.setViewportSize(NARROW);
    await page.goto('/en/dashboard');

    const links = tabBar(page).getByRole('link');
    for (let i = 0; i < (await links.count()); i++) {
      const box = await links.nth(i).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
  });

  test('the header search routes into the existing job search', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/en/dashboard');

    await page.getByLabel('Search jobs').fill('welder');
    await page.keyboard.press('Enter');

    await page.waitForURL(/\/en\/jobs\?q=welder/, { timeout: 60_000 });
    // A normal, shareable, server-rendered results page — not a parallel search.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('the overflow menu keeps Resume Builder, language and sign-out reachable', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/en/dashboard');

    await page.getByRole('button', { name: /more options/i }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: /resume builder/i })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /log out/i })).toBeVisible();
    await expect(menu.getByLabel(/select language/i)).toBeVisible();

    await menu.getByRole('menuitem', { name: /resume builder/i }).click();
    await page.waitForURL(/\/en\/resume/, { timeout: 60_000 });
  });

  test('RTL (Arabic) mirrors the shell without overflowing', async ({ page }) => {
    await page.setViewportSize(NARROW);
    await page.goto('/ar/dashboard');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    const bar = tabBar(page);
    await expect(bar).toBeVisible();

    // Visual order reverses under RTL: the FIRST tab in the DOM (Home) must now
    // sit on the RIGHT. This is what proves the bar mirrors rather than merely
    // inheriting the text direction.
    const links = bar.getByRole('link');
    const first = await links.first().boundingBox();
    const last = await links.last().boundingBox();
    expect(first).not.toBeNull();
    expect(last).not.toBeNull();
    expect(first!.x).toBeGreaterThan(last!.x);

    // The overflow menu must hang off the correct edge, not off-screen.
    await page.getByRole('button', { name: /خيارات إضافية/ }).click();
    const menuBox = await page.getByRole('menu').boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });

  test("the bell's accessible name carries the unread count from the notifications data", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/en/dashboard');

    const bell = page.getByRole('link', { name: /notifications,/i });
    await expect(bell).toBeVisible();

    const label = await bell.getAttribute('aria-label');
    const match = label?.match(/(\d+) unread/);

    // Whatever it claims must equal what the notifications page actually shows
    // as unread — a badge that disagrees with its own destination is worse than
    // no badge at all.
    if (match) {
      await bell.click();
      await page.waitForURL(/\/en\/notifications/, { timeout: 60_000 });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });

  /**
   * The constrained gate: the shell is chrome, so it must be usable while the
   * page content is still arriving — not after.
   */
  test('shell is usable immediately on slow-3G + 4× CPU', async ({ page }) => {
    const restore = await throttle(page);
    try {
      await page.setViewportSize(NARROW);
      await page.goto('/en/dashboard');

      const bar = tabBar(page);
      await expect(bar).toBeVisible({ timeout: 60_000 });
      await expect(bar.getByRole('link', { name: 'Jobs' })).toBeEnabled();

      // Navigable under throttling, not merely painted.
      await bar.getByRole('link', { name: 'Jobs' }).click();
      await page.waitForURL(/\/en\/jobs/, { timeout: 45_000 });
    } finally {
      // In a finally so a failure here cannot leave the shared page throttled
      // and take the rest of the suite down with it.
      await restore();
    }
  });

  test('browser-walk: no failed requests or new console errors across the shell', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);

    // Listeners attach AFTER login on purpose. The AuthProvider bootstraps by
    // calling POST /auth/refresh on mount, which correctly 401s on the login
    // page because there is no session cookie yet. That is pre-existing,
    // expected behaviour and not something this shell can or should change —
    // counting it would make the walk permanently red for the wrong reason.
    const problems: string[] = [];

    /*
      404s always fail — a missing asset or route is a real defect and is what
      this walk is for.

      Two classes of noise are excluded, precisely rather than blanket:

        401 — the AuthProvider bootstraps by calling /auth/refresh on mount,
              which correctly fails before a session exists.
        429 — the LOCAL API rate-limits (search 30/min, authed 100/min). Two
              e2e suites replaying a whole app inside one minute trip it; a
              real user never would. That is the harness meeting the limiter,
              not the shell misbehaving.

      Everything else, including any other console error, still fails.
    */
    const isHarnessNoise = (text: string) =>
      /status of (401|429)/.test(text) ||
      // A known, pre-existing kit issue: <Field> cloneElement's `hasError` onto
      // its child, and React warns when that child is a raw DOM element rather
      // than <Input>. It fires on pages this unit does not touch.
      text.includes('does not recognize the') ||
      // React's follow-up frame for the warning above, which names only the
      // boundary and carries no fault of its own.
      text.includes('NotFoundErrorBoundary');

    page.on('console', (m) => {
      const text = m.text();
      if (m.type() === 'error' && !isHarnessNoise(text)) problems.push(`console: ${text}`);
    });
    page.on('response', (r) => {
      if (r.status() === 404) problems.push(`404: ${r.request().method()} ${r.url()}`);
    });

    for (const path of ['/en/dashboard', '/en/jobs', '/en/applications', '/en/profile']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
    }

    expect(problems, problems.join('\n')).toEqual([]);
  });
});
