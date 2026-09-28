import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@gp/core', '@gp/db'],
  poweredByHeader: false,
};

export default nextConfig;
