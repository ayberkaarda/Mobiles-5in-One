// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWebApp, type PageRenderer } from './app';
import { loadWebServerConfig } from './config';
import { NONCE_PLACEHOLDER } from './csp-nonce';
import { MemoryLruPageCache, type PageCacheStore } from './page-cache';
import {
  closeServers,
  expectNonceAttributes,
  fakeHtml,
  htmlResponse,
  httpRequest,
  renderedRequest,
  responseNonce,
  startApp,
} from './test-helpers';

const folders: string[] = [];

afterEach(async () => {
  await closeServers();
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

async function fixture(
  options: {
    render?: PageRenderer;
    cache?: PageCacheStore;
    env?: Record<string, string | undefined>;
    log?: (event: string) => void;
  } = {},
) {
  const config = loadWebServerConfig({ INECEKVAR_ENV: 'test', ...options.env });
  const cache =
    options.cache ?? new MemoryLruPageCache({ maxEntries: 10, maxBytes: 4 * 1024 * 1024 });
  const render = vi.fn<PageRenderer>(options.render ?? (async () => htmlResponse()));
  const port = await startApp(createWebApp({ config, cache, render, log: options.log }));
  return { port, render, cache };
}

describe('page cache behaviour', () => {
  it('renders the first GET once and serves the second from cache', async () => {
    const { port, render } = await fixture();
    const first = await httpRequest(port);
    const second = await httpRequest(port);
    expect(first.headers['x-cache']).toBe('MISS');
    expect(second.headers['x-cache']).toBe('HIT');
    expect(second.status).toBe(200);
    expect(second.headers['cache-control']).toBe('private, no-cache');
    expect(render).toHaveBeenCalledTimes(1);
  });

  it.each([301, 404, 500])('never stores status %s', async (status) => {
    const { port, render } = await fixture({ render: async () => htmlResponse(status) });
    expect((await httpRequest(port)).status).toBe(status);
    expect((await httpRequest(port)).headers['x-cache']).toBe('MISS');
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('never stores a response that sets cookies and preserves all cookie fields', async () => {
    const { port, render, cache } = await fixture({
      render: async () => {
        const response = htmlResponse();
        response.headers.append('set-cookie', 'session=one; HttpOnly; Path=/');
        response.headers.append('set-cookie', 'region=tr; Path=/');
        return response;
      },
    });
    const set = vi.spyOn(cache, 'set');
    const first = await httpRequest(port);
    const second = await httpRequest(port);
    expect(first.headers['set-cookie']).toEqual([
      'session=one; HttpOnly; Path=/',
      'region=tr; Path=/',
    ]);
    expect(second.headers['x-cache']).toBe('MISS');
    expect(render).toHaveBeenCalledTimes(2);
    expect(set).not.toHaveBeenCalled();
  });

  it.each([{ Cookie: 'session=one' }, { Cookie: '' }, { Authorization: '' }])(
    'neither reads nor writes the cache for private requests: %s',
    async (headers) => {
      const { port, render, cache } = await fixture();
      await httpRequest(port);
      const get = vi.spyOn(cache, 'get');
      const set = vi.spyOn(cache, 'set');
      const result = await httpRequest(port, { headers });
      expect(result.headers['x-cache']).toBe('BYPASS');
      expect(get).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
      expect(render).toHaveBeenCalledTimes(2);
      const request = renderedRequest(render, 1);
      expect([...request.headers]).toEqual([['accept', 'text/html']]);
    },
  );

  it.each(['/admin', '/admin/x', '/admin/kuyruk'])(
    'never reads or writes private pages: %s',
    async (path) => {
      const { port, render, cache } = await fixture();
      const get = vi.spyOn(cache, 'get');
      const set = vi.spyOn(cache, 'set');
      expect((await httpRequest(port, { path })).headers['x-cache']).toBe('BYPASS');
      expect((await httpRequest(port, { path })).headers['x-cache']).toBe('BYPASS');
      expect(render).toHaveBeenCalledTimes(2);
      expect(get).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
    },
  );

  it('ignores unknown query input for both the key and the render URL', async () => {
    const { port, render } = await fixture();
    await httpRequest(port, { path: '/istanbul?x=<script>' });
    const second = await httpRequest(port, { path: '/istanbul?x=different' });
    expect(second.headers['x-cache']).toBe('HIT');
    expect(render).toHaveBeenCalledTimes(1);
    expect(renderedRequest(render).url).toBe('https://inecekvar.app/istanbul');
    expect(second.body).not.toContain('<script>');
  });

  it('uses identical sorted allowlisted queries for the key and render input', async () => {
    const { port, render } = await fixture({
      env: { IV_WEB_CACHE_QUERY_ALLOWLIST: 'sayfa,sort' },
    });
    await httpRequest(port, { path: '/istanbul?sort=a%20b&sayfa=2&x=ignored' });
    const second = await httpRequest(port, { path: '/istanbul?sayfa=2&sort=a+b' });
    expect(second.headers['x-cache']).toBe('HIT');
    expect(render).toHaveBeenCalledTimes(1);
    expect(renderedRequest(render).url).toBe('https://inecekvar.app/istanbul?sayfa=2&sort=a+b');
  });

  it('shares the page across language headers without forwarding them to rendering', async () => {
    const { port, render } = await fixture();
    await httpRequest(port, { headers: { 'Accept-Language': 'en' } });
    const second = await httpRequest(port, { headers: { 'Accept-Language': 'tr' } });
    expect(second.headers['x-cache']).toBe('HIT');
    expect(render).toHaveBeenCalledTimes(1);
    expect(renderedRequest(render).headers.has('accept-language')).toBe(false);
    expect([...renderedRequest(render).headers]).toEqual([['accept', 'text/html']]);
  });

  it('does not store hostile Host requests', async () => {
    const { port, render, cache } = await fixture();
    const get = vi.spyOn(cache, 'get');
    const set = vi.spyOn(cache, 'set');
    expect((await httpRequest(port, { headers: { Host: 'evil.example' } })).status).toBe(400);
    expect(render).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('omits the debug header in production on both misses and hits', async () => {
    const { port, render } = await fixture({ env: { INECEKVAR_ENV: 'production' } });
    expect((await httpRequest(port)).headers['x-cache']).toBeUndefined();
    expect((await httpRequest(port)).headers['x-cache']).toBeUndefined();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('gives two cache hits distinct nonces matching all response attributes', async () => {
    const { port, render, cache } = await fixture();
    const set = vi.spyOn(cache, 'set');
    const miss = await httpRequest(port);
    const firstHit = await httpRequest(port);
    const secondHit = await httpRequest(port);
    expect(firstHit.headers['x-cache']).toBe('HIT');
    expect(secondHit.headers['x-cache']).toBe('HIT');
    expect(responseNonce(firstHit)).not.toBe(responseNonce(secondHit));
    expect(responseNonce(miss)).not.toBe(responseNonce(firstHit));
    for (const result of [miss, firstHit, secondHit]) {
      expectNonceAttributes(result);
    }
    expect(set.mock.calls[0]?.[1].body).toContain(`nonce="${NONCE_PLACEHOLDER}"`);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('shares HEAD with GET and sends no body', async () => {
    const { port, render } = await fixture();
    const headMiss = await httpRequest(port, { method: 'HEAD' });
    expect(headMiss.headers['x-cache']).toBe('MISS');
    expect(headMiss.body).toBe('');
    expect(renderedRequest(render).method).toBe('GET');
    expect((await httpRequest(port)).headers['x-cache']).toBe('HIT');
    const headHit = await httpRequest(port, { method: 'HEAD' });
    expect(headHit.headers['x-cache']).toBe('HIT');
    expect(headHit.body).toBe('');
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('treats cache read and write errors as misses without failing the page', async () => {
    const cache: PageCacheStore = {
      get: vi.fn(async () => {
        throw new Error('Unavailable');
      }),
      set: vi.fn(async () => {
        throw new Error('Unavailable');
      }),
    };
    const log = vi.fn();
    const { port, render } = await fixture({ cache, log });
    expect((await httpRequest(port)).status).toBe(200);
    expect((await httpRequest(port)).status).toBe(200);
    expect(render).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith('page_cache_read_failed');
    expect(log).toHaveBeenCalledWith('page_cache_write_failed');
  });

  it('does not cache HTML exceeding one MiB', async () => {
    const { port, render, cache } = await fixture({
      render: async () =>
        new Response('a'.repeat(1024 * 1024 + 1), {
          headers: { 'content-type': 'text/html' },
        }),
    });
    const set = vi.spyOn(cache, 'set');
    await httpRequest(port);
    await httpRequest(port);
    expect(set).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('passes binary non-HTML responses unchanged without caching', async () => {
    const bytes = new Uint8Array([0, 255, 128, 65]);
    const { port, render, cache } = await fixture({
      render: async () =>
        new Response(bytes, {
          headers: { 'content-type': 'application/octet-stream', 'x-public-info': 'one' },
        }),
    });
    const set = vi.spyOn(cache, 'set');
    const result = await httpRequest(port);
    expect(result.bytes).toEqual(Buffer.from(bytes));
    expect(result.headers['x-public-info']).toBe('one');
    await httpRequest(port);
    expect(set).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(2);
  });
});

describe('static delivery', () => {
  it('never serves the HTML template as a file, even with a percent-encoded extension', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'iv-web-'));
    folders.push(folder);
    await writeFile(join(folder, 'index.html'), fakeHtml, 'utf8');
    await writeFile(join(folder, 'main-ABCDEFGH.js'), 'window.__asset=1;', 'utf8');
    await writeFile(join(folder, 'plain.js'), 'window.__plain=1;', 'utf8');
    const render = vi.fn<PageRenderer>(async () => htmlResponse());
    const port = await startApp(
      createWebApp({
        config: loadWebServerConfig({ INECEKVAR_ENV: 'test' }),
        browserDistFolder: folder,
        render,
      }),
    );
    for (const path of ['/index.html', '/index%2ehtml']) {
      const result = await httpRequest(port, { path });
      expect(result.status).toBe(404);
      expect(result.body).not.toContain(NONCE_PLACEHOLDER);
    }
    expect(render).not.toHaveBeenCalled();
    expectNonceAttributes(await httpRequest(port, { path: '/' }));
    const asset = await httpRequest(port, { path: '/main-ABCDEFGH.js' });
    expect(asset.body).toBe('window.__asset=1;');
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000');
    expect(asset.headers['content-security-policy']).toBeDefined();
    expect(render).toHaveBeenCalledTimes(1);
    const plain = await httpRequest(port, { path: '/plain.js' });
    expect(plain.headers['cache-control']).toBe('public, max-age=0');
  });

  it('keeps only Angular hashed output immutable, never the copied MapLibre worker', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'iv-web-'));
    folders.push(folder);
    await mkdir(join(folder, 'maplibre'));
    await mkdir(join(folder, 'media'));
    const files: [string, string][] = [
      ['chunk-DxPTq-Wd.js', 'public, max-age=31536000'],
      ['main-ETCRCT77.js', 'public, max-age=31536000'],
      ['styles-7W4JRJTZ.css', 'public, max-age=31536000'],
      ['media/font-ABCD1234.woff2', 'public, max-age=31536000'],
      ['maplibre/maplibre-gl-worker.mjs', 'public, max-age=0'],
      ['maplibre/maplibre-gl-shared.mjs', 'public, max-age=0'],
      ['maplibre/chunk-ABCDEFGH.js', 'public, max-age=0'],
      ['service-worker.js', 'public, max-age=0'],
      ['manifest.webmanifest', 'public, max-age=0'],
      ['icon-maskable.png', 'public, max-age=0'],
      ['favicon.ico', 'public, max-age=0'],
    ];
    for (const [name] of files) await writeFile(join(folder, name), 'x', 'utf8');
    const port = await startApp(
      createWebApp({
        config: loadWebServerConfig({ INECEKVAR_ENV: 'test' }),
        browserDistFolder: folder,
        render: async () => htmlResponse(),
      }),
    );
    for (const [name, expected] of files) {
      const result = await httpRequest(port, { path: '/' + name });
      expect([name, result.status, result.headers['cache-control']]).toEqual([name, 200, expected]);
    }
  });
});
