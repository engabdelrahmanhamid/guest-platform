import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  output: 'standalone',
  // Trace dependencies from the monorepo root, so the standalone output holds everything the server
  // needs whichever folder a host builds from.
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  transpilePackages: ['@gp/core', '@gp/db'],
  serverExternalPackages: ['@node-rs/argon2', 'sharp'],
  poweredByHeader: false,
  devIndicators: false,
  experimental: {
    // Largest upload is an 8 MB cover image (guest lists are 5 MB); checked again in @gp/core.
    serverActions: { bodySizeLimit: '9mb' },
  },
  async headers() {
    // Personal invitation pages: never cached by shared caches, never indexed, and the token
    // in the URL never leaves in a Referer header: `origin` sends only the scheme and host, to
    // this site and to others. (`no-referrer` is not usable: browsers then send `Origin: null`
    // on a plain form POST, and the answer form fails Next's origin check when JavaScript is
    // off. Under `origin` the check still rejects any other or missing-host origin.)
    const privatePage = [
      { key: 'Cache-Control', value: 'private, no-store' },
      { key: 'Referrer-Policy', value: 'origin' },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
    ];
    // Every page: HTTPS only (browsers ignore HSTS on plain http, so it is harmless in
    // development), no content sniffing, no framing, and only this site may use the camera
    // (the door scanner needs it; nothing else is asked for).
    const everyPage = [
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
    ];
    return [
      { source: '/:path*', headers: everyPage },
      // Account links carry a one-time token in the query string.
      { source: '/reset-password', headers: privatePage },
      { source: '/verify-email', headers: privatePage },
      { source: '/i/:path*', headers: privatePage },
      { source: '/api/v1/public/:path*', headers: privatePage },
      // Staff access links carry a one-time secret; the scanner shows guests' names.
      { source: '/s/:path*', headers: privatePage },
      { source: '/scan/:path*', headers: privatePage },
      { source: '/scan', headers: privatePage },
    ];
  },
};

export default withNextIntl(nextConfig);
