import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { handleProxyRequest, type ProxyEnv } from '../../lib/server/proxy-handler';
import {
  EMAIL_LINK_PAGE_PATHS,
  REFERRER_POLICY_VALUE,
  surfaceFor,
  TOKEN_PAGE_PATHS,
} from '../../lib/server/security-headers';
import { PAGE_PATHS } from '../../lib/client/redirects';
import { TOKEN_PAGES } from '../../lib/client/token-capture';
import { testEnv } from '../support/env';

/**
 * ADR-0040 "Headers and CSP" at the proxy: the five pages are app surfaces with the nonce CSP of
 * ADR-0021 group 1 and `noindex`; the two token pages also get `no-referrer` and `no-store`.
 */

const production: ProxyEnv = { ...testEnv(), NODE_ENV: 'production', APP_ENV: 'production' };

function proxied(pathname: string): Headers {
  return handleProxyRequest(new NextRequest(`https://kadro.app${pathname}`), production).headers;
}

function scriptSrc(headers: Headers): string {
  const csp = headers.get('content-security-policy') ?? '';
  return (
    csp
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('script-src ')) ?? ''
  );
}

describe('email-link page headers', () => {
  it('covers exactly the ADR-0040 page list, shared with the client paths', () => {
    expect([...EMAIL_LINK_PAGE_PATHS].sort()).toEqual(
      Object.values(PAGE_PATHS)
        .filter((path) => path !== '/')
        .sort(),
    );
    expect(TOKEN_PAGE_PATHS).toEqual([PAGE_PATHS.verifyEmail, PAGE_PATHS.reset]);
    expect(TOKEN_PAGES).toEqual(TOKEN_PAGE_PATHS);
  });

  for (const pathname of EMAIL_LINK_PAGE_PATHS) {
    it(`${pathname}: nonce CSP with strict-dynamic, no unsafe-inline scripts, noindex`, () => {
      const headers = proxied(pathname);
      const script = scriptSrc(headers);
      expect(script).toMatch(/^script-src 'self' 'nonce-[A-Za-z0-9+/=]{22,}' 'strict-dynamic'$/);
      const csp = headers.get('content-security-policy') ?? '';
      expect(csp).toContain("connect-src 'self'");
      expect(csp).toContain("form-action 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/);
      expect(headers.get('x-robots-tag')).toBe('noindex, nofollow');
    });
  }

  it('sends no-referrer and no-store on the token pages only', () => {
    for (const pathname of TOKEN_PAGE_PATHS) {
      const headers = proxied(pathname);
      expect(headers.get('referrer-policy'), pathname).toBe('no-referrer');
      expect(headers.get('cache-control'), pathname).toBe('no-store');
    }
    for (const pathname of ['/giris', '/sifremi-unuttum', '/hesap-silme', '/']) {
      expect(proxied(pathname).get('referrer-policy'), pathname).toBe(REFERRER_POLICY_VALUE);
    }
  });

  it('matches exact paths only', () => {
    expect(surfaceFor('/').noindex).toBe(false);
    expect(surfaceFor('/sifre-sifirla/x').name).toBe('app');
    expect(surfaceFor('/api/v1/auth/reset').name).toBe('api');
    expect(proxied('/sifre-sifirla/x').get('x-robots-tag')).toBeNull();
    expect(proxied('/sifre-sifirla/x').get('referrer-policy')).toBe(REFERRER_POLICY_VALUE);
    expect(proxied('/').get('x-robots-tag')).toBeNull();
  });

  it('uses a fresh nonce per request', () => {
    expect(scriptSrc(proxied('/sifre-sifirla'))).not.toBe(scriptSrc(proxied('/sifre-sifirla')));
  });
});
