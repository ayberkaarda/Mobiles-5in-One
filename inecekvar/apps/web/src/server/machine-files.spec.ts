// @vitest-environment node
import { cityData, lineData, sitemapData, sitemapIndexData } from '../app/content/test-data';
import { createWebApp, type PageRenderer } from './app';
import { loadWebServerConfig } from './config';
import { MemoryLruPageCache } from './page-cache';
import { closeServers, httpRequest, startApp } from './test-helpers';

afterEach(async () => {
  await closeServers();
  vi.restoreAllMocks();
});

function publicResponse(url: URL): Response {
  switch (url.pathname) {
    case '/v1/sitemap':
      return Response.json(sitemapIndexData());
    case '/v1/cities/ornek-sehir':
      return Response.json(cityData({ is_sample: false }));
    case '/v1/cities/ornek-sehir/sitemap':
      return Response.json(sitemapData());
    case '/v1/lines/ornek-hat':
      return Response.json(lineData());
    default:
      return new Response(null, { status: 404 });
  }
}

async function fixture(
  options: {
    env?: Record<string, string | undefined>;
    response?: (url: URL) => Response;
  } = {},
) {
  const apiFetch = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return (options.response ?? publicResponse)(url);
  });
  const config = loadWebServerConfig({ INECEKVAR_ENV: 'test', ...options.env });
  const render = vi.fn<PageRenderer>(async () => null);
  const cache = new MemoryLruPageCache({ maxEntries: 10, maxBytes: 1024 * 1024 });
  const cacheGet = vi.spyOn(cache, 'get');
  const cacheSet = vi.spyOn(cache, 'set');
  const port = await startApp(createWebApp({ config, apiFetch, render, cache }));
  return { port, apiFetch, render, cacheGet, cacheSet };
}

function androidFingerprint(byte: string): string {
  return Array.from({ length: 32 }, () => byte).join(':');
}

