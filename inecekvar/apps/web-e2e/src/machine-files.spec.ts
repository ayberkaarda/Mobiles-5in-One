import { expect, test } from '@playwright/test';
import { parseXml, PRODUCTION, PUBLIC_HOST, TEST_CERT_SHA256, TEST_ORIGIN } from './support';

test('sitemap index is well-formed and lists only public cities with honest lastmod', async ({
  page,
  request,
}) => {
  const response = await request.get('/sitemap.xml');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('application/xml; charset=utf-8');
  const xml = await response.text();
  const locs = await parseXml(page, xml);
  expect(locs).toEqual([
    TEST_ORIGIN + '/sitemap-pages.xml',
    TEST_ORIGIN + '/sitemaps/istanbul.xml',
    TEST_ORIGIN + '/sitemaps/izmir.xml',
  ]);
  expect(xml).toContain('<lastmod>2026-10-01T09:30:00Z</lastmod>');
  expect(xml).toContain('<lastmod>2026-09-20T07:00:00Z</lastmod>');
  expect(xml).not.toContain('ornek-test-sehri');
});

test('city sitemap lists hub, list, line and stop pages with published dates', async ({
  page,
  request,
}) => {
  const response = await request.get('/sitemaps/istanbul.xml');
  expect(response.status()).toBe(200);
  const xml = await response.text();
  const locs = await parseXml(page, xml);
  for (const path of [
    '/istanbul',
    '/istanbul/hatlar',
    '/istanbul/hat/kadikoy-bostanci',
    '/istanbul/hat/hat-54',
    '/istanbul/durak/moda',
  ]) {
    expect(locs).toContain(TEST_ORIGIN + path);
  }
  expect(locs.some((loc) => loc.includes('/rota/'))).toBe(false);
  expect(xml).toMatch(
    /<loc>[^<]*\/istanbul\/hat\/kadikoy-bostanci<\/loc>\s*<lastmod>2026-10-01T09:30:00Z<\/lastmod>/,
  );
  expect(xml).toMatch(
    /<loc>[^<]*\/istanbul\/hat\/kotu-isim<\/loc>\s*<lastmod>2026-09-28T06:00:00Z<\/lastmod>/,
  );

  for (const missing of ['/sitemaps/ornek-test-sehri.xml', '/sitemaps/yok.xml']) {
    expect((await request.get(missing)).status()).toBe(404);
  }
});

test('app association files are absent until configured', async ({ request }) => {
  for (const path of ['/.well-known/assetlinks.json', '/.well-known/apple-app-site-association']) {
    const response = await request.get(path);
    expect(response.status()).toBe(404);
    expect(response.headers()['cache-control']).toBe('no-store');
  }
});

test('configured app association files have the expected shape', async ({ request }) => {
  const assetlinks = await request.get(PRODUCTION + '/.well-known/assetlinks.json', {
    headers: PUBLIC_HOST,
  });
  expect(assetlinks.status()).toBe(200);
  expect(assetlinks.headers()['content-type']).toMatch(/^application\/json/);
  expect(await assetlinks.json()).toEqual([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'app.inecekvar.mobile',
        sha256_cert_fingerprints: [TEST_CERT_SHA256],
      },
    },
  ]);

  const aasa = await request.get(PRODUCTION + '/.well-known/apple-app-site-association', {
    headers: PUBLIC_HOST,
    maxRedirects: 0,
  });
  expect(aasa.status()).toBe(200);
  expect(aasa.headers()['content-type']).toMatch(/^application\/json/);
  expect(await aasa.json()).toEqual({
    applinks: {
      details: [
        {
          appIDs: ['TESTTEAM01.app.inecekvar.mobile'],
          components: [{ '/': '/*/hat/*' }, { '/': '/*/durak/*' }],
        },
      ],
    },
  });
});

test('production robots names the sitemap and keeps admin out', async ({ request }) => {
  const robots = await request.get(PRODUCTION + '/robots.txt', { headers: PUBLIC_HOST });
  const text = await robots.text();
  expect(text).toContain('Disallow: /admin\n');
  expect(text).toContain('Sitemap: https://inecekvar.app/sitemap.xml\n');
});

test('line OG images are server-side SVG with escaped text', async ({ request }) => {
  const image = await request.get('/og/istanbul/hat/kadikoy-bostanci.svg');
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toBe('image/svg+xml; charset=utf-8');
  const svg = await image.text();
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  expect(svg).toContain('Kadıköy–Bostancı');

  const hostile = await (await request.get('/og/istanbul/hat/kotu-isim.svg')).text();
  expect(hostile).not.toMatch(/<script/i);
  expect(hostile).toContain('&lt;/script&gt;');
  expect((await request.get('/og/istanbul/hat/yok.svg')).status()).toBe(404);
});
