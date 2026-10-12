import { citySitemapEntries, sitemapIndexEntries, sitemapIndexXml, urlSetXml } from './sitemap-xml';
import { sitemapData, sitemapIndexData, timestamp } from './test-data';

describe('sitemap XML', () => {
  const origin = 'https://inecekvar.example';

  it('writes the declaration, namespace and XML-safe absolute locations', () => {
    const escapedOrigin = 'https://a&b.example';
    const xml = urlSetXml(escapedOrigin, [{ path: '/istanbul/hat/ornek-hat' }]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(xml).toContain('<loc>https://a&amp;b.example/istanbul/hat/ornek-hat</loc>');
    const parsed = new DOMParser().parseFromString(xml, 'application/xml');
    expect(parsed.querySelector('parsererror')).toBeNull();
    expect(parsed.querySelector('loc')?.textContent).toBe(
      escapedOrigin + '/istanbul/hat/ornek-hat',
    );
  });

  it('keeps the API publish instant, normalized to UTC without milliseconds', () => {
    const xml = urlSetXml(origin, [
      { path: '/istanbul/hat/ornek-hat', lastmod: '2026-10-01T12:30:00.123+03:00' },
    ]);
    expect(xml).toContain('<lastmod>2026-10-01T09:30:00Z</lastmod>');
    expect(xml).not.toContain('.123');
    const index = sitemapIndexXml(origin, [{ path: '/sitemaps/istanbul.xml', lastmod: timestamp }]);
    expect(index).toContain('<sitemapindex ');
    expect(index).toContain(
      '<sitemap><loc>' +
        origin +
        '/sitemaps/istanbul.xml</loc><lastmod>2026-10-12T09:30:00Z</lastmod></sitemap>',
    );
    expect(
      new DOMParser().parseFromString(index, 'application/xml').querySelector('parsererror'),
    ).toBeNull();
  });

  it.each([undefined, '', 'invalid', '2026-10-12', '2026-10-12T09:30:00'])(
    'omits missing or invalid lastmod %s',
    (lastmod) => {
      expect(urlSetXml(origin, [{ path: '/istanbul', lastmod }])).not.toContain('<lastmod>');
    },
  );

  it('uses sitemap dates for hubs, lines and stops without adding route pages', () => {
    const sitemap = sitemapData();
    const entries = citySitemapEntries(sitemap, {
      lastmod: '2026-01-01T00:00:00Z',
      isSample: false,
    });
    expect(entries).toEqual([
      { path: '/ornek-sehir', lastmod: timestamp },
      { path: '/ornek-sehir/hatlar', lastmod: timestamp },
      { path: '/ornek-sehir/hat/ornek-hat', lastmod: '2026-10-01T12:30:00+03:00' },
      { path: '/ornek-sehir/durak/ilk-durak', lastmod: '2026-10-02T13:00:00+03:00' },
    ]);
    const xml = urlSetXml(origin, entries);
    expect(xml).toContain('<lastmod>2026-10-01T09:30:00Z</lastmod>');
    expect(xml).toContain('<lastmod>2026-10-02T10:00:00Z</lastmod>');
    expect(xml).not.toContain('/rota/');
    expect(citySitemapEntries(sitemap, { lastmod: null, isSample: false })).toEqual(entries);
  });

  it('excludes sample cities from both the index and city URLs', () => {
    expect(sitemapIndexEntries(sitemapIndexData())).toEqual([
      { path: '/sitemaps/istanbul.xml', lastmod: timestamp },
    ]);
    expect(citySitemapEntries(sitemapData(), { lastmod: null, isSample: true })).toEqual([]);
  });

  it.each([
    '//evil.example',
    'https://evil.example',
    '/a/../b',
    '/a?b=1',
    '/a&b',
    '/a<b',
    '/a"b',
    "/a'b",
  ])('rejects an invalid public path %s', (path) => {
    expect(() => urlSetXml(origin, [{ path }])).toThrow();
    expect(() => sitemapIndexXml(origin, [{ path, lastmod: timestamp }])).toThrow();
  });

  it.each([
    'ftp://example.test',
    'https://example.test/',
    'https://example.test/path',
    'https://user:pass@example.test',
    'invalid',
  ])('rejects an origin that is not a bare http or https origin %s', (value) => {
    expect(() => urlSetXml(value, [])).toThrow();
    expect(() => sitemapIndexXml(value, [])).toThrow();
  });

  it('accepts http and rejects more than 50000 URLs without dropping entries', () => {
    expect(urlSetXml('http://example.test', [{ path: '/' }])).toContain(
      '<loc>http://example.test/</loc>',
    );
    const entries = Array.from({ length: 50000 }, () => ({ path: '/a', lastmod: timestamp }));
    expect(urlSetXml(origin, entries).match(/<url>/g)).toHaveLength(50000);
    expect(() => urlSetXml(origin, [...entries, { path: '/b' }])).toThrow();
    expect(() =>
      sitemapIndexXml(origin, [...entries, { path: '/b', lastmod: timestamp }]),
    ).toThrow();
    expect(() =>
      citySitemapEntries(
        {
          ...sitemapData(),
          stops: [],
          lines: Array.from({ length: 49999 }, () => ({ slug: 'a', lastmod: timestamp })),
        },
        { lastmod: null, isSample: false },
      ),
    ).toThrow();
  });
});
