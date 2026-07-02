import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // output: 'standalone' is enabled only in the Docker build (Linux) via NEXT_STANDALONE=1.
  // On Windows, pnpm's virtual-store symlinks require Developer Mode for standalone mode.
  // The Dockerfile re-enables this via a build arg in Prompt 4.
  transpilePackages: ['@skillindiaconnect/shared-types'],
  // Keep MSW and its interceptors as Node.js externals so Webpack doesn't
  // attempt to bundle them. msw/node relies on @mswjs/interceptors which
  // has package.json exports that Webpack can't resolve (./ClientRequest etc.).
  // Both the stable top-level option AND the experimental fallback are set to
  // ensure coverage across Next.js 14.x patch versions.
  serverExternalPackages: ['msw', '@mswjs/interceptors'],
  experimental: {
    // Required for src/instrumentation.ts to be picked up in Next.js 14.x.
    instrumentationHook: true,
    // Fallback name used by older 14.x builds.
    serverComponentsExternalPackages: ['msw', '@mswjs/interceptors'],
  },
  webpack(config, { isServer }) {
    if (isServer) {
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
