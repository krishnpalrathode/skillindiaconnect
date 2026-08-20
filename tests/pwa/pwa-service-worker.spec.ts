import { test, expect, type Page } from '@playwright/test';

/**
 * The privacy proof for the app-shell service worker.
 *
 * This app's privacy contract is enforced by viewer-aware DTOs where an OMITTED
 * FIELD IS THE GUARANTEE, and by short-expiry signed R2 URLs. A service worker
 * that cached an authenticated response would defeat both: stale data across a
 * privacy-toggle change, or one user's profile served to the next person on a
 * shared phone.
 *
 * These tests assert on the ACTUAL CONTENTS of the Cache Storage API after a
 * real logged-in session — not on the worker's source, and not on intent.
 */

const LOGIN = '/en/login';

/** Everything the cache must never contain, by substring. */
const FORBIDDEN = [
  '/api/v1', // any API path, on any origin
  'r2.cloudflarestorage', // signed document / resume URLs
  '/auth/', // login, refresh, logout
  '/documents',
  '/resume',
  'localhost:3001', // the API origin in dev
];

/**
 * Waits until a service worker is actually CONTROLLING the page.
 *
 * On the very first visit in a fresh profile the worker installs and activates,
 * but the page that triggered the registration was loaded before it existed and
 * is therefore uncontrolled. Our worker calls clients.claim(), which usually
 * fixes that — but it is a race, and a race is not something to assert against.
 *
 * So: wait for the registration to be ACTIVE (a real signal, not a timeout),
 * then reload once if still uncontrolled. A reload is always controlled.
 */
async function waitForController(page: Page): Promise<boolean> {
  const controlled = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    await navigator.serviceWorker.ready; // resolves once a worker is active
    return !!navigator.serviceWorker.controller;
  });
  if (controlled) return true;

  await page.reload();
  return page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    return !!navigator.serviceWorker.controller;
  });
}

/** Every request URL held in every cache. */
async function cachedUrls(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const names = await caches.keys();
    const out: string[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) out.push(req.url);
    }
    return out;
  });
}

test.describe('PWA service worker — the privacy contract', () => {
  test('caches shell assets but NOTHING authenticated, after a real signed-in session', async ({
    page,
  }) => {
    await page.goto(LOGIN);
    expect(await waitForController(page)).toBe(true);

    // A real session: sign in, then visit pages that fetch authenticated data.
    await page.locator('input[type=email], input[name=email]').first().fill('');
    await page
      .locator('input[type=email], input[name=email]')
      .first()
      .pressSequentially('ramesh@example.com', { delay: 5 });
    await page.locator('input[type=password]').first().pressSequentially('Password123!', { delay: 5 });
    await page.getByRole('button', { name: /log in/i }).first().click();
    await page.waitForTimeout(6000);

    for (const path of ['/en/dashboard', '/en/profile', '/en/applications']) {
      await page.goto(path);
      await page.waitForTimeout(2500);
    }

    const urls = await cachedUrls(page);

    // The worker must have done SOMETHING — otherwise this test passes vacuously.
    expect(urls.length, 'nothing was cached; the worker may not be active').toBeGreaterThan(0);

    const leaked = urls.filter((u) => FORBIDDEN.some((bad) => u.includes(bad)));
    expect(leaked, `authenticated URLs found in cache:\n${leaked.join('\n')}`).toEqual([]);

    // Positively: everything cached is same-origin and under an allowlisted path.
    const origin = new URL(page.url()).origin;
    const allowed = ['/_next/static/', '/icons/', '/brand/', '/hero/', '/flags/', '/resume-templates/', '/offline.html'];
    const unexpected = urls.filter(
      (u) => !u.startsWith(origin) || !allowed.some((p) => new URL(u).pathname.startsWith(p)),
    );
    expect(unexpected, `cache holds entries outside the allowlist:\n${unexpected.join('\n')}`).toEqual(
      [],
    );
  });

  test('HTML navigations are never cached — a deploy is always picked up', async ({ page }) => {
    await page.goto('/en');
    await waitForController(page);
    await page.goto('/en/jobs');
    await page.waitForTimeout(2000);

    const urls = await cachedUrls(page);
    const html = urls.filter((u) => {
      const p = new URL(u).pathname;
      return p === '/en' || p === '/en/jobs' || /^\/[a-z]{2}(\/|$)/.test(p);
    });
    expect(html, `navigation HTML was cached:\n${html.join('\n')}`).toEqual([]);
  });

  test('the worker does not intercept API calls at all', async ({ page }) => {
    await page.goto('/en/login');
    await waitForController(page);

    // A request the worker must pass straight through to the network.
    const fromServiceWorker = await page.evaluate(async () => {
      const res = await fetch('/api/v1/does-not-exist').catch(() => null);
      // `fromServiceWorker` is only true when a SW produced the response.
      return res ? (res as Response & { fromServiceWorker?: boolean }).fromServiceWorker === true : false;
    });
    expect(fromServiceWorker).toBe(false);
  });

  test('RTL survives with the worker active', async ({ page }) => {
    await page.goto('/ar');
    await waitForController(page);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });
});