describe('machine files', () => {
  it('lists only public cities using the exact API timestamps and caches the index', async () => {
    const { port, apiFetch, render, cacheGet, cacheSet } = await fixture({
      response: () =>
        Response.json({
          cities: [
            {
              slug: 'istanbul',
              is_sample: false,
              published_line_count: 5,
              lastmod: '2026-10-01T12:30:00.123+03:00',
            },
            {
              slug: 'ornek-sehir',
              is_sample: true,
              published_line_count: 50,
              lastmod: '2026-09-01T12:00:00Z',
            },
          ],
        }),
    });
    const path = '/sitemap.xml';
    const first = await httpRequest(port, { path });
    const second = await httpRequest(port, { path: path + '?ignored=1' });
    expect(first.status).toBe(200);
    expect(first.headers['content-type']).toBe('application/xml; charset=utf-8');
    expect(first.headers['cache-control']).toBe('public, max-age=3600');
    expect(first.body).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
        '<sitemap><loc>https://inecekvar.app/sitemaps/istanbul.xml</loc>' +
        '<lastmod>2026-10-01T09:30:00Z</lastmod></sitemap></sitemapindex>',
    );
    expect(second.body).toBe(first.body);
    expect(apiFetch).toHaveBeenCalledOnce();
    expect(render).not.toHaveBeenCalled();
    expect(cacheGet).not.toHaveBeenCalled();
    expect(cacheSet).not.toHaveBeenCalled();
  });

  it('uses sitemap dates for the hub, list, line and stop and escapes XML locations', async () => {
    const { port } = await fixture({
      env: { IV_WEB_CANONICAL_ORIGIN: 'https://a&b.example' },
    });
    const result = await httpRequest(port, { path: '/sitemaps/ornek-sehir.xml' });
    expect(result.status).toBe(200);
    expect(result.headers['content-type']).toBe('application/xml; charset=utf-8');
    expect(result.body).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
        '<url><loc>https://a&amp;b.example/ornek-sehir</loc>' +
        '<lastmod>2026-10-12T09:30:00Z</lastmod></url>' +
        '<url><loc>https://a&amp;b.example/ornek-sehir/hatlar</loc>' +
        '<lastmod>2026-10-12T09:30:00Z</lastmod></url>' +
        '<url><loc>https://a&amp;b.example/ornek-sehir/hat/ornek-hat</loc>' +
        '<lastmod>2026-10-01T09:30:00Z</lastmod></url>' +
        '<url><loc>https://a&amp;b.example/ornek-sehir/durak/ilk-durak</loc>' +
        '<lastmod>2026-10-02T10:00:00Z</lastmod></url></urlset>',
    );
    expect(result.body).not.toMatch(/&(?!amp;)/);
  });

  it('returns 404 for a sample city without reading its sitemap or caching the error', async () => {
    const { port, apiFetch } = await fixture({ response: () => Response.json(cityData()) });
    for (let i = 0; i < 2; i++) {
      const result = await httpRequest(port, { path: '/sitemaps/ornek-sehir.xml' });
      expect(result.status).toBe(404);
      expect(result.body).toBe('Sayfa bulunamadı');
      expect(result.headers['cache-control']).toBe('no-store');
    }
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(
      apiFetch.mock.calls.every(([input]) => String(input).endsWith('/cities/ornek-sehir')),
    ).toBe(true);
  });

  it('returns 404 for an unknown city', async () => {
    const { port, apiFetch } = await fixture();
    const result = await httpRequest(port, { path: '/sitemaps/bilinmeyen.xml' });
    expect(result.status).toBe(404);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body).toBe('Sayfa bulunamadı');
    expect(apiFetch).toHaveBeenCalledOnce();
  });

  it.each(['/sitemap.xml', '/sitemaps/ornek-sehir.xml', '/og/ornek-sehir/hat/ornek-hat.svg'])(
    'returns a generic uncached 503 with retry headers for upstream errors: %s',
    async (path) => {
      const { port, apiFetch } = await fixture({
        response: () => new Response('private upstream text', { status: 500 }),
      });
      for (let i = 0; i < 2; i++) {
        const result = await httpRequest(port, { path });
        expect(result.status).toBe(503);
        expect(result.headers['retry-after']).toBe('120');
        expect(result.headers['cache-control']).toBe('no-store');
        expect(result.body).toBe('Veriler şu anda kullanılamıyor.');
      }
      expect(apiFetch).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    '/sitemaps/bad--slug.xml',
    '/sitemaps/city.json',
    '/sitemaps/a%2Fb.xml',
    '/sitemaps/.xml',
    '/sitemaps/UPPER.xml',
    '/sitemaps/' + 'a'.repeat(121) + '.xml',
    '/og/bad--city/hat/ornek-hat.svg',
    '/og/ornek-sehir/hat/bad--line.svg',
    '/og/ornek-sehir/hat/ornek-hat.png',
  ])('falls through for an invalid file without fetching: %s', async (path) => {
    const { port, apiFetch, render } = await fixture();
    const result = await httpRequest(port, { path });
    expect(result.status).toBe(404);
    expect(result.body).toBe('Sayfa bulunamadı');
    expect(apiFetch).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledOnce();
  });

  it.each(['/.well-known/assetlinks.json', '/.well-known/apple-app-site-association'])(
    'returns 404 with no-store when association settings are absent: %s',
    async (path) => {
      const { port, apiFetch, render } = await fixture();
      const result = await httpRequest(port, { path });
      expect(result.status).toBe(404);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.body).toBe('Sayfa bulunamadı');
      expect(apiFetch).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
    },
  );

  it('serves the exact Android association with the configured certificates', async () => {
    const fingerprints = [androidFingerprint('AB'), androidFingerprint('CD')];
    const { port, apiFetch } = await fixture({
      env: { IV_WEB_ANDROID_CERT_SHA256: fingerprints.join(',') },
    });
    const result = await httpRequest(port, { path: '/.well-known/assetlinks.json' });
    expect(result.status).toBe(200);
    expect(result.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(result.headers['cache-control']).toBe('public, max-age=3600');
    expect(JSON.parse(result.body)).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'app.inecekvar.mobile',
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ]);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('serves the exact Apple association at the extensionless path without redirecting', async () => {
    const team = 'A1B2C3D4E5';
    const { port, apiFetch } = await fixture({ env: { IV_WEB_IOS_TEAM_ID: team } });
    const result = await httpRequest(port, { path: '/.well-known/apple-app-site-association' });
    expect(result.status).toBe(200);
    expect(result.headers.location).toBeUndefined();
    expect(result.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(result.headers['cache-control']).toBe('public, max-age=3600');
    expect(JSON.parse(result.body)).toEqual({
      applinks: {
        details: [
          {
            appIDs: [team + '.app.inecekvar.mobile'],
            components: [{ '/': '/*/hat/*' }, { '/': '/*/durak/*' }],
          },
        ],
      },
    });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('serves escaped SVG text, projects the geometry and reads each endpoint only once', async () => {
    const hostileName = '</text><script>&"';
    const { port, apiFetch, render } = await fixture({
      response: (url) =>
        url.pathname === '/v1/lines/ornek-hat'
          ? Response.json(lineData({ name: hostileName }))
          : publicResponse(url),
    });
    const path = '/og/ornek-sehir/hat/ornek-hat.svg';
    const first = await httpRequest(port, { path });
    const second = await httpRequest(port, { path });
    expect(first.status).toBe(200);
    expect(first.headers['content-type']).toBe('image/svg+xml; charset=utf-8');
    expect(first.headers['cache-control']).toBe('public, max-age=86400');
    expect(first.headers['x-content-type-options']).toBe('nosniff');
    expect(first.headers['content-security-policy']).toBeDefined();
    expect(first.body).toContain('&lt;/text&gt;&lt;script&gt;&amp;&quot;');
    expect(first.body).not.toContain(hostileName);
    expect(first.body).not.toContain('<script');
    expect(first.body).toContain('width="1200" height="630"');
    expect(first.body).toContain('stroke="#2AB7CA" stroke-width="7"');
    expect(first.body).toContain('Örnek Şehir · minibüs hattı');
    expect(second.body).toBe(first.body);
    expect(apiFetch.mock.calls.map(([input]) => String(input))).toEqual([
      'http://127.0.0.1:57800/v1/cities/ornek-sehir',
      'http://127.0.0.1:57800/v1/lines/ornek-hat?city=ornek-sehir',
    ]);
    expect(render).not.toHaveBeenCalled();
  });

  it('returns 404 when the line is missing', async () => {
    const { port } = await fixture({
      response: (url) =>
        url.pathname.startsWith('/v1/lines/')
          ? new Response(null, { status: 404 })
          : publicResponse(url),
    });
    const result = await httpRequest(port, { path: '/og/ornek-sehir/hat/ornek-hat.svg' });
    expect(result.status).toBe(404);
    expect(result.headers['cache-control']).toBe('no-store');
  });

  it.each([
    '/sitemap.xml',
    '/sitemaps/ornek-sehir.xml',
    '/og/ornek-sehir/hat/ornek-hat.svg',
    '/.well-known/assetlinks.json',
    '/.well-known/apple-app-site-association',
  ])('shares HEAD and GET headers and cached bodies: %s', async (path) => {
    const { port, apiFetch } = await fixture({
      env: {
        IV_WEB_ANDROID_CERT_SHA256: androidFingerprint('AB'),
        IV_WEB_IOS_TEAM_ID: 'A1B2C3D4E5',
      },
    });
    const head = await httpRequest(port, { path, method: 'HEAD' });
    const calls = apiFetch.mock.calls.length;
    const get = await httpRequest(port, { path });
    const hit = await httpRequest(port, { path, method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    expect(hit.body).toBe('');
    expect(get.body.length).toBeGreaterThan(0);
    for (const name of [
      'content-type',
      'cache-control',
      'content-length',
      'x-content-type-options',
    ]) {
      expect(head.headers[name]).toBe(get.headers[name]);
      expect(hit.headers[name]).toBe(get.headers[name]);
    }
    expect(apiFetch).toHaveBeenCalledTimes(calls);
  });

  it('expires cached bodies using the configured TTL', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const { port, apiFetch } = await fixture({ env: { IV_WEB_CACHE_TTL_SECONDS: '1' } });
    await httpRequest(port, { path: '/sitemap.xml' });
    now.mockReturnValue(1999);
    await httpRequest(port, { path: '/sitemap.xml' });
    expect(apiFetch).toHaveBeenCalledOnce();
    now.mockReturnValue(2000);
    await httpRequest(port, { path: '/sitemap.xml' });
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});
