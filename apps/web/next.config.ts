import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@gp/core', '@gp/db'],
  serverExternalPackages: ['@node-rs/argon2'],
  poweredByHeader: false,
};

export default withNextIntl(nextConfig);
