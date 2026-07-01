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
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  if (process.env['NEXT_PUBLIC_API_MOCKING'] !== 'enabled') return;

  const { server } = await import('./mocks/server');
  server.listen({ onUnhandledRequest: 'bypass' });
}
