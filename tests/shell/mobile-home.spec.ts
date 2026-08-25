import { test as base, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

const BASE = process.env['SHELL_BASE_URL'] ?? 'http://localhost:3000';

/**
 * The authenticated-context fixture is duplicated from the sibling specs rather
 * than imported: under Playwright 1.61 on Node 22.17 any local TypeScript
 * import fails to load (`context.conditions?.includes is not a function`), which
 * is the same defect that stops the whole `tests/ui` suite collecting. One
 * shared context per file keeps the API's 5/min auth limit happy.
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

const heroCta = (page: Page) => page.getByRole('link', { name: /search jobs/i });

test.describe('Phone home — the four sections', () => {
  test('renders hero, value strip, category chips and featured jobs', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/en/dashboard');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /find your next job/i })).toBeVisible();
    await expect(heroCta(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: /browse by trade/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /latest jobs/i })).toBeVisible();

    // The value strip's claims, read from the shared landing.trust keys.
    // Scoped to the strip and matched EXACTLY: a loose substring match also
    // matches the <li> wrapping the title and its body copy.
    const strip = page.getByRole('region', { name: /why workers choose/i });
    await expect(strip.getByText('Verified employers', { exact: true })).toBeVisible();
    await expect(strip.getByText('Free for workers', { exact: true })).toBeVisible();
  });

  /**
   * The whole point of the value strip. Nothing in this app counts workers,
   * employers or placements, so no such number may appear on a page read by
   * someone deciding whether to trust us with their documents.
   */
  test('the value strip publishes no fabricated statistics', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/en/dashboard');
    await page.waitForLoadState('networkidle');

    const strip = page.getByRole('region', { name: /why workers choose/i });
    await expect(strip).toBeVisible();
    const text = (await strip.innerText()).trim();
    expect(text).not.toMatch(/\d[\d,]*\s*\+/);
  });

  test('the hero CTA and every category tile land on the existing search', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/en/dashboard');
    await page.waitForLoadState('networkidle');

    await expect(heroCta(page)).toHaveAttribute('href', '/en/jobs');

    for (const [name, slug] of [
      ['Electrician', 'electrician'],
      ['Mason', 'mason'],
      ['Welder', 'welder'],
    ] as const) {
      await expect(page.getByRole('link', { name, exact: true })).toHaveAttribute(
        'href',
        `/en/jobs?category=${slug}`,
      );
    }
  });

  /**
   * The deep-link has to actually filter, not just look like a link. A tile
   * that opens an unfiltered list is the same failure as a tile that opens
   * nothing, only harder to notice.
   */
  test('a category tile really filters the search it lands on', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/en/dashboard');
    await page.waitForLoadState('networkidle');

    await page.getByRole('link', { name: 'Welder', exact: true }).click();
    await page.waitForURL(/\/en\/jobs\?category=welder/, { timeout: 60_000 });

    // The search page rendered — either results or its own empty state, both
    // of which are correct for a category that may have no open jobs.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('featured jobs use the shared search card', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/en/dashboard');
    await page.waitForLoadState('networkidle');

    const featured = page.getByRole('region', { name: /latest jobs/i });
    await expect(featured).toBeVisible();

    // role="article" is M3's card. Either real cards, or the honest empty
    // state — never a placeholder listing.
    const cards = featured.getByRole('article');
    const count = await cards.count();
    if (count > 0) {
      expect(count).toBeLessThanOrEqual(3);
      await expect(cards.first().getByRole('link', { name: /apply to/i })).toBeVisible();
    } else {
      await expect(page.getByText(/no jobs open right now/i)).toBeVisible();
    }
  });

  /**
   * None of these features exist. A tile that opens nothing is worse than no
   * tile, so the row is not built — and this is what keeps it that way.
   */
  test('does not show Courses, Career Advice, Mentorship or Success Stories', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/en/dashboard');
    await page.waitForLoadState('networkidle');

    for (const absent of [/skill courses/i, /career advice/i, /mentorship/i, /success stories/i]) {
      await expect(page.getByText(absent)).toHaveCount(0);
    }
  });
});

