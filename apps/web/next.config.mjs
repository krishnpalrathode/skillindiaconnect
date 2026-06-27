import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // output: 'standalone' is enabled only in the Docker build (Linux) via NEXT_STANDALONE=1.
  // On Windows, pnpm's virtual-store symlinks require Developer Mode for standalone mode.
  // The Dockerfile re-enables this via a build arg in Prompt 4.
  transpilePackages: ['@skillindiaconnect/shared-types'],
};

export default withNextIntl(nextConfig);
