import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testEnvSource } from './support/env';

/**
 * Threat model §6.2 against the production build: Next.js must apply the per-request nonce of
 * the proxy CSP to every script it renders, and look-alike static paths must still pass the
 * proxy. Runs when `next build` output exists (`pnpm build` before `pnpm test`); otherwise the
 * suite is skipped and the unit-level proxy tests remain the guard.
 */

const APP_DIR = fileURLToPath(new URL('..', import.meta.url));
// eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path inside this package
const BUILT = existsSync(fileURLToPath(new URL('../.next/BUILD_ID', import.meta.url)));
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
