import {
  isCityDetail,
  isCityList,
  isCitySitemap,
  isLine,
  isLineList,
  isLocation,
  isSitemapIndex,
  isSlug,
  isStopDetail,
  isStopPairs,
  isTimestamp,
  modeLabel,
  paymentLabel,
} from './public-types';
import {
  cityData,
  lineData,
  pairData,
  sitemapData,
  sitemapIndexData,
  stopData,
  timestamp,
} from './test-data';

describe('public data guards', () => {
  it('accepts the API shapes and ignores extra fields', () => {
    expect(isCityList([cityData()])).toBe(true);
    expect(isCityDetail({ ...cityData(), extra: { nested: true } })).toBe(true);
    expect(isLineList([lineData()])).toBe(true);
    expect(isLine({ ...lineData(), extra: true })).toBe(true);
    expect(isStopDetail({ ...stopData(), lines: [lineData()] })).toBe(true);
    expect(
      isStopPairs({ city: 'ornek-sehir', basis: 'shared_published_lines', pairs: [pairData()] }),
    ).toBe(true);
    expect(isSitemapIndex(sitemapIndexData())).toBe(true);
    expect(isCitySitemap(sitemapData())).toBe(true);
  });

  it.each([null, undefined, 1, 'text', true, {}])('rejects non-responses %s', (value) => {
    for (const guard of [
      isCityList,
      isCityDetail,
      isLineList,
      isLine,
      isStopDetail,
      isStopPairs,
      isSitemapIndex,
      isCitySitemap,
    ]) {
      expect(guard(value)).toBe(false);
    }
  });

  it.each(['a', 'a-1-b', 'a'.repeat(120)])('accepts a bounded slug %s', (value) => {
    expect(isSlug(value)).toBe(true);
  });

  it.each(['', 'A', 'ş', '-a', 'a-', 'a--b', 'a/b', 'a%20b', 'a'.repeat(121), null, 1])(
    'rejects an invalid slug %s',
    (value) => expect(isSlug(value)).toBe(false),
  );

  it.each([timestamp, '2026-10-12T12:30:00+03:00', '2026-10-12T04:30:00-05:00'])(
    'accepts a timestamp with a zone %s',
    (value) => expect(isTimestamp(value)).toBe(true),
  );

  it.each(['2026-10-12', '2026-10-12T12:30:00', 'wrongZ', '2026-10-12T12:30:00+25:00', '', null])(
    'rejects a missing or invalid zone %s',
    (value) => expect(isTimestamp(value)).toBe(false),
  );

  it.each([
    ['name', 'a'.repeat(201)],
    ['code', 'a'.repeat(41)],
    ['mode', 'a'.repeat(41)],
    ['slug', 'Bad'],
    ['id', 'not-a-uuid'],
    ['status', 'a'.repeat(41)],
    ['version_no', -1],
    ['version_no', 1.5],
    ['published_at', '2026-10-12'],
    ['fare_minor', -1],
    ['fare_minor', 1.5],
    ['fare_minor', 10000001],
    ['fare_updated_at', 'invalid'],
    ['last_verified_at', '2026-10-12T10:00:00'],
    ['hours_text', 'a'.repeat(2001)],
    ['hail_notes', 'a'.repeat(2001)],
    ['contributor_count', -1],
    ['contributor_count', Infinity],
    ['contributor_count', 1.5],
    ['payment_methods', Array.from({ length: 11 }, () => 'nakit')],
    ['payment_methods', [1]],
    ['payment_methods', ['a'.repeat(41)]],
    ['stops', [{ ...stopData(), location: [180.01, 0] }]],
  ])('rejects an invalid line field %s', (key, value) => {
    expect(isLine({ ...lineData(), [key as string]: value })).toBe(false);
  });

  it('requires every line field, including nullable fields', () => {
    for (const key of Object.keys(lineData())) {
      const value: Record<string, unknown> = { ...lineData() };
      delete value[key];
      expect(isLine(value)).toBe(false);
    }
    expect(
      isLine(
        lineData({
          fare_minor: null,
          fare_updated_at: null,
          hours_text: null,
          last_verified_at: null,
        }),
      ),
    ).toBe(true);
  });

  it.each(
    [[NaN, 0], [Infinity, 0], [-181, 0], [0, 91], [0], [0, 0, 0]].map((location) => ({ location })),
  )('rejects invalid coordinates $location', ({ location }) => {
    expect(isLocation(location)).toBe(false);
    expect(
      isLine({ ...lineData(), geometry: { type: 'LineString', coordinates: [location] } }),
    ).toBe(false);
    expect(isStopDetail({ ...stopData(), location, lines: [] })).toBe(false);
  });

  it('accepts coordinate edges and rejects the wrong geometry kind', () => {
    expect(isLocation([-180, -90])).toBe(true);
    expect(isLocation([180, 90])).toBe(true);
    expect(isLine({ ...lineData(), geometry: { type: 'Polygon', coordinates: [[0, 0]] } })).toBe(
      false,
    );
  });

  it('enforces list, stop, geometry and sitemap bounds including sparse arrays', () => {
    const cities = Array.from({ length: 500 }, () => cityData());
    const lines = Array.from({ length: 500 }, () => lineData());
    const stops = Array.from({ length: 2000 }, () => stopData());
    const coordinates = Array.from({ length: 20000 }, (): [number, number] => [29, 41]);
    const entries = Array.from({ length: 50000 }, () => ({ slug: 'a', lastmod: timestamp }));
    expect(isCityList(cities)).toBe(true);
    expect(isCityList([...cities, cityData()])).toBe(false);
    expect(isLineList(lines)).toBe(true);
    expect(isLineList([...lines, lineData()])).toBe(false);
    expect(isLine(lineData({ stops, geometry: { type: 'LineString', coordinates } }))).toBe(true);
    expect(isLine(lineData({ stops: [...stops, stopData()] }))).toBe(false);
    expect(
      isLine(
        lineData({ geometry: { type: 'LineString', coordinates: [...coordinates, [29, 41]] } }),
      ),
    ).toBe(false);
    expect(isCitySitemap({ ...sitemapData(), lines: entries, stops: entries })).toBe(true);
    expect(isCitySitemap({ ...sitemapData(), lines: [...entries, entries[0]] })).toBe(false);
    expect(isLineList(new Array(1))).toBe(false);
    expect(isLine({ ...lineData(), payment_methods: new Array(1) })).toBe(false);
  });

  it('checks city details and nested pair and sitemap fields', () => {
    expect(isCityDetail(cityData({ lastmod: null }))).toBe(true);
    expect(isCityDetail({ ...cityData(), published_line_count: -1 })).toBe(false);
    expect(isCityDetail({ ...cityData(), centroid: [NaN, 41] })).toBe(false);
    expect(isCityDetail({ ...cityData(), bbox: [30, 42, 28, 40] })).toBe(false);
    expect(
      isCityDetail({
        ...cityData(),
        recently_updated_lines: [{ ...lineData(), updated_at: 'bad' }],
      }),
    ).toBe(false);
    expect(isCityDetail({ ...cityData(), popular_lines: [{ ...lineData(), slug: 'Bad' }] })).toBe(
      false,
    );
    expect(isStopPairs({ city: 'a', basis: 'other', pairs: [] })).toBe(false);
    expect(
      isStopPairs({
        city: 'a',
        basis: 'shared_published_lines',
        pairs: [{ ...pairData(), shared_line_count: -1 }],
      }),
    ).toBe(false);
    expect(isSitemapIndex({ cities: [{ ...sitemapIndexData().cities[0], lastmod: 'bad' }] })).toBe(
      false,
    );
    expect(isCitySitemap({ ...sitemapData(), stops: [{ slug: 'Bad', lastmod: timestamp }] })).toBe(
      false,
    );
  });

  it('maps only known modes and payments to display labels', () => {
    expect(['dolmus', 'minibus', 'servis', '<script>'].map(modeLabel)).toEqual([
      'dolmuş',
      'minibüs',
      'servis',
      'hat',
    ]);
    expect(['nakit', 'kart', 'istanbulkart', '<script>'].map(paymentLabel)).toEqual([
      'nakit',
      'kart',
      'İstanbulkart',
      null,
    ]);
  });
});
