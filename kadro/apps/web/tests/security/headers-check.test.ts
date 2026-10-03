import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  checkSecurityHeaders,
  cspNonce,
  formatReport,
  parseCsp,
  targets,
} from '../../../../scripts/security/headers-check';
import { handleProxyRequest, type ProxyEnv } from '../../lib/server/proxy-handler';
import { SURFACES } from '../../lib/server/security-headers';
import { testEnv } from '../support/env';
import {
  BUILD_PRESENT,
  type RunningServer,
  runScript,
  startBareServer,
  startBuiltServer,
} from './support/server';
import { prerequisite } from '../support/prerequisite';

/**
 * Security checklist item 9: `scripts/security/headers-check.ts` against the production build
 * (`next start` on the output of `pnpm build`, generated test configuration). Without a build
 * the build-backed block is skipped locally and says so on stderr, and the whole file fails
 * under CI=true; the parser tests and the negative run against a bare server (no security
 * headers → exit 1) always run otherwise.
 */

const BUILD_CHECKS = prerequisite(
  BUILD_PRESENT,
  'headers-check.test (production-build checks)',
  'apps/web/.next/BUILD_ID is missing, run `pnpm build` first',
);

describe('CSP parsing', () => {
  it('splits directives and finds the script nonce', () => {
    const csp =
      "default-src 'self'; script-src 'self' 'nonce-AbCdEfGhIjKlMnOpQrSt12==' 'strict-dynamic'";
    expect(parseCsp(csp).get('script-src')).toEqual([
      "'self'",
      "'nonce-AbCdEfGhIjKlMnOpQrSt12=='",
      "'strict-dynamic'",
    ]);
    expect(cspNonce(csp)).toBe('AbCdEfGhIjKlMnOpQrSt12==');
    expect(cspNonce("script-src 'self' 'nonce-short'")).toBeNull();
    expect(cspNonce(null)).toBeNull();
  });
});

/**
 * A fetch that answers with the headers the proxy sets, plus the `Cache-Control` Next.js adds to
 * dynamic pages; `tamper` edits them per path to prove a deviation is reported.
 */
function proxyFetch(tamper: (pathname: string, headers: Headers) => void = () => undefined) {
  const env: ProxyEnv = { ...testEnv(), NODE_ENV: 'production', APP_ENV: 'production' };
  return (input: string): Promise<Response> => {
    const url = new URL(input);
    const headers = new Headers(handleProxyRequest(new NextRequest(url), env).headers);
    if (!headers.has('cache-control')) {
      headers.set('cache-control', 'private, no-cache, no-store, max-age=0, must-revalidate');
    }
    tamper(url.pathname, headers);
    return Promise.resolve(new Response('', { status: 200, headers }));
  };
}

