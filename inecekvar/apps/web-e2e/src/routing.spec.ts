import { expect, test } from '@playwright/test';
import { directives, LINE_PATH, PRODUCTION, PUBLIC_HOST, ROUTE_PATH, STOP_PATH } from './support';

function robotsMeta(html: string): string | undefined {
  return html.match(/<meta name="robots" content="([^"]*)"/)?.[1];
}

function linkHref(html: string, rel: string): string | undefined {
  return html.match(new RegExp(`<link rel="${rel}" href="([^"]*)"`))?.[1];
}

test('unknown cities, lines, stops, route pairs and bad slugs answer 404', async ({ request }) => {
  for (const path of [
    '/yok-sehir',
    '/istanbul/hat/yok',
    '/istanbul/durak/yok',
    '/istanbul/rota/moda-yok',
    '/istanbul/rota/moda-suadiye',
    '/istanbul/hat/Bad_Slug!',
    '/yok-sehir/hatlar',
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(404);
    expect(robotsMeta(await response.text()), path).toMatch(/\bnoindex\b/);
  }
});

test('trailing slashes, upper case and the first page redirect permanently', async ({
  request,
}) => {
  for (const path of [
    LINE_PATH + '/',
    '/Istanbul/Hat/Kadikoy-Bostanci',
    '/ISTANBUL/hat/kadikoy-bostanci//',
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(301);
    expect(response.headers()['location'], path).toBe(LINE_PATH);
  }
  const first = await request.get('/istanbul/hatlar?sayfa=1', { maxRedirects: 0 });
  expect(first.status()).toBe(301);
  expect(first.headers()['location']).toBe('/istanbul/hatlar');
  for (const path of [
    '/istanbul/hatlar?sayfa=99',
    '/istanbul/hatlar?sayfa=abc',
    '/istanbul/hatlar?sayfa=0',
  ]) {
    expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
  }
});

test('line list pages carry canonical and prev/next links', async ({ request }) => {
  const first = await (await request.get('/istanbul/hatlar')).text();
  expect(linkHref(first, 'canonical')).toBe('http://127.0.0.1:57992/istanbul/hatlar');
  expect(linkHref(first, 'next')).toBe('http://127.0.0.1:57992/istanbul/hatlar?sayfa=2');
  expect(linkHref(first, 'prev')).toBeUndefined();

  const second = await request.get('/istanbul/hatlar?sayfa=2');
  expect(second.status()).toBe(200);
  const html = await second.text();
  expect(linkHref(html, 'canonical')).toBe('http://127.0.0.1:57992/istanbul/hatlar?sayfa=2');
  expect(linkHref(html, 'prev')).toBe('http://127.0.0.1:57992/istanbul/hatlar');
  expect(linkHref(html, 'next')).toBeUndefined();
  expect((html.match(/href="\/istanbul\/hat\//g) ?? []).length).toBe(6);
});

test('route pages are noindex below 50 published lines and canonical in API order', async ({
  request,
}) => {
  const small = await request.get('/izmir/rota/konak-bornova');
  expect(small.status()).toBe(200);
  expect(robotsMeta(await small.text())).toMatch(/^noindex,follow/);

  const large = await request.get(ROUTE_PATH);
  expect(large.status()).toBe(200);
  const html = await large.text();
  expect(robotsMeta(html)).toMatch(/^index,follow/);
  expect(html).toContain('href="/istanbul/hat/kadikoy-bostanci"');

  const reversed = await request.get('/istanbul/rota/bostanci-iskele-kadikoy-rihtim');
  expect(reversed.status()).toBe(200);
  const reversedHtml = await reversed.text();
  expect(robotsMeta(reversedHtml)).toMatch(/\bnoindex\b/);
  expect(linkHref(reversedHtml, 'canonical')).toBe('http://127.0.0.1:57992' + ROUTE_PATH);

  const sample = await request.get('/ornek-test-sehri/rota/ornek-durak-1-1-ornek-durak-1-2');
  expect(sample.status()).toBe(200);
  expect(robotsMeta(await sample.text())).toMatch(/\bnoindex\b/);
});

test('content and machine routes carry the security headers in production', async ({ request }) => {
  for (const path of [
    '/istanbul',
    '/istanbul/hatlar',
    LINE_PATH,
    STOP_PATH,
    ROUTE_PATH,
    '/sitemap.xml',
    '/sitemaps/istanbul.xml',
    '/.well-known/assetlinks.json',
    '/og/istanbul/hat/kadikoy-bostanci.svg',
  ]) {
    const response = await request.get(PRODUCTION + path, { headers: PUBLIC_HOST });
    expect(response.status(), path).toBe(200);
    const headers = response.headers();
    const csp = directives(headers['content-security-policy'] ?? '');
    expect(csp.get('default-src'), path).toEqual(["'self'"]);
    expect(csp.get('object-src'), path).toEqual(["'none'"]);
    expect(csp.get('frame-ancestors'), path).toEqual(["'none'"]);
    expect(
      csp.get('script-src')?.some((value) => value.startsWith("'nonce-")),
      path,
    ).toBe(true);
    expect(headers['strict-transport-security'], path).toBe(
      'max-age=63072000; includeSubDomains; preload',
    );
    expect(headers['x-frame-options'], path).toBe('DENY');
    expect(headers['x-content-type-options'], path).toBe('nosniff');
    expect(headers['referrer-policy'], path).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy'], path).toBe(
      'geolocation=(self), camera=(), microphone=()',
    );
    expect(headers['x-powered-by'], path).toBeUndefined();
  }
});
