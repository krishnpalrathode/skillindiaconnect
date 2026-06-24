'use client';
import { useEffect } from 'react';

export function MockSetup() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_API_MOCKING !== 'enabled') return;

    import('./browser')
      .then(({ worker }) =>
        worker.start({
          onUnhandledRequest: 'warn',
          serviceWorker: { url: '/mockServiceWorker.js' },
        }),
      )
      .catch(console.error);
  }, []);

  return null;
}
