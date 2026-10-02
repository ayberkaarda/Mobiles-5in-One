import { type ChildProcess, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testEnvSource } from '../support/env';
import { BUILD_PRESENT, freePort } from '../security/support/server';
import { prerequisite } from '../support/prerequisite';
import { freshToken } from './support';

/**
 * ADR-0040 pages against the production build (`next start`), with the server's output captured:
 * every page answers 200 with the nonce CSP, a nonce on every script, `noindex` and (token pages)
 * `no-referrer` / `no-store`; a token in the fragment never reaches the server, its logs or the
 * response. Without `next build` output the suite is skipped locally and says so; under CI=true
 * it fails.
 */

const ENABLED = prerequisite(
  BUILD_PRESENT,
  'built-pages.test',
  'apps/web/.next/BUILD_ID is missing, run `pnpm build` first',
);

const APP_DIR = fileURLToPath(new URL('../../', import.meta.url));
const NEXT_BIN = fileURLToPath(new URL('../../node_modules/next/dist/bin/next', import.meta.url));
const PAGES = ['/e-posta-dogrula', '/sifre-sifirla', '/sifremi-unuttum', '/giris', '/hesap-silme'];
const TOKEN_PAGES = ['/e-posta-dogrula', '/sifre-sifirla'];

let child: ChildProcess | undefined;
let base = '';
let output = '';

function nonceOf(response: Response): string {
  const csp = response.headers.get('content-security-policy') ?? '';
  const nonce = /script-src 'self' 'nonce-([A-Za-z0-9+/=]+)' 'strict-dynamic'/.exec(csp)?.[1];
  expect(nonce, csp).toBeDefined();
  return nonce ?? '';
}

describe.skipIf(!ENABLED)('email-link pages (production build)', () => {
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
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        const response = await fetch(`${base}/api/v1/health`);
        await response.arrayBuffer();
        if (response.ok) {
          break;
        }
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline || child.exitCode !== null) {
        throw new Error('built server did not become ready');
      }
      await delay(250);
    }
  });

  afterAll(() => {
    child?.kill();
  });

  for (const pathname of PAGES) {
    it(`${pathname}: 200, nonce on every script, noindex, no inline script without nonce`, async () => {
      const response = await fetch(`${base}${pathname}`);
      expect(response.status).toBe(200);
      const nonce = nonceOf(response);
      const csp = response.headers.get('content-security-policy') ?? '';
      expect(csp).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/);
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("connect-src 'self'");
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      expect(response.headers.get('cache-control') ?? '').toContain('no-store');
      const html = await response.text();
      const scripts = html.match(/<script\b[^>]*>/g) ?? [];
      expect(scripts.length).toBeGreaterThan(0);
      for (const tag of scripts) {
        expect(tag).toContain(`nonce="${nonce}"`);
      }
      expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"\s*\/?>/);
      expect(html.match(/<h1\b/g)).toHaveLength(1);
      // No third-party origin anywhere in the document.
      for (const [, url] of html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)) {
        expect(url).toMatch(/^http:\/\/127\.0\.0\.1:/);
      }
    });
  }

  it('token pages send no-referrer in the header and the document', async () => {
    for (const pathname of TOKEN_PAGES) {
      const response = await fetch(`${base}${pathname}`);
      expect(response.headers.get('referrer-policy'), pathname).toBe('no-referrer');
      const html = await response.text();
      expect(html, pathname).toMatch(/<meta name="referrer" content="no-referrer"\s*\/?>/);
    }
    const login = await fetch(`${base}/giris`);
    expect(login.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    await login.arrayBuffer();
  });

  it('never sees a fragment token: not in the response, not in the server output', async () => {
    const token = freshToken();
    for (const pathname of TOKEN_PAGES) {
      const response = await fetch(`${base}${pathname}#token=${token}`);
      expect(response.status).toBe(200);
      expect(response.url).not.toContain(token);
      const html = await response.text();
      expect(html).not.toContain(token);
      expect(JSON.stringify([...response.headers])).not.toContain(token);
    }
    await delay(200);
    expect(output).not.toContain(token);
  });

  it('hands the login form only a fixed continuation target', async () => {
    const targetOf = async (query: string): Promise<string[]> => {
      const html = await (await fetch(`${base}/giris${query}`)).text();
      // The form's `next` prop as serialized in the RSC payload of the page.
      return [...html.matchAll(/\\?"next\\?":\\?"([^"\\]*)/g)].map((match) => match[1] ?? '');
    };
    expect(await targetOf(`?devam=${encodeURIComponent('https://evil.example/x')}`)).toEqual(['/']);
    expect(await targetOf(`?devam=${encodeURIComponent('//evil.example')}`)).toEqual(['/']);
    expect(await targetOf('?devam=/hesap-silme')).toEqual(['/hesap-silme']);
  });
});
