'use client';
import { useEffect } from 'react';

interface MockSetupProps {
  children: React.ReactNode;
}

// Starts the MSW browser service worker in the background. Children render
// immediately — both during SSR and the first client paint — so SSR/SEO
// pages are never hidden behind a client-only "ready" gate (the previous
// version returned null until the worker started, which meant view-source
// showed an empty shell for every page while mocking was enabled).
//
// Server-side data fetching does NOT depend on this worker at all — it's
// intercepted by the separate Node MSW server wired up in instrumentation.ts.
// This component only covers client-side (post-hydration) fetches, e.g.
// AuthProvider's doRefresh() bootstrap call. That call already fails closed
// (treats an unintercepted request as "not logged in") so a brief race
// against worker startup on a cold load is harmless and self-corrects on
// the next navigation once the worker is running.
//
// When NEXT_PUBLIC_API_MOCKING is not 'enabled' this component is a no-op
// pass-through and adds zero overhead to production builds.
export function MockSetup({ children }: MockSetupProps) {
  const isMocking = process.env['NEXT_PUBLIC_API_MOCKING'] === 'enabled';

  useEffect(() => {
    if (!isMocking) return;

    import('./browser')
      .then(({ worker }) =>
        worker.start({
          onUnhandledRequest: 'warn',
          serviceWorker: { url: '/mockServiceWorker.js' },
        }),
      )
      .catch((err) => {
        console.error('[MSW] Failed to start service worker', err);
      });
  }, [isMocking]);

  return <>{children}</>;
}
