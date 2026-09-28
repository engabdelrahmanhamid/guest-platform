import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@gp/core', '@gp/db'],
  serverExternalPackages: ['@node-rs/argon2', 'sharp'],
  poweredByHeader: false,
  devIndicators: false,
  experimental: {
    // Largest upload is an 8 MB cover image (guest lists are 5 MB); checked again in @gp/core.
    serverActions: { bodySizeLimit: '9mb' },
  },
  async headers() {
    // Personal invitation pages: never cached by shared caches, never indexed, and the
    // token in the URL is not sent to other sites as a referrer. (`same-origin` rather than
    // `no-referrer`: browsers send `Origin: null` under `no-referrer`, which would make the
    // answer form fail its origin check when JavaScript is off.)
    const privatePage = [
      { key: 'Cache-Control', value: 'private, no-store' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
    ];
    return [
      { source: '/i/:path*', headers: privatePage },
      { source: '/api/v1/public/:path*', headers: privatePage },
    ];
  },
};

export default withNextIntl(nextConfig);
