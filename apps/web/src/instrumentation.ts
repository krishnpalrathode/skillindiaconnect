// Next.js instrumentation hook (experimental.instrumentationHook required in 14.x).
// `register()` runs once per server runtime when the Next.js server boots.
//
// Server Components fetch data during SSR using plain Node `fetch()` against an
// absolute URL (see lib/api/server-fetch.ts). The browser-only MSW service worker
// (mocks/browser.ts, started by MockSetup) cannot intercept those — there is no
// browser tab involved during SSR. Without a Node-side interceptor, SSR fetches
// in dev would either hit a real (nonexistent) backend and 404/ECONNREFUSED, or
// silently fall back to client-fetch-after-mount, defeating SEO.
//
// setupServer(...handlers) here intercepts any fetch() issued from this Node
// process — including ones made while rendering a Server Component — against the
// SAME shared `handlers.ts` used by the browser worker and by vitest. No second
// mock implementation to drift out of sync.
//
// next.config.mjs must also mark msw and @mswjs/interceptors as server externals
// (both serverExternalPackages and the webpack externals fn) to prevent Webpack
// from trying to bundle them — msw/node has package.json export paths that
// Webpack can't resolve in the instrumentation compilation context.
export async function register() {
  // Build-time guard, deliberately first and deliberately NOT combined with the
  // checks below. Webpack inlines process.env.NODE_ENV, so in a production
  // compile this becomes `if (true) return;` and everything after it — including
  // the import of the MSW server — is dead code that gets eliminated. The
  // NEXT_RUNTIME / API_MOCKING checks below are runtime-only and cannot do that:
  // the import stays statically linked, which is how msw/node ended up in the
  // edge bundle and broke the Vercel deploy.
  if (process.env.NODE_ENV === 'production') return;

  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  if (process.env['NEXT_PUBLIC_API_MOCKING'] !== 'enabled') return;

  const { server } = await import('./mocks/server');
  server.listen({ onUnhandledRequest: 'bypass' });
}
