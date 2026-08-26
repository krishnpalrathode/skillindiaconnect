import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * M4 — the logged-out entry screen.
 *
 * No authenticated fixture here, deliberately: this is the public landing page,
 * so the tests run exactly as a stranger (or a crawler) meets it. That also
 * keeps this file clear of the API's auth rate limit entirely.
 */

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

const primaryCta = (page: Page) => page.getByRole('link', { name: /find verified jobs/i });
const secondaryCta = (page: Page) => page.getByRole('link', { name: /hire skilled talent/i });

test.describe('Entry screen — phone', () => {
  test('leads with the worker-protection promise, the mark and three value points', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/en');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Skill India Connect', { exact: true }).first()).toBeVisible();

    // The promise, in full — it is an enforced platform rule, not a slogan.
    const promise = page.getByText(/every job on skill india connect/i);
    await expect(promise).toBeVisible();
    const text = await promise.innerText();
    expect(text).toMatch(/place to stay/i);
    expect(text).toMatch(/health insurance/i);
    expect(text).toMatch(/transport/i);

    /*
      Scoped to the hero's own badge row. These three claims deliberately
      appear twice on the page — the navy announcement bar states them at the
      top and the hero restates them at the point of decision — so an
      unscoped match is ambiguous.
    */
    const hero = page.locator('section').filter({ has: page.getByRole('heading', { level: 1 }) });
    for (const point of [
      'Verified Employers',
      'Free for Workers',
      'India & Global Opportunities',
    ]) {
      await expect(hero.getByText(point, { exact: true })).toBeVisible();
    }
  });

  test('both CTAs route where they say, and there is no third path', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/en');
    await page.waitForLoadState('networkidle');

    await expect(primaryCta(page)).toHaveAttribute('href', '/en/jobs');
    await expect(secondaryCta(page)).toHaveAttribute('href', '/en/signup?role=employer');

    // Search is already what the primary CTA does; a third route to the same
    // listings would be a choice with no difference behind it.
    await expect(page.getByText(/browse as guest/i)).toHaveCount(0);
  });

  test('the primary CTA really lands on the public job search', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/en');
    await page.waitForLoadState('networkidle');

    await primaryCta(page).click();
    await page.waitForURL(/\/en\/jobs/, { timeout: 60_000 });
    // Reached without signing in — the search is genuinely public.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  /**
   * A returning candidate who already has an account must not be stranded on a
   * screen offering only "find jobs" and "hire talent".
   */
  test('sign-in stays reachable from the sticky header', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/en');
    await page.waitForLoadState('networkidle');

    const login = page.getByRole('link', { name: /^login$/i }).first();
    await expect(login).toBeVisible();
    await expect(login).toHaveAttribute('href', '/en/login');

    const box = await login.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  /**
   * The entry screen argues that we do not invent things. Following it with
   * "25,000+ workers" one scroll later would undo that, so the stats band is
   * desktop-only.
   */
  test('publishes no fabricated statistics at phone width', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/en');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/trusted by/i)).toHaveCount(0);
    // The stats band's markup still ships (so nothing is deleted from the
    // crawlable page) but it is not shown here.
    await expect(page.getByText('25,000+')).toBeHidden();
  });

  test('nothing overflows sideways at the 360px floor', async ({ page }) => {
    await page.setViewportSize(NARROW);
    await page.goto('/en');
    await page.waitForLoadState('networkidle');

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });
});

test.describe('Entry screen — desktop landing unchanged', () => {
  test('keeps the stats band and the left-aligned hero', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/en');
    await page.waitForLoadState('networkidle');

    // The band is back at desktop, exactly as before this unit.
    await expect(page.getByText('25,000+')).toBeVisible();

    // And the phone-only mark/wordmark block is not shown.
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveCSS('text-align', 'start');
  });

  test('still shows every landing section', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/en');
    await page.waitForLoadState('networkidle');

    for (const heading of [
      /why workers trust us/i,
      /latest jobs/i,
      /how it works/i,
      /every job protects you/i,
      /jobs by trade/i,
      /hiring skilled workers/i,
    ]) {
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
    }
  });
});

