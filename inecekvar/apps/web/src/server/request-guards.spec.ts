// @vitest-environment node
import express from 'express';
import { createWebApp, type PageRenderer } from './app';
import { loadWebServerConfig } from './config';
import { stripProxyHeaders } from './request-guards';
import { closeServers, htmlResponse, httpRequest, renderedRequest, startApp } from './test-helpers';

afterEach(closeServers);

async function fixture(env: Record<string, string | undefined> = {}) {
  const render = vi.fn<PageRenderer>(async () => htmlResponse());
  const port = await startApp(createWebApp({ config: loadWebServerConfig(env), render }));
  return { port, render };
}

describe('request guards', () => {
  it('rejects POST before rendering with the supported methods', async () => {
    const { port, render } = await fixture();
    const result = await httpRequest(port, { method: 'POST' });
    expect(result.status).toBe(405);
    expect(result.headers.allow).toBe('GET, HEAD');
    expect(result.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(result.headers['cache-control']).toBe('no-store');
    expect(render).not.toHaveBeenCalled();
  });

  it('rejects GET bodies', async () => {
    const { port, render } = await fixture();
    const result = await httpRequest(port, {
      headers: { 'Content-Length': '1' },
      body: 'x',
    });
    expect(result.status).toBe(413);
    expect(render).not.toHaveBeenCalled();
  });

  it('rejects transfer encoding even for an empty body', async () => {
    const { port, render } = await fixture();
    const result = await httpRequest(port, { headers: { 'Transfer-Encoding': 'chunked' } });
    expect(result.status).toBe(413);
    expect(render).not.toHaveBeenCalled();
  });

  it('accepts zero content length', async () => {
    const { port } = await fixture();
    expect((await httpRequest(port, { headers: { 'Content-Length': '0' } })).status).toBe(200);
  });

  it('rejects URLs longer than 2048 characters', async () => {
    const { port, render } = await fixture();
    expect((await httpRequest(port, { path: '/' + 'a'.repeat(2048) })).status).toBe(414);
    expect(render).not.toHaveBeenCalled();
  });

  it('rejects absolute-form targets before rendering', async () => {
    const { port, render } = await fixture();
    const result = await httpRequest(port, { path: 'http://evil.example/istanbul' });
    expect(result.status).toBe(400);
    expect(render).not.toHaveBeenCalled();
  });

  it.each([
    'evil.example',
    'inecekvar.app.evil.example',
    'inecekvar.app@evil.example',
    '',
    'inecekvar.app,evil.example',
    'inecekvar.app evil.example',
    'inecekvar.app:123456',
    '[::1]',
  ])('rejects hostile Host headers: %s', async (Host) => {
    const { port, render } = await fixture();
    const result = await httpRequest(port, { headers: { Host } });
    expect(result.status).toBe(400);
    expect(result.body).toBe('Bad request');
    expect(result.headers['cache-control']).toBe('no-store');
    expect(render).not.toHaveBeenCalled();
  });

  it('rejects multiple Host fields instead of accepting the first', async () => {
    const { port, render } = await fixture();
    const result = await httpRequest(port, {
      headers: ['Host', 'inecekvar.app', 'Host', 'evil.example'],
    });
    expect(result.status).toBe(400);
    expect(render).not.toHaveBeenCalled();
  });

  it('ignores spoofed proxy headers and renders only the canonical URL', async () => {
    const { port, render } = await fixture();
    const result = await httpRequest(port, {
      path: '/istanbul?sayfa=2&unknown=ignored',
      headers: {
        Host: 'INECEKVAR.APP:4000',
        'X-Forwarded-Host': 'evil.example',
        'X-Forwarded-Proto': 'http',
        Forwarded: 'host=evil.example;proto=http',
        'X-Original-Url': '/other',
        'X-Rewrite-Url': '/other',
        'X-Http-Method-Override': 'POST',
      },
    });
    expect(result.status).toBe(200);
    const request = renderedRequest(render);
    expect(request.url).toBe('https://inecekvar.app/istanbul?sayfa=2');
    expect(request.method).toBe('GET');
    expect([...request.headers]).toEqual([['accept', 'text/html']]);
  });

  it('removes every proxy header before later middleware reads it', async () => {
    const app = express();
    app.use(stripProxyHeaders);
    app.use((req, res) => res.json(req.headers));
    const port = await startApp(app);
    const result = await httpRequest(port, {
      headers: {
        Forwarded: 'host=evil.example',
        'X-Forwarded-Unusual': 'evil.example',
        'X-Original-Url': '/other',
        'X-Rewrite-Url': '/other',
        'X-Http-Method-Override': 'POST',
      },
    });
    const headers = JSON.parse(result.body);
    for (const name of [
      'forwarded',
      'x-forwarded-unusual',
      'x-original-url',
      'x-rewrite-url',
      'x-http-method-override',
    ]) {
      expect(headers[name]).toBeUndefined();
    }
  });

  it('redirects the production alias with only allowlisted query parameters', async () => {
    const { port, render } = await fixture();
    const result = await httpRequest(port, {
      path: '/istanbul?unknown=ignored&sayfa=2',
      headers: { Host: 'www.inecekvar.app' },
    });
    expect(result.status).toBe(301);
    expect(result.headers.location).toBe('https://inecekvar.app/istanbul?sayfa=2');
    expect(render).not.toHaveBeenCalled();
  });

  it('accepts bracketed IPv6 only when explicitly allowed outside production', async () => {
    const { port } = await fixture({ INECEKVAR_ENV: 'local', IV_WEB_ALLOWED_HOSTS: '::1' });
    expect((await httpRequest(port, { headers: { Host: '[::1]:4200' } })).status).toBe(200);
  });

  it('allows container health probes with a production loopback Host', async () => {
    const { port, render } = await fixture();
    const result = await httpRequest(port, { path: '/healthz', headers: { Host: '127.0.0.1' } });
    expect(result.status).toBe(200);
    expect(result.body).toBe('ok');
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(render).not.toHaveBeenCalled();
  });
});
