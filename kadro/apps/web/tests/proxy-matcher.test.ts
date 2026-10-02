import { createRequire } from 'node:module';

import type { NextConfig } from 'next';
import type { ProxyMatcher } from 'next/dist/build/analysis/get-page-static-info';
import { getMiddlewareRouteMatcher } from 'next/dist/shared/lib/router/utils/middleware-route-matcher';
import type { BaseNextRequest } from 'next/dist/server/base-http';
import { describe, expect, it } from 'vitest';

import nextConfig from '../next.config';
import { config } from '../proxy';

/**
 * Compiles `config.matcher` of `proxy.ts` with the same Next.js functions the build uses
 * (`getMiddlewareMatchers` → `getMiddlewareRouteMatcher`), so the test sees exactly which paths
 * reach the security layer (nonce CSP, request id, CORS). Only real static assets may bypass it.
 */

const require = createRequire(import.meta.url);
const staticInfo = require('next/dist/build/analysis/get-page-static-info.js') as {
  getMiddlewareMatchers: (matcher: unknown, config: NextConfig) => ProxyMatcher[];
};

function compile(matcher: unknown): (pathname: string) => boolean {
  const routeMatcher = getMiddlewareRouteMatcher(
    staticInfo.getMiddlewareMatchers(matcher, nextConfig),
  );
  return (pathname) => routeMatcher(pathname, {} as BaseNextRequest, {});
}

const proxied = compile(config.matcher);

const MUST_RUN = [
  '/',
  '/sahalar/istanbul',
  '/bu-sayfa-yok',
  '/admin/kullanicilar',
  '/api/v1/health',
  '/api/v1/auth/login',
  '/favicon.ico/olmayan',
  '/faviconXico',
  '/favicon.icon',
  '/_next/staticfile',
  '/_next/imagex',
  '/_next/image/extra',
  '/robots.txt',
];

const MAY_SKIP = [
  '/_next/static/chunks/app.js',
  '/_next/static/css/a.css',
  '/_next/image',
  '/favicon.ico',
];

describe('proxy matcher', () => {
  for (const pathname of MUST_RUN) {
    it(`runs the proxy for ${pathname}`, () => {
      expect(proxied(pathname)).toBe(true);
    });
  }

  for (const pathname of MAY_SKIP) {
    it(`skips the static asset ${pathname}`, () => {
      expect(proxied(pathname)).toBe(false);
    });
  }

  it('detects a matcher that drops application paths', () => {
    const broken = compile(['/((?!_next/static|_next/image|favicon.ico|sahalar).*)']);
    expect(MUST_RUN.every((pathname) => broken(pathname))).toBe(false);
  });
});
