import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import {
  handleThemePreference,
  isSameOriginRequest,
  RETURN_PATH_MAX,
  safeReturnPath,
  THEME_BODY_LIMIT_BYTES,
  themeCookieHeader,
} from '../../components/marketing/theme-request';
import { handleProxyRequest } from '../../lib/server/proxy-handler';
import { surfaceFor } from '../../lib/server/security-headers';
import { TEST_SECOND_ORIGIN, TEST_WEB_ORIGIN, testEnv } from '../support/env';

/**
 * `POST /tema` (ADR-0084): the footer toggle stores the colour-scheme preference without
 * JavaScript. Only a same-origin form with a valid value sets the cookie; the redirect goes back
 * to a path on the web origin and nowhere else; the page CSP is the one every other page gets.
 */

// The route reads only `WEB_ORIGIN`; the value is `TEST_WEB_ORIGIN` (a hoisted factory cannot
// import the test support module, which itself imports `@kadro/config`).
vi.mock('@kadro/config', async (importOriginal) => {
  const original: object = await importOriginal();
  return { ...original, loadWebEnv: () => ({ WEB_ORIGIN: 'https://kadro.app' }) };
});

const { POST } = await import('../../app/tema/route');

const FORM = 'application/x-www-form-urlencoded';

function themeRequest(
  body: string,
  headers: Readonly<Record<string, string>> = {},
  method = 'POST',
): Request {
  return new Request(`${TEST_WEB_ORIGIN}/tema`, {
    method,
    headers: { origin: TEST_WEB_ORIGIN, 'content-type': FORM, ...headers },
    body,
  });
}

function form(fields: Readonly<Record<string, string>>): string {
  return new URLSearchParams(fields).toString();
}