test.describe('Entry screen — SEO, RTL, constrained', () => {
  /**
   * The real risk in this unit. A restyle that strips server-rendered content
   * costs organic traffic silently — nothing breaks, the page just stops being
   * found. This fetches the RAW response, exactly what a crawler receives, with
   * no JavaScript involved.
   */
  test('server-rendered HTML still carries the metadata and every section', async ({ request }) => {
    const res = await request.get('/en');
    expect(res.status()).toBe(200);
    const html = await res.text();

    expect(html).toMatch(/<title>[^<]*Skill India Connect[^<]*<\/title>/);
    expect(html).toMatch(/<meta name="description"/);
    expect(html).toMatch(/<h1[^>]*>/);

    // The promise and every indexable section, in the server payload.
    expect(html).toContain('Every job on Skill India Connect');
    for (const section of [
      'Why Workers Trust Us',
      'Latest jobs, posted this week',
      'How it works',
      'Every job protects you',
      'Jobs by trade',
      'Hiring skilled workers?',
    ]) {
      expect(html, `"${section}" missing from server HTML`).toContain(section);
    }

    // The CTA's destination is in the markup, not applied by client JS.
    expect(html).toContain('href="/en/jobs"');
  });

  test('mirrors in Arabic without overflowing', async ({ page }) => {
    await page.setViewportSize(NARROW);
    await page.goto('/ar');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });

  /**
   * On a 3G connection this is the difference between a bounce and a signup:
   * the promise and both buttons have to be there while the photographs are
   * still arriving, and must not move when they land.
   */
  test('promise and CTAs are usable before the imagery, with no shift after', async ({ page }) => {
    const restore = await throttle(page);
    try {
      await page.setViewportSize(NARROW);
      await page.goto('/en');

      const promise = page.getByText(/every job on skill india connect/i);
      await expect(promise).toBeVisible({ timeout: 60_000 });
      await expect(primaryCta(page)).toBeVisible();
      await expect(secondaryCta(page)).toBeVisible();

      const cta = primaryCta(page);
      expect((await cta.boundingBox())!.height).toBeGreaterThanOrEqual(44);

      /*
        Measured relative to the HERO, not the viewport: an absolute position
        also moves when the sticky header settles, which would blame the
        carousel for a shift it did not cause. The carousel sits in a fixed
        aspect-[4/3] frame, so it reserves its own space and cannot reflow the
        copy above it.
      */
      const offset = async () => {
        const h = await page.getByRole('heading', { level: 1 }).boundingBox();
        const c = await cta.boundingBox();
        return c!.y - h!.y;
      };

      /*
        Wait for FONTS before the first measurement.

        Under slow-3G the web font arrives late and swaps; text metrics change,
        the copy above the button re-wraps, and the button moves — for a reason
        that has nothing to do with the image this test is about. Settling the
        fonts first isolates the only thing being claimed: that the decorative
        image cannot reflow the CTA.
      */
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const before = await offset();
      await page.waitForLoadState('networkidle');
      expect(Math.abs((await offset()) - before)).toBeLessThanOrEqual(1);
    } finally {
      await restore();
    }
  });

  test('browser-walk: no 404s or unexpected console errors', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/en');

    const problems: string[] = [];

    /*
      404s always fail — that is what this walk is for. Excluded precisely:
      401 (an auth-bootstrap refresh with no session, which is exactly the
      logged-out case here), 429 (the local API's rate limiter meeting several
      e2e suites in a minute), and two known pre-existing dev/kit warnings.
    */
    const isHarnessNoise = (text: string) =>
      /status of (401|429)/.test(text) ||
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

    await page.goto('/ar');
    await page.waitForLoadState('networkidle');

    expect(problems, problems.join('\n')).toEqual([]);
  });
});
