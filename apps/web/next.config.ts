import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@gp/core', '@gp/db'],
  serverExternalPackages: ['@node-rs/argon2'],
  poweredByHeader: false,
  devIndicators: false,
  experimental: {
    // Guest list uploads are up to 5 MB (checked again in @gp/core); multipart adds a little.
    serverActions: { bodySizeLimit: '6mb' },
  },
};

export default withNextIntl(nextConfig);