describe('headers-check reads the shared surface table', () => {
  it('requests the probe path of every surface', () => {
    const paths = targets().map((target) => target.path);
    for (const surface of SURFACES) {
      expect(paths, surface.name).toContain(surface.probe);
    }
    expect(paths).toEqual(expect.arrayContaining(['/', '/api/v1/me']));
  });

  it('passes every check against the headers the proxy sets', async () => {
    const results = await checkSecurityHeaders('https://kadro.app', proxyFetch());
    expect(formatReport(results.filter((result) => !result.ok))).toBe('');
    expect(new Set(results.map((result) => result.target))).toEqual(
      new Set([
        'page /',
        'missing page',
        'api success',
        'api error',
        'token-page /sifre-sifirla',
        'email-link-page /giris',
        'invite-page /mac/headers-check-probe',
        'seo /sahalar/istanbul',
        'page / (two requests)',
      ]),
    );
  });

  it('reports a surface header that deviates from the table', async () => {
    const results = await checkSecurityHeaders(
      'https://kadro.app',
      proxyFetch((pathname, headers) => {
        if (pathname === '/sifre-sifirla') {
          headers.delete('x-robots-tag');
          headers.set('referrer-policy', 'strict-origin-when-cross-origin');
          headers.delete('cache-control');
        }
        if (pathname === '/giris') {
          headers.set('content-security-policy', "script-src 'self' 'unsafe-inline'");
        }
        if (pathname === '/sahalar/istanbul') {
          headers.set('x-robots-tag', 'noindex');
        }
        if (pathname === '/') {
          // A prerendered page: shared-cacheable HTML cannot carry a per-request nonce.
          headers.set('cache-control', 's-maxage=31536000');
        }
      }),
    );
    const failed = results
      .filter((result) => !result.ok)
      .map((result) => `${result.target}: ${result.name}`);
    expect(failed).toEqual(
      expect.arrayContaining([
        'token-page /sifre-sifirla: X-Robots-Tag noindex',
        'token-page /sifre-sifirla: Referrer-Policy no-referrer',
        'token-page /sifre-sifirla: Cache-Control no-store',
        "email-link-page /giris: CSP script-src 'self' 'nonce-…' 'strict-dynamic'",
        "email-link-page /giris: CSP script-src without 'unsafe-inline' and 'unsafe-eval'",
        'seo /sahalar/istanbul: X-Robots-Tag absent (indexable)',
        'page /: Cache-Control not shared-cacheable (per-request nonce)',
      ]),
    );
    expect(failed.filter((name) => name.startsWith('missing page'))).toEqual([]);
  });

  it('fails a token page whose no-store comes with shared-cache directives', async () => {
    const shared = [
      'no-store, public, s-maxage=300',
      'no-store, max-age=60',
      'no-store, stale-while-revalidate=30',
      'private, no-store, stale-if-error=60',
      'no-store, immutable',
    ];
    for (const value of shared) {
      const results = await checkSecurityHeaders(
        'https://kadro.app',
        proxyFetch((pathname, headers) => {
          if (pathname === '/sifre-sifirla') {
            headers.set('cache-control', value);
          }
        }),
      );
      const failed = results
        .filter((result) => !result.ok)
        .map((result) => `${result.target}: ${result.name}`);
      expect(failed, value).toEqual([
        'token-page /sifre-sifirla: Cache-Control not shared-cacheable (per-request nonce)',
      ]);
    }
  });

  it('accepts the Next.js dynamic page value and max-age=0', async () => {
    const results = await checkSecurityHeaders(
      'https://kadro.app',
      proxyFetch((pathname, headers) => {
        if (pathname === '/giris') {
          headers.set('cache-control', 'no-store, max-age=0');
        }
      }),
    );
    expect(formatReport(results.filter((result) => !result.ok))).toBe('');
  });
});

describe('headers-check against a server without security headers', () => {
  let bare: RunningServer;

  beforeAll(async () => {
    bare = await startBareServer();
  });

  afterAll(async () => {
    await bare.stop();
  });

  it('reports every required header as missing', async () => {
    const results = await checkSecurityHeaders(bare.base);
    const failed = new Set(results.filter((result) => !result.ok).map((result) => result.name));
    expect([...failed]).toEqual(
      expect.arrayContaining([
        'Content-Security-Policy',
        'Strict-Transport-Security',
        'X-Content-Type-Options nosniff',
        'Referrer-Policy strict-origin-when-cross-origin',
        'Permissions-Policy camera=(), microphone=(), geolocation=(self)',
        'Cache-Control no-store',
        'CSP nonce differs per response',
      ]),
    );
    // Only the indexable surfaces pass: their check is that no `X-Robots-Tag` is sent.
    expect(results.filter((result) => result.ok).map((result) => result.name)).toEqual(
      expect.arrayContaining(['X-Robots-Tag absent (indexable)']),
    );
    expect(
      results.every((result) => !result.ok || result.name === 'X-Robots-Tag absent (indexable)'),
    ).toBe(true);
  });

  it('exits with 1 from the command line', async () => {
    const run = await runScript('headers-check.ts', [bare.base]);
    expect(run.code, run.stderr).toBe(1);
    expect(run.stdout).toContain('FAIL page /: Strict-Transport-Security');
    expect(run.stdout).toMatch(/headers-check: \d+ of \d+ checks failed/);
  });
});

describe.skipIf(!BUILD_CHECKS)('headers-check against the production build', () => {
  let server: RunningServer;

  beforeAll(async () => {
    server = await startBuiltServer();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('passes every check for pages, the 404 page and API responses', async () => {
    const results = await checkSecurityHeaders(server.base);
    expect(formatReport(results.filter((result) => !result.ok))).toBe('');
    const targets = new Set(results.map((result) => result.target));
    expect(targets).toEqual(
      new Set([
        'page /',
        'missing page',
        'api success',
        'api error',
        'token-page /sifre-sifirla',
        'email-link-page /giris',
        'invite-page /mac/headers-check-probe',
        'seo /sahalar/istanbul',
        'page / (two requests)',
      ]),
    );
  });

  it('exits with 0 from the command line', async () => {
    const run = await runScript('headers-check.ts', [server.base]);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(run.stdout).toMatch(/headers-check: all \d+ checks passed/);
    expect(run.stdout).not.toContain('FAIL');
  });
});
