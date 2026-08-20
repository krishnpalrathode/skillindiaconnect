'use client';

import { useEffect } from 'react';

/**
 * Registers the app-shell service worker.
 *
 * ── Why this is gated on MSW ────────────────────────────────────────────────
 * MSW registers its own worker at `/mockServiceWorker.js` with scope `/` (see
 * mocks/mock-setup.tsx). Two workers competing for one scope is a real
 * dev-time failure: whichever registers last controls the page, so API mocking
 * silently stops working — or our shell cache does — depending on a race.
 *
 * Rather than fight over scope, we simply do not register when mocking is on.
 * Mock mode is a development tool; the shell cache is a production concern, and
 * nothing needs both at once.
 *
 * Renders nothing. Registration is a side effect, deliberately after paint —
 * on the cheap Android phones this app targets, the first render matters more
 * than the worker being ready a few hundred milliseconds sooner.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_API_MOCKING === 'enabled') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    // `scope: '/'` is explicit rather than implied: the worker lives at the root
    // and must control every locale prefix (/en, /hi, /ar …), not just its own
    // directory.
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
      // A failed registration must never break the page — the app works fine
      // without a service worker, it is just slower on repeat visits.
      console.error('[PWA] Service worker registration failed', err);
    });
  }, []);

  return null;
}
