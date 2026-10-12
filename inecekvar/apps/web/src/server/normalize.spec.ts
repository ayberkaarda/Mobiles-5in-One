// @vitest-environment node
import { createWebApp, PageRenderer } from './app';
import { loadWebServerConfig } from './config';
import { normalizedLocation } from './normalize';
import { closeServers, htmlResponse, httpRequest, startApp } from './test-helpers';

afterEach(closeServers);
describe('URL normalization', () => {
  it.each([
    ['/istanbul///', '/istanbul'],
    ['/ISTANBUL', '/istanbul'],
    ['/ISTANBUL/HATLAR///?sayfa=1&drop=x', '/istanbul/hatlar'],
    ['/istanbul/hatlar?sayfa=1', '/istanbul/hatlar'],
    ['/ADMIN///?z=2&sayfa=3&a=1&drop=x', '/admin?a=1&sayfa=3&z=2'],
    ['/Admin/x', '/admin/x'],
    ['/İzmir/', '/İzmir'],
    ['/A%20B/', '/A%20B'],
  ])('normalizes %s in one relative redirect', (input, expected) => {
    expect(normalizedLocation(input, ['sayfa', 'z', 'a'])).toBe(expected);
  });
  it.each([
    '/',
    '/istanbul',
    '/istanbul/hatlar?sayfa=2',
    '/istanbul?drop=x',
    '/assets/Icon.svg',
    '/assets/Icon.svg/',
    '/main-ABCDEF12.js',
    '/maplibre/maplibre-gl-worker.mjs',
    '//evil.example/',
    '/istanbul/hatlar?sayfa=1&sayfa=2',
  ])('keeps %s intact', (path) => {
    expect(normalizedLocation(path, ['sayfa'])).toBeNull();
  });
  it('redirects before rendering, keeps the query allowlist and sends cache headers', async () => {
    const render = vi.fn<PageRenderer>(async () => htmlResponse());
    const config = loadWebServerConfig({
      INECEKVAR_ENV: 'test',
      IV_WEB_CACHE_QUERY_ALLOWLIST: 'z,sayfa,a',
    });
    const port = await startApp(createWebApp({ config, render }));
    const result = await httpRequest(port, { path: '/ISTANBUL/HATLAR///?z=2&sayfa=1&drop=x&a=1' });
    expect(result.status).toBe(301);
    expect(result.headers.location).toBe('/istanbul/hatlar?a=1&z=2');
    expect(result.headers['cache-control']).toBe('public, max-age=3600');
    expect(render).not.toHaveBeenCalled();
    const normal = await httpRequest(port, { path: '/istanbul/hatlar' });
    expect(normal.status).toBe(200);
    expect(render).toHaveBeenCalledTimes(1);
  });
});
