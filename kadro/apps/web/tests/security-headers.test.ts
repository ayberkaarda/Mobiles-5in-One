import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';

import nextConfig from '../next.config';
import { ApiError } from '../lib/server/errors';
import { json, route } from '../lib/server/http';
import { handleProxyRequest, type ProxyEnv } from '../lib/server/proxy-handler';
import {
  HSTS_VALUE,
  PERMISSIONS_POLICY_VALUE,
  REFERRER_POLICY_VALUE,
} from '../lib/server/security-headers';
import { noParams, noQuery } from '../lib/server/validate';
import { testEnv } from './support/env';
import { call, MOBILE } from './support/http';
import { installTestRuntime } from './support/runtime';

/**
 * Threat model §6.2: headers are checked per response class — HTML pages, error pages,
 * `/api/v1` JSON responses and API error responses.
 */

const env = testEnv();
const production: ProxyEnv = { ...env, NODE_ENV: 'production', APP_ENV: 'production' };
const development: ProxyEnv = { ...env, NODE_ENV: 'development' };

function proxied(pathname: string, proxyEnv: ProxyEnv = env, headers: Record<string, string> = {}) {
  return handleProxyRequest(new NextRequest(`https://kadro.app${pathname}`, { headers }), proxyEnv);
}

function directives(csp: string | null): Map<string, string> {
  return new Map(
    (csp ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => {
        const [name = '', ...values] = part.split(/\s+/);
        return [name, values.join(' ')] as const;
      }),
  );
}

function expectStaticHeaders(headers: Headers): void {
  expect(headers.get('strict-transport-security')).toBe(HSTS_VALUE);
  expect(headers.get('strict-transport-security')).toBe(
    'max-age=63072000; includeSubDomains; preload',
  );
  expect(headers.get('x-content-type-options')).toBe('nosniff');
  expect(headers.get('referrer-policy')).toBe(REFERRER_POLICY_VALUE);
  expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  expect(headers.get('permissions-policy')).toBe(PERMISSIONS_POLICY_VALUE);
  expect(headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=(self)');
  expect(headers.get('x-frame-options')).toBe('DENY');
}

function expectPageCsp(headers: Headers): string {
  const csp = directives(headers.get('content-security-policy'));
  const script = csp.get('script-src') ?? '';
  const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(script)?.[1];
  expect(nonce).toBeDefined();
  expect(script).toContain("'self'");
  expect(script).toContain("'strict-dynamic'");
  expect(script).not.toContain('unsafe-inline');
  expect(csp.get('object-src')).toBe("'none'");
  expect(csp.get('frame-ancestors')).toBe("'none'");
  expect(csp.get('base-uri')).toBe("'self'");
  expect(csp.get('default-src')).toBe("'self'");
  expect(csp.get('style-src-elem')).toContain(`'nonce-${nonce ?? ''}'`);
  return nonce ?? '';
}

describe('HTML pages', () => {
  it('carry a nonce CSP and every static header', () => {
    const response = proxied('/');
    expectPageCsp(response.headers);
    expectStaticHeaders(response.headers);
  });

  it('use a fresh nonce on every request', () => {
    const nonces = new Set(Array.from({ length: 5 }, () => expectPageCsp(proxied('/').headers)));
    expect(nonces.size).toBe(5);
  });

  it('forward the nonce and CSP to rendering through request headers', () => {
    const response = proxied('/sahalar/istanbul');
    const nonce = expectPageCsp(response.headers);
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(
      response.headers.get('content-security-policy'),
    );
  });

  it('allow eval only in development and upgrade requests outside local', () => {
    const local = directives(proxied('/').headers.get('content-security-policy'));
    expect(local.get('script-src')).not.toContain('unsafe-eval');
    expect(local.has('upgrade-insecure-requests')).toBe(false);

    const dev = directives(proxied('/', development).headers.get('content-security-policy'));
    expect(dev.get('script-src')).toContain("'unsafe-eval'");

    const prod = directives(proxied('/', production).headers.get('content-security-policy'));
    expect(prod.get('script-src')).not.toContain('unsafe-eval');
    expect(prod.has('upgrade-insecure-requests')).toBe(true);
  });
});

describe('error pages', () => {
  it('unknown paths (404 page) and admin paths get the same page headers', () => {
    for (const pathname of ['/bu-sayfa-yok', '/admin/kullanicilar', '/mac/AbCdEf123']) {
      const response = proxied(pathname);
      expectPageCsp(response.headers);
      expectStaticHeaders(response.headers);
    }
  });
});

describe('API responses', () => {
  it('carry no-store, a deny-all CSP and every static header', () => {
    const response = proxied('/api/v1/health');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expectStaticHeaders(response.headers);
  });
});

describe('request ids', () => {
  it('replace a client-supplied x-request-id and forward the new one', () => {
    const forged = '00000000-0000-4000-8000-000000000000';
    const response = proxied('/api/v1/health', env, { 'x-request-id': forged });
    const assigned = response.headers.get('x-request-id');
    expect(assigned).toMatch(/^[0-9a-f-]{36}$/);
    expect(assigned).not.toBe(forged);
    expect(response.headers.get('x-middleware-request-x-request-id')).toBe(assigned);
  });
});

describe('API error responses from the route wrapper', () => {
  beforeAll(async () => {
    await installTestRuntime();
  });

  const succeeding = route({
    path: '/api/v1/test/status',
    method: 'GET',
    auth: 'none',
    params: noParams,
    query: noQuery,
    body: null,
    handler: () => json({ ok: true }),
  });

  const codes = [
    'validation_failed',
    'unauthenticated',
    'forbidden',
    'not_found',
    'conflict',
    'rate_limited',
    'internal_error',
  ] as const;

  for (const code of codes) {
    it(`sets no-store and nosniff on ${code}`, async () => {
      const thrower = route({
        path: '/api/v1/test/status',
        method: 'GET',
        auth: 'none',
        params: noParams,
        query: noQuery,
        body: null,
        handler: () => {
          throw new ApiError(code);
        },
      });
      const response = await call(thrower, { headers: MOBILE });
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    });
  }

  it('sets no-store on success responses', async () => {
    const response = await call(succeeding, { headers: MOBILE });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('next.config.ts headers()', () => {
  it('sends the static headers on every path and no-store on the API', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const all = rules.find((rule) => rule.source === '/:path*');
    const api = rules.find((rule) => rule.source === '/api/:path*');
    const value = (key: string) => all?.headers.find((header) => header.key === key)?.value;
    expect(value('Strict-Transport-Security')).toBe(HSTS_VALUE);
    expect(value('X-Content-Type-Options')).toBe('nosniff');
    expect(value('Referrer-Policy')).toBe(REFERRER_POLICY_VALUE);
    expect(value('Permissions-Policy')).toBe(PERMISSIONS_POLICY_VALUE);
    expect(api?.headers).toEqual([{ key: 'Cache-Control', value: 'no-store' }]);
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
