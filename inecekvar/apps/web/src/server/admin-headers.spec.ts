// @vitest-environment node
import { createWebApp, type PageRenderer } from './app';
import { loadWebServerConfig } from './config';
import { isAdminPath, MemoryLruPageCache } from './page-cache';
import { closeServers, htmlResponse, httpRequest, startApp } from './test-helpers';

afterEach(closeServers);

async function fixture(env: Record<string, string> = { INECEKVAR_ENV: 'test' }) {
  const config = loadWebServerConfig(env);
  const cache = new MemoryLruPageCache({ maxEntries: 10, maxBytes: 4 * 1024 * 1024 });
  const render = vi.fn<PageRenderer>(async () => htmlResponse());
  const port = await startApp(createWebApp({ config, cache, render }));
  return { port, render };
}

describe('admin responses', () => {
  it.each([
    '/admin',
    '/admin/kuyruk',
    '/%61dmin/giris',
    '/ADMIN/denetim',
    '/admin;x',
    '/ADMIN%3Bx',
    '/admin%3bx/kuyruk',
    '/admin/kuyruk;v=1',
  ])('are noindex and no-store: %s', async (path) => {
    const { port } = await fixture();
    const result = await httpRequest(port, { path });
    expect(result.headers['x-robots-tag']).toBe('noindex, nofollow');
    if (result.status === 200) expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('leaves public pages indexable and privately cacheable', async () => {
    const { port } = await fixture();
    const result = await httpRequest(port, { path: '/istanbul' });
    expect(result.headers['x-robots-tag']).toBeUndefined();
    expect(result.headers['cache-control']).toBe('private, no-cache');
  });

  it.each([
    ['/admin', true],
    ['/admin/x', true],
    ['/Admin', true],
    ['/%61dmin', true],
    ['/%E0%A4%A', true],
    ['/admin;x', true],
    ['/ADMIN%3Bx', true],
    ['/%61dmin%3b', true],
    ['/admin;x/kuyruk', true],
    ['/administration', false],
    ['/istanbul/admin', false],
  ] as const)('classifies %s', (path, expected) => {
    expect(isAdminPath(path)).toBe(expected);
  });
});
