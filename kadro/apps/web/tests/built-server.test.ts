import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { type IncomingHttpHeaders, request } from 'node:http';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SURFACES } from '../lib/server/security-headers';
import { testEnvSource } from './support/env';
import { prerequisite } from './support/prerequisite';

/**
 * Threat model §6.2 against the production build: Next.js must apply the per-request nonce of
 * the proxy CSP to every script it renders, and look-alike static paths must still pass the
 * proxy. Runs when `next build` output exists (`pnpm build` before `pnpm test`); otherwise the
 * suite is skipped locally (the unit-level proxy tests remain the guard) and fails under CI=true.
 */

const APP_DIR = fileURLToPath(new URL('..', import.meta.url));
const BUILT = prerequisite(
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path inside this package
  existsSync(fileURLToPath(new URL('../.next/BUILD_ID', import.meta.url))),
  'built-server.test',
  'apps/web/.next/BUILD_ID is missing, run `pnpm build` first',
);
const NEXT_BIN = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

let child: ChildProcess | undefined;
let base = '';

interface RawResponse {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

/** GET with the path sent exactly as written: no client-side normalization or re-encoding. */
function rawGet(path: string): Promise<RawResponse> {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request({ host: hostname, port, path, method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitUntilReady(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/v1/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // not listening yet
    }
    await delay(250);
  }
  throw new Error('built server did not become ready');
}

function cspNonce(response: Response): string {
  const csp = response.headers.get('content-security-policy') ?? '';
  const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1];
  expect(nonce, csp).toBeDefined();
  return nonce ?? '';
}

/** Source text without comments, so prose about a call does not count as the call. */
function code(relative: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed paths inside this package
  const text = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('render mode per surface (ADR-0021, ADR-0055)', () => {
  it('the root layout leaves the render mode to the surfaces', () => {
    expect(code('../app/layout.tsx')).not.toMatch(/connection\(|headers\(|cookies\(|dynamic\s*=/);
  });

  it('every surface layout and every page outside a route group renders per request itself', () => {
    for (const file of [
      '../app/(app)/layout.tsx',
      '../app/(marketing)/layout.tsx',
      '../app/(seo)/layout.tsx',
      '../app/not-found.tsx',
      '../app/sitemap.ts',
      '../app/robots.ts',
    ]) {
      expect(code(file), file).toContain('await connection();');
    }
  });
});

describe.skipIf(!BUILT)('production build', () => {
  beforeAll(async () => {
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    child = spawn(
      process.execPath,
      [NEXT_BIN, 'start', '--port', String(port), '-H', '127.0.0.1'],
      {
        cwd: APP_DIR,
        // Only the generated test configuration: no variable of the calling shell is inherited.
        env: {
          ...testEnvSource({ WEB_ORIGIN: base, CORS_ALLOWED_ORIGINS: base }),
          NODE_ENV: 'production',
        },
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    await waitUntilReady();
  });

  afterAll(() => {
    child?.kill();
  });

  it('puts the CSP nonce on every script of a rendered page', async () => {
    const response = await fetch(`${base}/`);
    expect(response.status).toBe(200);
    const nonce = cspNonce(response);
    const html = await response.text();
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) {
      expect(tag).toContain(`nonce="${nonce}"`);
    }
  });

  it('prerenders no page: a static page could not carry the per-request nonce', () => {
    const manifest = JSON.parse(
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path inside this package
      readFileSync(
        fileURLToPath(new URL('../.next/prerender-manifest.json', import.meta.url)),
        'utf8',
      ),
    ) as { routes: Record<string, unknown>; dynamicRoutes: Record<string, unknown> };
    // The global error page is a client component that Next.js always prerenders; it replaces
    // the root layout only after a render failure. The card images under `/og/` (ADR-0083) are
    // PNG route handlers, not pages: they carry no script, so no nonce applies to them.
    const isCardImage = (route: string) => /^\/og\/(kadro\.png|blog\/[^/]+)$/.test(route);
    const pages = Object.keys(manifest.routes).filter((route) => !isCardImage(route));
    expect(pages).toEqual(['/_global-error']);
    expect(Object.keys(manifest.routes).filter(isCardImage).length).toBeGreaterThan(1);
    expect(Object.keys(manifest.dynamicRoutes)).toEqual(['/og/blog/[slug]']);
  });

  it('puts the CSP nonce on every script of every HTML surface probe', async () => {
    for (const surface of SURFACES.filter((entry) => entry.csp === 'nonce')) {
      const response = await fetch(`${base}${surface.probe}`);
      const nonce = cspNonce(response);
      const cacheControl = response.headers.get('cache-control') ?? '';
      expect(cacheControl, surface.probe).toMatch(/private|no-store/);
      expect(cacheControl, surface.probe).not.toMatch(/public|s-maxage/);
      const html = await response.text();
      const scripts = html.match(/<script\b[^>]*>/g) ?? [];
      expect(scripts.length, surface.probe).toBeGreaterThan(0);
      for (const tag of scripts) {
        expect(tag, surface.probe).toContain(`nonce="${nonce}"`);
      }
    }
  });

  it('classifies raw encoded, case and slash variants of a path like the router (ADR-0055)', async () => {
    const token = ['/sifre%2dsifirla', '/%73ifre-sifirla', '/SIFRE-SIFIRLA', '/x/../sifre-sifirla'];
    for (const pathname of token) {
      const response = await rawGet(pathname);
      expect(response.headers['referrer-policy'], pathname).toBe('no-referrer');
      // A 404 render replaces the value with Next.js' own `private, no-cache, no-store, …`.
      expect(response.headers['cache-control'], pathname).toMatch(/(^|, )no-store(,|$)/);
      expect(response.headers['x-robots-tag'], pathname).toBe('noindex, nofollow');
    }
    for (const pathname of ['/sifre-sifirla/', '//sifre-sifirla', '//api/v1/health']) {
      const response = await rawGet(pathname);
      // Next.js answers these with a redirect to the canonical path before any page renders.
      expect(response.status, pathname).toBe(308);
      expect(response.body, pathname).not.toMatch(/<html/i);
    }
    for (const pathname of ['/api%2fv1/health', '/sifre-sifirla%00', '/%E0%A4%A', '/giris%5c']) {
      const response = await rawGet(pathname);
      expect(response.status, pathname).toBe(400);
      expect(response.headers['content-security-policy'], pathname).toBe(
        "default-src 'none'; frame-ancestors 'none'",
      );
      expect(response.body, pathname).toBe('Bad Request');
    }
    const api = await rawGet('/%61pi/v1/health');
    expect(api.headers['content-security-policy']).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
  });

  it('uses a different nonce on the next request', async () => {
    const first = cspNonce(await fetch(`${base}/`));
    const second = cspNonce(await fetch(`${base}/`));
    expect(first).not.toBe(second);
  });

  it('runs the proxy for look-alike static paths (nonce CSP and request id on the 404)', async () => {
    for (const pathname of ['/favicon.ico/olmayan', '/faviconXico', '/_next/staticfile']) {
      const response = await fetch(`${base}${pathname}`);
      expect(response.status, pathname).toBe(404);
      cspNonce(response);
      expect(response.headers.get('x-request-id'), pathname).toMatch(/^[0-9a-f-]{36}$/);
      const html = await response.text();
      for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
        expect(tag).toContain(`nonce="${cspNonce(response)}"`);
      }
    }
  });

  it('serves API responses with no-store and the deny-all CSP', async () => {
    const response = await fetch(`${base}/api/v1/health`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
  });
});
