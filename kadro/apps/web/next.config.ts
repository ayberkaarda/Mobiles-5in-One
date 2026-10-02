import path from 'node:path';

import type { NextConfig } from 'next';

import { API_CACHE_HEADERS, STATIC_SECURITY_HEADERS } from './lib/server/security-headers';

const monorepoRoot = path.resolve(process.cwd(), '../..');

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  // Loaded by Node at runtime instead of bundled: pg has optional native bindings the bundler
  // must not follow. The migrator lives in `@kadro/db/migrate` and is never imported here.
  serverExternalPackages: ['pg', 'pg-boss'],
  // Security checklist item 9. The per-request nonce CSP is set by proxy.ts; these headers also
  // cover static assets, which the proxy matcher skips.
  headers() {
    return Promise.resolve([
      { source: '/:path*', headers: [...STATIC_SECURITY_HEADERS] },
      { source: '/api/:path*', headers: [...API_CACHE_HEADERS] },
    ]);
  },
};

export default nextConfig;