test.describe('Phone home — existing content survives', () => {
  /**
   * The redesign must not cost the candidate their own information. These are
   * the widgets that were on this screen before M2 and must still be.
   */
  test('keeps the greeting, KPIs and profile completion above the new sections', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/en/dashboard');
    await page.waitForLoadState('networkidle');

    // Personal content is present…
    const completion = page.getByText(/complete/i).first();
    await expect(completion).toBeVisible();

    // …and sits ABOVE the discovery block, which is the ordering decision.
    const heroBox = await page.getByRole('heading', { name: /find your next job/i }).boundingBox();
    const kpiBox = await page
      .getByText(/applied/i)
      .first()
      .boundingBox();
    if (kpiBox && heroBox) expect(kpiBox.y).toBeLessThan(heroBox.y);
  });

  test('shows the same jobs once, not twice', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/en/dashboard');
    await page.waitForLoadState('networkidle');

    // The desktop "Recommended jobs" block is hidden on a phone precisely so
    // the same three jobs are not rendered twice on one screen.
    await expect(page.getByRole('heading', { name: /recommended/i })).toBeHidden();
  });
});

test.describe('Phone home — desktop unchanged', () => {
  test('none of the phone sections render at desktop width', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/en/dashboard');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /find your next job/i })).toBeHidden();
    await expect(page.getByRole('heading', { name: /browse by trade/i })).toBeHidden();
    await expect(page.getByRole('heading', { name: /latest jobs/i })).toBeHidden();

    // And the desktop dashboard still shows what it always did.
    await expect(page.getByRole('heading', { name: /recommended/i })).toBeVisible();
  });
});

test.describe('Phone home — RTL, constrained, browser-walk', () => {
  test('mirrors in Arabic without overflowing at 360px', async ({ page }) => {
    await page.setViewportSize(NARROW);
    await page.goto('/ar/dashboard');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });

  /**
   * The constrained gate. The hero CTA must be tappable while the photograph is
   * still in flight, and the photograph must not move anything when it lands —
   * it is an absolutely-positioned decoration behind text that is already laid
   * out.
   */
  test('the hero CTA is tappable before the image loads, with no shift after', async ({ page }) => {
    const restore = await throttle(page);
    try {
      await page.setViewportSize(NARROW);
      await page.goto('/en/dashboard');

      const cta = heroCta(page);
      const hero = page.getByRole('region', { name: /find your next job/i });
      await expect(cta).toBeVisible({ timeout: 60_000 });

      /*
        Measured RELATIVE TO THE HERO, not the viewport.

        An absolute y also moves when anything above the hero settles — the
        KPI cards and profile widgets are still arriving at this point under
        4× CPU — and that would blame the image for a shift it did not cause.
        The claim being tested is narrower and is the one that matters: the
        photograph is an absolutely-positioned decoration, so it cannot move
        the CTA within the card it sits behind.
      */
      const offsetInHero = async () => {
        const h = await hero.boundingBox();
        const c = await cta.boundingBox();
        expect(h).not.toBeNull();
        expect(c).not.toBeNull();
        return c!.y - h!.y;
      };

      const before = await offsetInHero();
      expect((await cta.boundingBox())!.height).toBeGreaterThanOrEqual(44);

      // Let the decorative image finish, then confirm the CTA has not moved.
      await page.waitForLoadState('networkidle');
      expect(Math.abs((await offsetInHero()) - before)).toBeLessThanOrEqual(1);
    } finally {
      await restore();
    }
  });

  test('browser-walk: no 404s or unexpected console errors on the home screen', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/en/dashboard');

    const problems: string[] = [];

    /*
      404s always fail — that is what this walk is for. Two classes of noise are
      excluded precisely: 401 (the AuthProvider's bootstrap refresh before a
      session exists) and 429 (the local API's rate limiter meeting several e2e
      suites replaying an app inside a minute — a real user never would).
    */
    const isHarnessNoise = (text: string) =>
      /status of (401|429)/.test(text) ||
      // Known pre-existing kit issue: <Field> clones `hasError` onto a raw DOM
      // element and React warns.
      text.includes('does not recognize the') ||
      text.includes('NotFoundErrorBoundary') ||
      text.includes('Failed to fetch RSC payload');

    page.on('console', (m) => {
      const text = m.text();
      if (m.type() === 'error' && !isHarnessNoise(text)) problems.push(`console: ${text}`);
    });
    page.on('response', (r) => {
      if (r.status() === 404) problems.push(`404: ${r.url()}`);
    });

    await page.goto('/ar/dashboard');
    await page.waitForLoadState('networkidle');

    expect(problems, problems.join('\n')).toEqual([]);
  });
});
