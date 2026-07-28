import type { NextConfig } from 'next';

// Single-service proxy uses loopback; split deploys set API_URL explicitly.
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Self-contained server bundle for Docker/Railway deploys.
  output: 'standalone',
  images: {
    // Uploaded/CDN images come from the API host and arbitrary CDNs.
    remotePatterns: [{ protocol: 'https', hostname: '**' }, { protocol: 'http', hostname: 'localhost' }],
  },
  async rewrites() {
    // Flat rewrite arrays are treated as `afterFiles`: Next.js filesystem
    // routes (including App Router handlers under /api/whatsapp/*) are matched
    // first, then remaining /api/* traffic is proxied to Nest.
    return [
      { source: '/api/:path*', destination: `${API_URL}/api/:path*` },
      { source: '/uploads/:path*', destination: `${API_URL}/uploads/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
        ],
      },
      {
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;
