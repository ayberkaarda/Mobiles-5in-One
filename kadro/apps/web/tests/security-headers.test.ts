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
  canonicalPath,
  SURFACES,
  type SurfaceName,
  surfaceFor,
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
 feat/admin-web
  it('unknown paths (404 page) and app paths get the same page headers', () => {
    for (const pathname of ['/bu-sayfa-yok', '/mac/AbCdEf123']) {

  it('unknown paths (404 page) and admin paths get the same page headers', () => {
    for (const pathname of ['/bu-sayfa-yok', '/admin/kullanicilar']) {
 main
      const response = proxied(pathname);
      expectPageCsp(response.headers);
      expectStaticHeaders(response.headers);
    }
  });

  it('invite paths get the page CSP with noindex, no-referrer and no-store (ADR-0058)', () => {
    for (const pathname of ['/mac/AbCdEf123', '/mac/kisa']) {
      const response = proxied(pathname);
      expectPageCsp(response.headers);
      expect(response.headers.get('referrer-policy'), pathname).toBe('no-referrer');
      expect(response.headers.get('x-robots-tag'), pathname).toBe('noindex, nofollow');
      expect(response.headers.get('cache-control'), pathname).toBe('no-store');
    }
  });
});

describe('surface table (ADR-0021, ADR-0055)', () => {
  /** Written out on purpose: a change to the table has to change this expectation too. */
  const expected: Record<
    SurfaceName,
    {
      readonly csp: 'nonce' | 'deny-all';
      readonly robots: string | null;
      readonly referrer: string;
      readonly cache: string | null;
    }
  > = {
    api: {
      csp: 'deny-all',
      robots: null,
      referrer: 'strict-origin-when-cross-origin',
      cache: 'no-store',
    },
    'token-page': {
      csp: 'nonce',
      robots: 'noindex, nofollow',
      referrer: 'no-referrer',
      cache: 'no-store',
    },
    'email-link-page': {
      csp: 'nonce',
      robots: 'noindex, nofollow',
      referrer: 'strict-origin-when-cross-origin',
      cache: null,
    },
    'invite-page': {
      csp: 'nonce',
      robots: 'noindex, nofollow',
      referrer: 'no-referrer',
      cache: 'no-store',
    },
    marketing: {
      csp: 'nonce',
      robots: null,
      referrer: 'strict-origin-when-cross-origin',
      cache: null,
    },
    seo: { csp: 'nonce', robots: null, referrer: 'strict-origin-when-cross-origin', cache: null },
    admin: {
      csp: 'nonce',
      robots: 'noindex, nofollow',
      referrer: 'no-referrer',
      cache: 'no-store',
    },
    app: { csp: 'nonce', robots: null, referrer: 'strict-origin-when-cross-origin', cache: null },
  };

  it('lists every surface once, with the catch-all app surface last', () => {
    expect(SURFACES.map((surface) => surface.name)).toEqual([
      'api',
      'token-page',
      'email-link-page',
      'invite-page',
      'marketing',
      'seo',
      'admin',
      'app',
    ]);
    expect(SURFACES.at(-1)?.paths).toEqual([]);
  });

  it('classifies paths by exact match or by whole segments under a `/**` base', () => {
    const cases: [string, SurfaceName][] = [
      ['/api/v1/health', 'api'],
      ['/api/v1/auth/reset', 'api'],
      ['/e-posta-dogrula', 'token-page'],
      ['/sifre-sifirla', 'token-page'],
      ['/sifre-sifirla/x', 'app'],
      ['/sifremi-unuttum', 'email-link-page'],
      ['/giris', 'email-link-page'],
      ['/hesap-silme', 'email-link-page'],
      ['/', 'marketing'],
      ['/ozellikler', 'marketing'],
      ['/blog', 'marketing'],
      ['/blog/ilk-yazi', 'marketing'],
      ['/blogx', 'app'],
      ['/kvkk-aydinlatma', 'marketing'],
      ['/sahalar/istanbul', 'seo'],
      ['/saha/kadikoy-arena', 'seo'],
      ['/sahalarx', 'app'],
      ['/eksik-var/istanbul/kadikoy', 'seo'],
 feat/admin-web
      ['/admin', 'admin'],
      ['/admin/kullanicilar', 'admin'],
      ['/admin/sahalar/ice-aktar/x', 'admin'],
      ['/adminx', 'app'],
      ['/mac/AbCdEf123', 'app'],

      ['/admin/kullanicilar', 'app'],
      ['/mac/AbCdEf123', 'invite-page'],
      ['/mac', 'invite-page'],
      ['/macx/AbCdEf123', 'app'],
 main
      ['/bu-sayfa-yok', 'app'],
    ];
    for (const [pathname, name] of cases) {
      expect(surfaceFor(pathname).name, pathname).toBe(name);
    }
  });

  it('classifies the canonical path: decoded once, case-folded, dot segments and empty segments removed', () => {
    const cases: [string, SurfaceName][] = [
      ['/sifre%2dsifirla', 'token-page'],
      ['/%73ifre-sifirla', 'token-page'],
      ['/e%2Dposta-dogrula', 'token-page'],
      ['/SIFRE-SIFIRLA', 'token-page'],
      ['/Sifre-Sifirla', 'token-page'],
      ['/sifre-sifirla/', 'token-page'],
      ['//sifre-sifirla', 'token-page'],
      ['/x/../sifre-sifirla', 'token-page'],
      ['/./sifre-sifirla', 'token-page'],
      ['/g%69ris', 'email-link-page'],
      ['/%61pi/v1/health', 'api'],
      ['/API/v1/health', 'api'],
      ['//api//v1/health/', 'api'],
      ['/api/v1/../v1/health', 'api'],
      ['/SAHALAR/istanbul', 'seo'],
 feat/admin-web
      ['/ADMIN/Giris', 'admin'],
      ['/x/../admin/denetim', 'admin'],

      ['/MAC/AbCdEf123', 'invite-page'],
 main
      // One decoding pass only: `%252d` is the text `%2d`, not a hyphen.
      ['/sifre%252dsifirla', 'app'],
      ['/../..', 'marketing'],
    ];
    for (const [pathname, name] of cases) {
      expect(surfaceFor(pathname).name, pathname).toBe(name);
    }
  });

  it('treats encoded separators, control characters and invalid encodings as ambiguous', () => {
    for (const pathname of [
      '/api%2fv1/health',
      '/api%2Fv1/health',
      '/sifre-sifirla%2f',
      '/sifre-sifirla%5c',
      '/sifre-sifirla\\x',
      '/sifre-sifirla%00',
      '/sifre-sifirla%0a',
      '/sifre-sifirla%7f',
      '/%E0%A4%A',
      '/sifre%2',
      '/sifre%zz',
    ]) {
      expect(canonicalPath(pathname), pathname).toBeNull();
    }
    expect(canonicalPath('/Sahalar//Istanbul/')).toBe('/sahalar/istanbul');
    expect(canonicalPath('/')).toBe('/');
  });

  it('proxy rejects an ambiguous path with 400 and the deny-all headers', async () => {
    for (const pathname of ['/api%2fv1/health', '/sifre-sifirla%00', '/%E0%A4%A', '/giris%5c']) {
      const response = proxied(pathname, production);
      expect(response.status, pathname).toBe(400);
      expect(response.headers.get('content-security-policy')).toBe(
        "default-src 'none'; frame-ancestors 'none'",
      );
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      expect(response.headers.get('x-middleware-next')).toBeNull();
      expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
      expectStaticHeaders(response.headers);
      expect(await response.text()).toBe('Bad Request');
    }
  });

  it('proxy sends the token-page headers for encoded and case variants of a token path', () => {
    for (const pathname of ['/sifre%2dsifirla', '/SIFRE-SIFIRLA', '/e%2dposta-dogrula']) {
      const headers = proxied(pathname, production).headers;
      expect(headers.get('referrer-policy'), pathname).toBe('no-referrer');
      expect(headers.get('cache-control'), pathname).toBe('no-store');
      expect(headers.get('x-robots-tag'), pathname).toBe('noindex, nofollow');
    }
  });

  it('classifies every probe path into its own surface', () => {
    for (const surface of SURFACES) {
      expect(surfaceFor(surface.probe).name, surface.probe).toBe(surface.name);
    }
  });

  for (const surface of SURFACES) {
    it(`${surface.name}: proxy sends the CSP variant, robots, referrer and cache headers`, () => {
      const want = expected[surface.name];
      const headers = proxied(surface.probe, production).headers;
      const csp = headers.get('content-security-policy');
      if (want.csp === 'nonce') {
        expectPageCsp(headers);
      } else {
        expect(csp).toBe("default-src 'none'; frame-ancestors 'none'");
      }
      expect(headers.get('x-robots-tag')).toBe(want.robots);
      expect(headers.get('referrer-policy')).toBe(want.referrer);
      expect(headers.get('cache-control')).toBe(want.cache);
      expect(headers.get('strict-transport-security')).toBe(HSTS_VALUE);
      expect(headers.get('x-content-type-options')).toBe('nosniff');
      expect(headers.get('permissions-policy')).toBe(PERMISSIONS_POLICY_VALUE);
      expect(headers.get('x-frame-options')).toBe('DENY');
    });
  }
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
