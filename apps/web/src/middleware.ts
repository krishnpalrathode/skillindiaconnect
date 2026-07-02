import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

/* next-intl locale middleware.
   MSW is client-side only (mock-setup.tsx useEffect) — no server middleware
   conflict. The matcher intentionally excludes api/, _next/, static assets,
   and the dev kitchen-sink route (accessible without locale prefix in dev). */
export default createMiddleware(routing);

export const config = {
  matcher: [
    /* Match all paths except Next.js internals, static files, and kitchen-sink */
    '/((?!api|_next/static|_next/image|favicon.ico|mockServiceWorker.js|kitchen-sink|.*\\..*).*)',
  ],
};
