import fs from 'node:fs';
import path from 'node:path';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// The monorepo keeps ONE .env at the root; apps/api reads it via ROOT_ENV_PATH.
// Next only auto-loads .env files from apps/web, so without this the root
// NEXT_PUBLIC_API_URL never reaches the bundle and API_BASE silently degrades to
// a relative '/api/v1' — which posts back at the web origin and 404s.
// ONLY NEXT_PUBLIC_* keys are copied: everything else in that file is a secret
// and must never be inlined into a client bundle. A real process.env value wins,
// so Railway (where the file is absent) is unaffected.
function rootPublicEnv() {
  const rootEnv = path.resolve(process.cwd(), '../../.env');
  if (!fs.existsSync(rootEnv)) return {};

  const env = {};
  // Split on \r?\n: this file is gitignored, so .gitattributes never normalizes
  // it and a Windows checkout leaves CRLF. A trailing \r would defeat the regex
  // below ('.' does not match \r) and silently parse to nothing.
  for (const line of fs.readFileSync(rootEnv, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(NEXT_PUBLIC_[A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    env[key] = process.env[key] ?? rawValue.trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: rootPublicEnv(),
  /*
    The service worker must be REVALIDATED on every navigation, not served from
    the HTTP cache. This is what makes the kill switch work: disabling a bad
    worker means deploying a replacement sw.js, and the browser only picks that
    up if it actually re-fetches the file. A long-lived cached sw.js would leave
    users pinned to the broken version with no remote way to reach them.

    offline.html gets the same treatment for a smaller reason — it is precached
    by the worker at install, so a stale HTTP copy would be frozen in until the
    cache version is bumped.
  */
  async headers() {
    return [
      {
        source: '/:file(sw.js|offline.html)',
        headers: [{ key: 'Cache-Control', value: 'no-cache, must-revalidate' }],
      },
    ];
  },
  // output: 'standalone' is enabled only in the Docker build (Linux) via NEXT_STANDALONE=1.
  // On Windows, pnpm's virtual-store symlinks require Developer Mode for standalone mode.
  // The Dockerfile re-enables this via a build arg in Prompt 4.
  transpilePackages: ['@skillindiaconnect/shared-types'],
  // Keep MSW and its interceptors as Node.js externals so Webpack doesn't
  // attempt to bundle them. msw/node relies on @mswjs/interceptors which
  // has package.json exports that Webpack can't resolve (./ClientRequest etc.).
  //
  // NOTE: the top-level `serverExternalPackages` key belongs to Next 15. On 14.x
  // it is not just inert — it logs "Unrecognized key(s) in object" and is
  // ignored, which is why MSW kept reaching the bundle. The 14.x spelling is
  // experimental.serverComponentsExternalPackages, below.
  experimental: {
    // Required for src/instrumentation.ts to be picked up in Next.js 14.x.
    instrumentationHook: true,
    serverComponentsExternalPackages: ['msw', '@mswjs/interceptors'],
  },
  webpack(config, { isServer, nextRuntime }) {
    // ── Edge runtime ────────────────────────────────────────────────────────
    // instrumentationHook makes Next compile instrumentation.ts for EVERY
    // runtime, and the edge copy is bundled alongside middleware. Its
    // `await import('./mocks/server')` is statically analysable, so msw/node
    // followed it into the edge bundle and Vercel refused to deploy:
    //   The Edge Function "src/middleware" is referencing unsupported modules
    // Marking MSW *external* does not help here — that just turns it into a
    // runtime require the edge sandbox cannot satisfy. It has to resolve away
    // to nothing instead. MSW is dev-only tooling, so an empty module in the
    // edge bundle is exactly right.
    if (nextRuntime === 'edge') {
      config.resolve = config.resolve ?? {};
      config.resolve.alias = {
        ...(config.resolve.alias ?? {}),
        msw: false,
        'msw/node': false,
        'msw/browser': false,
        '@mswjs/interceptors': false,
      };
    }

    if (isServer && nextRuntime !== 'edge') {
      // The instrumentation module compilation uses a separate Webpack config
      // that doesn't honour serverExternalPackages, so we manually push MSW
      // onto the externals list. Without this, Webpack tries to bundle
      // msw/node's ./ClientRequest export which is absent from the package's
      // exports map and throws a Module-not-found error.
      const mswExternalFn = (ctx, callback) => {
        if (ctx.request === 'msw' || ctx.request === 'msw/node' || (ctx.request && ctx.request.startsWith('@mswjs/'))) {
          return callback(null, `commonjs ${ctx.request}`);
        }
        callback();
      };
      config.externals = Array.isArray(config.externals)
        ? [...config.externals, mswExternalFn]
        : [config.externals, mswExternalFn].filter(Boolean);
    }
    return config;
  },
};

export default withNextIntl(nextConfig);
