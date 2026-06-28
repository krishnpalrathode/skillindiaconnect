'use client';
import { useEffect, useState } from 'react';

interface MockSetupProps {
  children: React.ReactNode;
}

// Starts the MSW service worker and gates rendering of children until the
// worker is active. This prevents the AuthProvider's doRefresh() bootstrap
// call from escaping the SW and hitting the real Next.js server before any
// /api/v1/* handlers are registered — which caused a spurious network error
// on every cold page load in development.
//
// When NEXT_PUBLIC_API_MOCKING is not 'enabled' this component is a no-op
// pass-through and adds zero overhead to production builds.
export function MockSetup({ children }: MockSetupProps) {
  const isMocking = process.env['NEXT_PUBLIC_API_MOCKING'] === 'enabled';
  const [ready, setReady] = useState(!isMocking);

  useEffect(() => {
    if (!isMocking) return;

    import('./browser')
      .then(({ worker }) =>
        worker.start({
          onUnhandledRequest: 'warn',
          serviceWorker: { url: '/mockServiceWorker.js' },
        }),
      )
      .then(() => setReady(true))
      .catch((err) => {
        console.error('[MSW] Failed to start service worker', err);
        // Unblock rendering even on error so the app doesn't hang.
        setReady(true);
      });
  }, [isMocking]);

  if (!ready) return null;

  return <>{children}</>;
}
