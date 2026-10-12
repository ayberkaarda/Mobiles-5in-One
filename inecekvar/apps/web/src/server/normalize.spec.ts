// @vitest-environment node
import { createWebApp, PageRenderer } from './app';
import { loadWebServerConfig } from './config';
import { classifyTarget } from './normalize';
import { MemoryLruPageCache } from './page-cache';
import { closeServers, htmlResponse, httpRequest, startApp } from './test-helpers';
import { contentPaths } from '../content/site-paths';

afterEach(closeServers);

async function fixture(env: Record<string, string> = {}) {
  const render = vi.fn<PageRenderer>(async () => htmlResponse());
  const cache = new MemoryLruPageCache({ maxEntries: 10, maxBytes: 4 * 1024 * 1024 });
  const config = loadWebServerConfig({ INECEKVAR_ENV: 'test', ...env });
  const port = await startApp(createWebApp({ config, render, cache }));
  return { port, render, cache };
}

describe('URL normalization', () => {
  it.each([
    ['/istanbul///', '/istanbul'],
    ['/ISTANBUL', '/istanbul'],
    ['/ISTANBUL/HATLAR///?sayfa=1&drop=x', '/istanbul/hatlar'],
    ['/istanbul/hatlar?sayfa=1', '/istanbul/hatlar'],
    ['/ADMIN///?z=2&sayfa=3&a=1&drop=x', '/admin?a=1&sayfa=3&z=2'],
    ['/Admin/x', '/admin/x'],
    ['/%69stanbul', '/istanbul'],
    ['/i%73tanbul', '/istanbul'],
    ['/%49STANBUL/hatlar', '/istanbul/hatlar'],
    ['/istanbul%2Fhatlar', '/istanbul/hatlar'],
    ['/istanbul/hat/m%31', '/istanbul/hat/m1'],
  ])('redirects %s once to the decoded canonical slug path', (input, expected) => {
    expect(classifyTarget(input, ['sayfa', 'z', 'a'])).toEqual({
      kind: 'redirect',
      location: expected,
    });
  });

  it.each([
    '/',
    '/istanbul',
    '/istanbul/hatlar?sayfa=2',
    '/istanbul?drop=x',
    '/istanbul/hatlar?sayfa=1&sayfa=2',
    '/istanbul/rota/a-b',
  ])('serves the canonical %s', (path) => {
    expect(classifyTarget(path, ['sayfa'])).toEqual({ kind: 'serve' });
  });

  it.each([
    '/istanbul;x=1',
    '/istanbul;x=2',
    '/istanbul/hatlar;v=1',
    '/admin;x',
    '/istanbul%3Bx=1',
    '/istanbul~',
    '/istanbul%7E',
    '/istanbul//hatlar',
    '/istanbul/./hatlar',
    '/istanbul/%2e%2e/admin',
    '/istanbul.html',
    '/assets/Icon.svg',
    '/main-ABCDEF12.js',
    '/İzmir/',
    '/%C4%B0zmir',
    '/A%20B/',
    '/istanbul%',
    '/%E0%A4%A',
    '/istanbul--hatlar',
  ])('refuses the non-canonical %s', (path) => {
    expect(classifyTarget(path, ['sayfa'])).toEqual({ kind: 'reject' });
  });

  it('accepts every registered content path as canonical', () => {
    for (const path of contentPaths()) {
      expect(classifyTarget(path, ['sayfa'])).toEqual({ kind: 'serve' });
    }
  });

  it('redirects before rendering, keeps the query allowlist and sends cache headers', async () => {
    const { port, render } = await fixture({ IV_WEB_CACHE_QUERY_ALLOWLIST: 'z,sayfa,a' });
    const result = await httpRequest(port, { path: '/ISTANBUL/HATLAR///?z=2&sayfa=1&drop=x&a=1' });
    expect(result.status).toBe(301);
    expect(result.headers.location).toBe('/istanbul/hatlar?a=1&z=2');
    expect(result.headers['cache-control']).toBe('public, max-age=3600');
    expect(render).not.toHaveBeenCalled();
    const normal = await httpRequest(port, { path: '/istanbul/hatlar' });
    expect(normal.status).toBe(200);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('neither renders nor caches matrix parameters and encoded variants', async () => {
    const { port, render, cache } = await fixture();
    const set = vi.spyOn(cache, 'set');
    const get = vi.spyOn(cache, 'get');
    for (const path of ['/istanbul;x=1', '/istanbul;x=2', '/istanbul%3Bx=3', '/istanbul~']) {
      const result = await httpRequest(port, { path });
      expect(result.status).toBe(404);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.headers['x-cache']).toBeUndefined();
    }
    for (const path of ['/%69stanbul', '/i%73tanbul', '/%69%73tanbul']) {
      const result = await httpRequest(port, { path });
      expect(result.status).toBe(301);
      expect(result.headers.location).toBe('/istanbul');
    }
    expect(render).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
});

describe('cache-bypass renders', () => {
  it('limits bypass renders per client and answers 429 without rendering', async () => {
    const { port, render } = await fixture({ IV_WEB_BYPASS_RENDER_BURST: '3' });
    const statuses: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const result = await httpRequest(port, { path: '/istanbul', headers: { Cookie: 'a=b' } });
      statuses.push(result.status);
      if (result.status === 429) {
        expect(result.headers['retry-after']).toMatch(/^\d+$/);
        expect(result.headers['cache-control']).toBe('no-store');
      }
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect(render).toHaveBeenCalledTimes(3);
  });

  it('never limits cacheable requests', async () => {
    const { port, render } = await fixture({ IV_WEB_BYPASS_RENDER_BURST: '1' });
    for (let index = 0; index < 4; index += 1) {
      expect((await httpRequest(port, { path: '/istanbul' })).status).toBe(200);
    }
    expect(render).toHaveBeenCalledTimes(1);
  });
});
