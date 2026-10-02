import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';

import { json, route } from '../lib/server/http';
import { handleProxyRequest } from '../lib/server/proxy-handler';
import { noParams, noQuery } from '../lib/server/validate';
import { TEST_SECOND_ORIGIN, TEST_WEB_ORIGIN, testEnv } from './support/env';
import { call, expectProblem, MOBILE, WEB } from './support/http';
import { installTestRuntime } from './support/runtime';

const env = testEnv();
const EVIL = 'https://evil.example';

function apiRequest(init: { method?: string; headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest('https://kadro.app/api/v1/health', {
    method: init.method ?? 'GET',
    headers: init.headers,
  });
}

function preflight(origin: string, requestHeaders = 'content-type, x-kadro-client'): Response {
  return handleProxyRequest(
    apiRequest({
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': requestHeaders,
      },
    }),
    env,
  );
}

describe('CORS on actual requests (security checklist item 8)', () => {
  it('sends no Access-Control-Allow-* header to an unknown origin', () => {
    const response = handleProxyRequest(apiRequest({ headers: { origin: EVIL } }), env);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    expect(response.headers.get('vary')).toBe('Origin');
  });

  it('allows credentials for the web origin only', () => {
    const web = handleProxyRequest(apiRequest({ headers: { origin: TEST_WEB_ORIGIN } }), env);
    expect(web.headers.get('access-control-allow-origin')).toBe(TEST_WEB_ORIGIN);
    expect(web.headers.get('access-control-allow-credentials')).toBe('true');

    const second = handleProxyRequest(apiRequest({ headers: { origin: TEST_SECOND_ORIGIN } }), env);
    expect(second.headers.get('access-control-allow-origin')).toBe(TEST_SECOND_ORIGIN);
    expect(second.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('never answers with a wildcard or reflects look-alike origins', () => {
    for (const origin of [
      EVIL,
      'null',
      `${TEST_WEB_ORIGIN}.evil.example`,
      'https://evilkadro.app',
      'http://kadro.app',
      `${TEST_WEB_ORIGIN}/`,
      '*',
    ]) {
      const response = handleProxyRequest(apiRequest({ headers: { origin } }), env);
      expect(response.headers.get('access-control-allow-origin'), origin).toBeNull();
    }
  });

  it('leaves requests without Origin (mobile app) untouched', () => {
    const response = handleProxyRequest(apiRequest(), env);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('vary')).toBe('Origin');
  });
});

describe('CORS preflight', () => {
  it('lets the web origin send the client and CSRF headers', () => {
    const response = preflight(TEST_WEB_ORIGIN);
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(TEST_WEB_ORIGIN);
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(response.headers.get('access-control-allow-methods')).toBe(
      'GET, POST, PUT, PATCH, DELETE',
    );
    expect(response.headers.get('access-control-allow-headers')).toBe(
      'content-type, x-kadro-client, x-csrf-token',
    );
    expect(response.headers.get('access-control-max-age')).toBe('600');
    expect(response.headers.get('vary')).toContain('Origin');
  });

  it('allows only content-type for other configured origins (ADR-0014)', () => {
    const response = preflight(TEST_SECOND_ORIGIN);
    expect(response.headers.get('access-control-allow-headers')).toBe('content-type');
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('refuses an unknown origin by omitting every allow header', () => {
    const response = preflight(EVIL);
    expect(response.status).toBe(204);
    for (const header of [
      'access-control-allow-origin',
      'access-control-allow-methods',
      'access-control-allow-headers',
      'access-control-allow-credentials',
    ]) {
      expect(response.headers.get(header)).toBeNull();
    }
  });

  it('carries the security headers on preflight responses too', () => {
    const response = preflight(EVIL);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('x-kadro-client header (ADR-0014)', () => {
  beforeAll(async () => {
    await installTestRuntime();
  });

  const probe = route({
    path: '/api/v1/test/probe',
    method: 'GET',
    auth: 'none',
    params: noParams,
    query: noQuery,
    body: null,
    handler: ({ ctx }) => json({ client: ctx.client }),
  });

  const exempt = route({
    path: '/api/v1/health',
    method: 'GET',
    client: 'exempt',
    auth: 'none',
    params: noParams,
    query: noQuery,
    body: null,
    handler: ({ ctx }) => json({ client: ctx.client }),
  });

  it('rejects a missing header with 400', async () => {
    const body = await expectProblem(await call(probe), 400, 'validation_failed');
    expect(body.errors).toEqual([{ path: 'headers.x-kadro-client', issue: 'invalid_value' }]);
  });

  it('rejects an unknown value with 400', async () => {
    for (const value of ['desktop', 'MOBILE', '', 'mobile,web']) {
      const response = await call(probe, { headers: { 'x-kadro-client': value } });
      await expectProblem(response, 400, 'validation_failed');
    }
  });

  it('rejects mobile together with an Origin header', async () => {
    const response = await call(probe, { headers: { ...MOBILE, origin: TEST_WEB_ORIGIN } });
    const body = await expectProblem(response, 400, 'validation_failed');
    expect(body.errors).toEqual([{ path: 'headers.origin', issue: 'unexpected_origin' }]);
  });

  it('accepts mobile without Origin and web with Origin', async () => {
    expect(await (await call(probe, { headers: MOBILE })).json()).toEqual({ client: 'mobile' });
    const web = await call(probe, { headers: { ...WEB, origin: TEST_WEB_ORIGIN } });
    expect(await web.json()).toEqual({ client: 'web' });
  });

  it('lets exempt endpoints omit the header but still validates a present one', async () => {
    expect(await (await call(exempt)).json()).toEqual({ client: null });
    await expectProblem(
      await call(exempt, { headers: { 'x-kadro-client': 'tv' } }),
      400,
      'validation_failed',
    );
    await expectProblem(
      await call(exempt, { headers: { ...MOBILE, origin: EVIL } }),
      400,
      'validation_failed',
    );
  });
});