describe('POST /tema: stores the preference', () => {
  for (const preference of ['system', 'light', 'dark']) {
    it(`sets the cookie to ${preference} and answers 303 back to the page`, async () => {
      const response = await handleThemePreference(
        themeRequest(form({ tema: preference, geri: '/blog/kadro-nasil-kurulur' })),
        TEST_WEB_ORIGIN,
      );
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(`${TEST_WEB_ORIGIN}/blog/kadro-nasil-kurulur`);
      expect(response.headers.get('set-cookie')).toBe(
        `kadro-theme=${preference}; Path=/; Max-Age=31536000; SameSite=Lax; Secure; HttpOnly`,
      );
      expect(response.headers.get('cache-control')).toBe('no-store');
    });
  }

  it('builds the cookie with the brand attributes', () => {
    const cookie = themeCookieHeader('dark');
    for (const part of ['Path=/', 'SameSite=Lax', 'Secure', 'HttpOnly', 'Max-Age=31536000']) {
      expect(cookie).toContain(part);
    }
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it('accepts a charset parameter and returns to / without a return path', async () => {
    const response = await handleThemePreference(
      themeRequest(form({ tema: 'dark' }), { 'content-type': `${FORM}; charset=UTF-8` }),
      TEST_WEB_ORIGIN,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${TEST_WEB_ORIGIN}/`);
  });

  it('accepts a same-origin form whose browser sends Sec-Fetch-Site instead of Origin', async () => {
    const request = new Request(`${TEST_WEB_ORIGIN}/tema`, {
      method: 'POST',
      headers: { 'content-type': FORM, 'sec-fetch-site': 'same-origin' },
      body: form({ tema: 'light', geri: '/' }),
    });
    expect((await handleThemePreference(request, TEST_WEB_ORIGIN)).status).toBe(303);
  });

  it('runs through the route module with the configured web origin', async () => {
    const response = await POST(themeRequest(form({ tema: 'dark', geri: '/ozellikler' })));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${TEST_WEB_ORIGIN}/ozellikler`);
    expect(response.headers.get('set-cookie')).toContain('kadro-theme=dark;');
    expect(testEnv().WEB_ORIGIN).toBe(TEST_WEB_ORIGIN);
  });
});

describe('POST /tema: rejects without setting a cookie', () => {
  async function expectRejected(request: Request, status: number): Promise<void> {
    const response = await handleThemePreference(request, TEST_WEB_ORIGIN);
    expect(response.status).toBe(status);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('location')).toBeNull();
  }

  it('refuses an invalid, missing, repeated or differently cased value with 400', async () => {
    for (const body of [
      form({ tema: 'sepia' }),
      form({ tema: 'Dark' }),
      form({ tema: '' }),
      form({ tema: 'dark; Path=/admin' }),
      form({ geri: '/' }),
      'tema=dark&tema=light',
      '',
    ]) {
      await expectRejected(themeRequest(body), 400);
    }
  });

  it('refuses a cross-origin form (other site, sibling origin, opaque origin) with 403', async () => {
    for (const origin of ['https://evil.example', TEST_SECOND_ORIGIN, 'null', 'http://kadro.app']) {
      await expectRejected(themeRequest(form({ tema: 'dark' }), { origin }), 403);
    }
  });

  it('refuses a request with neither Origin nor a same-origin Sec-Fetch-Site with 403', async () => {
    for (const site of [undefined, 'cross-site', 'same-site', 'none']) {
      const request = new Request(`${TEST_WEB_ORIGIN}/tema`, {
        method: 'POST',
        headers:
          site === undefined
            ? { 'content-type': FORM }
            : { 'content-type': FORM, 'sec-fetch-site': site },
        body: form({ tema: 'dark' }),
      });
      await expectRejected(request, 403);
    }
  });

  it('refuses a body that is not a URL-encoded form with 415', async () => {
    for (const type of ['application/json', 'text/plain', 'multipart/form-data; boundary=x', '']) {
      await expectRejected(themeRequest('{"tema":"dark"}', { 'content-type': type }), 415);
    }
  });

  it('refuses an oversized body with 413', async () => {
    const big = form({ tema: 'dark', geri: `/${'a'.repeat(THEME_BODY_LIMIT_BYTES)}` });
    await expectRejected(themeRequest(big), 413);
  });
});

describe('return path (no open redirect)', () => {
  it('keeps plain paths on the web origin, without query or fragment', () => {
    expect(safeReturnPath('/', TEST_WEB_ORIGIN)).toBe('/');
    expect(safeReturnPath('/blog/kadro-nasil-kurulur', TEST_WEB_ORIGIN)).toBe(
      '/blog/kadro-nasil-kurulur',
    );
    expect(safeReturnPath('/eksik-var/istanbul/kadikoy?x=1#y', TEST_WEB_ORIGIN)).toBe(
      '/eksik-var/istanbul/kadikoy',
    );
    expect(safeReturnPath('/a/../ozellikler', TEST_WEB_ORIGIN)).toBe('/ozellikler');
  });

  it('falls back to / for everything that could leave the origin', () => {
    const hostile: unknown[] = [
      undefined,
      null,
      42,
      ['/ozellikler'],
      '',
      'ozellikler',
      'https://evil.example/',
      'http://kadro.app/',
      '//evil.example',
      '///evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      '/\tevil',
      '/ozellikler\n',
      '\u0000/x',
      'javascript:alert(1)',
      'data:text/html,x',
      ' /ozellikler',
      `/${'a'.repeat(RETURN_PATH_MAX)}`,
    ];
    for (const value of hostile) {
      expect(safeReturnPath(value, TEST_WEB_ORIGIN), JSON.stringify(value) ?? String(value)).toBe(
        '/',
      );
    }
  });

  it('keeps encoded separators as a path on the web origin', async () => {
    const response = await handleThemePreference(
      themeRequest(form({ tema: 'dark', geri: '/%2F%2Fevil.example' })),
      TEST_WEB_ORIGIN,
    );
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.origin).toBe(TEST_WEB_ORIGIN);
    expect(location.pathname).toBe('/%2F%2Fevil.example');
  });

  it('redirects every hostile return path to the web origin root', async () => {
    for (const geri of ['//evil.example', 'https://evil.example', '/\\evil.example']) {
      const response = await handleThemePreference(
        themeRequest(form({ tema: 'dark', geri })),
        TEST_WEB_ORIGIN,
      );
      expect(response.headers.get('location'), geri).toBe(`${TEST_WEB_ORIGIN}/`);
    }
  });

  it('compares origins exactly', () => {
    const headers = (origin: string) => new Headers({ origin });
    expect(isSameOriginRequest(headers(TEST_WEB_ORIGIN), TEST_WEB_ORIGIN)).toBe(true);
    expect(isSameOriginRequest(headers(`${TEST_WEB_ORIGIN}/`), TEST_WEB_ORIGIN)).toBe(false);
    expect(isSameOriginRequest(headers('https://kadro.app.evil.example'), TEST_WEB_ORIGIN)).toBe(
      false,
    );
  });
});

describe('CSP unchanged (security checklist item 9)', () => {
  const env = testEnv();
  const EXPECTED = [
    "default-src 'self'",
    "script-src 'self' 'nonce-N' 'strict-dynamic'",
    "style-src 'self' 'nonce-N'",
    "style-src-elem 'self' 'nonce-N'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  function csp(path: string, method = 'GET'): string {
    const response = handleProxyRequest(
      new NextRequest(`${TEST_WEB_ORIGIN}${path}`, { method }),
      env,
    );
    return (response.headers.get('content-security-policy') ?? '').replace(
      /'nonce-[A-Za-z0-9+/=]+'/g,
      "'nonce-N'",
    );
  }

  it('sends the same page policy to the marketing pages and to the toggle route', () => {
    expect(csp('/')).toBe(EXPECTED);
    expect(csp('/ozellikler')).toBe(EXPECTED);
    expect(csp('/tema', 'POST')).toBe(EXPECTED);
  });

  it('keeps the toggle route on the default app surface, outside /api', () => {
    expect(surfaceFor('/tema').name).toBe('app');
  });
});
