// @vitest-environment node
import { createWebApp } from './app';
import { loadWebServerConfig } from './config';
import { applyNonce, createNonce, NONCE_PLACEHOLDER } from './csp-nonce';
import { PERMISSIONS_POLICY } from './security-headers';
import {
  closeServers,
  expectNonceAttributes,
  htmlResponse,
  httpRequest,
  responseNonce,
  startApp,
  type HttpResult,
} from './test-helpers';

afterEach(closeServers);

function expectSecurityHeaders(result: HttpResult): void {
  expect(result.headers['strict-transport-security']).toBe(
    'max-age=63072000; includeSubDomains; preload',
  );
  expect(result.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(result.headers['permissions-policy']).toBe(PERMISSIONS_POLICY);
  expect(result.headers['permissions-policy']).toBe('geolocation=(self), camera=(), microphone=()');
  expect(result.headers['x-content-type-options']).toBe('nosniff');
  expect(result.headers['x-frame-options']).toBe('DENY');
  expect(result.headers['x-powered-by']).toBeUndefined();
  expect(result.headers['cross-origin-opener-policy']).toBe('same-origin');
  expect(result.headers['cross-origin-resource-policy']).toBe('same-origin');
  expect(result.headers['cross-origin-embedder-policy']).toBeUndefined();
  const csp = String(result.headers['content-security-policy']);
  for (const directive of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'"]) {
    expect(csp.split(';')).toContain(directive);
  }
}

describe('security headers', () => {
  it('sets the complete production policy and matches every inline nonce', async () => {
    const config = loadWebServerConfig({
      IV_WEB_API_PUBLIC_ORIGIN: 'https://api.example.test',
      IV_WEB_TILES_ORIGIN: 'https://tiles.example.test',
    });
    const port = await startApp(createWebApp({ config, render: async () => htmlResponse() }));
    const result = await httpRequest(port);
    expect(result.status).toBe(200);
    expectSecurityHeaders(result);
    const nonce = responseNonce(result);
    const directives = String(result.headers['content-security-policy']).split(';');
    for (const directive of [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}'`,
      "script-src-attr 'none'",
      `style-src 'self' 'nonce-${nonce}'`,
      "img-src 'self' data: https://tiles.example.test",
      "font-src 'self'",
      "connect-src 'self' https://api.example.test https://tiles.example.test",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "manifest-src 'self'",
      'upgrade-insecure-requests',
    ]) {
      expect(directives).toContain(directive);
    }
    expectNonceAttributes(result);
    expect(result.headers['cache-control']).toBe('private, no-cache');
  });

  it('allows dev sockets without upgrading local HTTP requests', async () => {
    const config = loadWebServerConfig({ INECEKVAR_ENV: 'local' });
    const port = await startApp(createWebApp({ config, render: async () => htmlResponse() }));
    const result = await httpRequest(port);
    const csp = String(result.headers['content-security-policy']);
    expect(csp).toContain('ws://localhost:* ws://127.0.0.1:*');
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('keeps security headers on missing pages, failed renders and robots', async () => {
    const config = loadWebServerConfig({});
    const render = vi.fn(async (request: Request) => {
      if (new URL(request.url).pathname === '/failure') {
        throw new Error('Private failure detail');
      }
      return null;
    });
    const port = await startApp(createWebApp({ config, render }));
    const missing = await httpRequest(port, { path: '/missing' });
    const failed = await httpRequest(port, { path: '/failure' });
    const robots = await httpRequest(port, { path: '/robots.txt' });
    expect(missing.status).toBe(404);
    expect(failed.status).toBe(500);
    expect(robots.status).toBe(200);
    for (const result of [missing, failed, robots]) {
      expectSecurityHeaders(result);
    }
    expect(failed.headers['cache-control']).toBe('no-store');
    expect(failed.body).toContain('Bir sorun oluştu');
    expect(failed.body).not.toContain('Private failure detail');
    expect(failed.body).not.toContain('/failure');
    expect(robots.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(robots.headers['cache-control']).toBe('public, max-age=3600');
    expect(robots.body).toContain('Sitemap: https://inecekvar.app/sitemap.xml');
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('does not let renderer headers override security policy', async () => {
    const config = loadWebServerConfig({});
    const port = await startApp(
      createWebApp({
        config,
        render: async () =>
          htmlResponse(200, {
            'content-security-policy': "default-src * 'unsafe-inline'",
            'x-powered-by': 'hidden',
            'permissions-policy': 'camera=(*)',
            'cache-control': 'public, max-age=86400',
          }),
      }),
    );
    const result = await httpRequest(port);
    expectSecurityHeaders(result);
    expectNonceAttributes(result);
    expect(result.headers['cache-control']).toBe('private, no-cache');
  });
});

describe('nonce substitution', () => {
  it('replaces only exact raw attributes and preserves escaped content', () => {
    const nonce = createNonce();
    const text =
      `<script nonce="${NONCE_PLACEHOLDER}"></script>` +
      `<iv-root ngCspNonce="${NONCE_PLACEHOLDER}"></iv-root>` +
      `<p>nonce=&quot;${NONCE_PLACEHOLDER}&quot; ${NONCE_PLACEHOLDER}</p>` +
      `<p data-nonce="${NONCE_PLACEHOLDER}"></p>`;
    expect(applyNonce(text, nonce)).toBe(
      `<script nonce="${nonce}"></script>` +
        `<iv-root ngCspNonce="${nonce}"></iv-root>` +
        `<p>nonce=&quot;${NONCE_PLACEHOLDER}&quot; ${NONCE_PLACEHOLDER}</p>` +
        `<p data-nonce="${NONCE_PLACEHOLDER}"></p>`,
    );
  });

  it.each(['', 'short', 'a'.repeat(24), '" unsafe'])('rejects an invalid nonce', (nonce) => {
    expect(() => applyNonce('', nonce)).toThrow('Invalid CSP nonce');
  });
});
