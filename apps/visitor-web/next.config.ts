import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, '../..'),
  env: {
    NEXT_PUBLIC_MAP_TILE_URL:
      process.env.NEXT_PUBLIC_MAP_TILE_URL ?? process.env.VITE_MAP_TILE_URL,
    NEXT_PUBLIC_MAP_TILE_ATTRIBUTION:
      process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION ??
      process.env.VITE_MAP_TILE_ATTRIBUTION,
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:3000/:path*',
      },
    ];
  },
};

export default nextConfig;
