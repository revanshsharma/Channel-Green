import type { NextConfig } from 'next';

const config: NextConfig = {
  // The shared engine and the content pack are TypeScript source inside the monorepo.
  transpilePackages: ['@channel-green/shared', '@channel-green/content'],
  reactStrictMode: false, // Phaser owns a canvas; double-mounting in dev only causes flicker
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Camera and microphone are only ever requested by an explicit button press inside /play.
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
