import { homeJsonLd, homeSeo } from '../home/home';
import { cityData, lineData, pairData, stopData } from '../content/test-data';
import { LineListData, RouteData } from '../content/page-data';
import { JsonLdNode, serializeJsonLd } from '../seo/json-ld';
import { pagePath, PageSeo, pageTitle } from '../seo/seo';
import { cityHubJsonLd, cityHubSeo } from './city-hub.page';
import { lineJsonLd, lineSeo } from './line.page';
import { lineListJsonLd, lineListSeo } from './line-list.page';
import { routeJsonLd, routeSeo } from './route.page';
import { stopJsonLd, stopSeo } from './stop.page';

const origin = 'https://inecekvar.example';
const hostile = '</script><script>alert(1)</script>&\u2028';
const names = [hostile, 'İı şğ çö ü 🚌 '.repeat(100), '', 'Kadıköy–Bostancı'];
function routeData(name = 'Durak'): RouteData {
  const pair = pairData();
  return {
    city: cityData({ is_sample: false }),
    pair,
    canonical: true,
    from: { ...stopData(pair.from_stop.slug, name), lines: [lineData()] },
    to: { ...stopData(pair.to_stop.slug, name), lines: [lineData()] },
    lines: [lineData()],
  };
}
function checkSeo(seo: PageSeo): void {
  expect(Array.from(pageTitle(seo.title)).length).toBeLessThanOrEqual(60);
  expect(Array.from(seo.description).length).toBeLessThanOrEqual(155);
}
function checkNodes(nodes: JsonLdNode[], original: string, positions: number[]): void {
  const text = serializeJsonLd(nodes);
  expect(text).not.toContain('</script');
  expect(text).not.toContain('\u2028');
  const expected =
    nodes.length === 1
      ? { '@context': 'https://schema.org', ...nodes[0] }
      : { '@context': 'https://schema.org', '@graph': nodes };
  expect(JSON.parse(text)).toEqual(expected);
  const parsed = JSON.parse(text) as Record<string, unknown>;
  expect(parsed['@context']).toBe('https://schema.org');
  const restored = (nodes.length === 1 ? [parsed] : parsed['@graph']) as Record<string, unknown>[];
  for (const node of restored) expect(typeof node['@type']).toBe('string');
  const breadcrumb = restored.find((node) => node['@type'] === 'BreadcrumbList');
  const items = breadcrumb?.['itemListElement'] as { name: string; position: number }[];
  expect(items.map((item) => item.position)).toEqual(positions);
  expect(items.some((item) => item.name === original || item.name.includes(original))).toBe(true);
}

describe('home page builders', () => {
  it.each(names)('keeps bounded SEO and preserved JSON text for %s', (name) => {
    checkSeo(homeSeo());
    checkNodes(homeJsonLd(origin, name), name, [1]);
    expect(homeJsonLd(origin).map((node) => node['@type'])).toEqual([
      'Organization',
      'WebSite',
      'BreadcrumbList',
    ]);
  });
});
describe('city hub page builders', () => {
  it.each(names)('keeps bounded SEO and preserved JSON text for %s', (name) => {
    const data = { city: cityData({ name }) };
    checkSeo(cityHubSeo(data));
    checkNodes(cityHubJsonLd(origin, data), name, [1, 2]);
  });
  it('keeps empty and sample cities out of the index', () => {
    expect(
      cityHubSeo({ city: cityData({ is_sample: false, published_line_count: 0 }) }).index,
    ).toBe(false);
    expect(cityHubSeo({ city: cityData() }).index).toBe(false);
  });
});
describe('line list page builders', () => {
  it.each(names)('keeps bounded SEO and preserved JSON text for %s', (name) => {
    const data: LineListData = {
      city: cityData({ name }),
      lines: [lineData()],
      page: 2,
      hasNext: true,
    };
    checkSeo(lineListSeo(data));
    checkNodes(lineListJsonLd(origin, data), name, [1, 2, 3]);
    expect(lineListSeo(data).index).toBe(false);
  });
  it.each([
    [false, 12, true],
    [false, 0, false],
    [true, 12, false],
    [true, 0, false],
  ])(
    'indexes the line list only for a real city with lines (sample %s, %s lines)',
    (isSample, count, expected) => {
      const city = cityData({ is_sample: isSample, published_line_count: count });
      expect(lineListSeo({ city, lines: [], page: 1, hasNext: false }).index).toBe(expected);
    },
  );
  it.each([
    {
      page: 1,
      hasNext: true,
      canonical: '/ornek-sehir/hatlar',
      prev: null,
      next: '/ornek-sehir/hatlar?sayfa=2',
    },
    {
      page: 2,
      hasNext: true,
      canonical: '/ornek-sehir/hatlar?sayfa=2',
      prev: '/ornek-sehir/hatlar',
      next: '/ornek-sehir/hatlar?sayfa=3',
    },
    {
      page: 3,
      hasNext: false,
      canonical: '/ornek-sehir/hatlar?sayfa=3',
      prev: '/ornek-sehir/hatlar?sayfa=2',
      next: null,
    },
  ])('uses numbered pagination for page $page', ({ page, hasNext, canonical, prev, next }) => {
    const seo = lineListSeo({ city: cityData(), lines: [], page, hasNext });
    expect(pagePath(seo.path, seo.page)).toBe(canonical);
    expect(
      seo.pagination?.prevPage == null ? null : pagePath(seo.path, seo.pagination.prevPage),
    ).toBe(prev);
    expect(
      seo.pagination?.nextPage == null ? null : pagePath(seo.path, seo.pagination.nextPage),
    ).toBe(next);
  });
});
describe('line page builders', () => {
  it.each(names)('keeps bounded SEO and preserved JSON text for %s', (name) => {
    const data = {
      city: cityData({ name }),
      line: lineData({ name, stops: [stopData('ilk', name), stopData('son', name)] }),
    };
    checkSeo(lineSeo(data));
    checkNodes(lineJsonLd(origin, data), name, [1, 2, 3, 4]);
    expect(lineSeo(data).index).toBe(false);
    const trip = lineJsonLd(origin, data).find((node) => node['@type'] === 'BusTrip');
    for (const property of ['departureBusStop', 'arrivalBusStop']) {
      expect(trip?.[property]).toMatchObject({
        '@type': 'BusStop',
        name,
        geo: { '@type': 'GeoCoordinates', longitude: 29, latitude: 41 },
      });
    }
    expect(trip?.['provider']).toMatchObject({
      '@type': 'Organization',
      name: 'İnecek Var katkıcıları',
    });
  });
  it('omits a trip when fewer than two stops are known', () => {
    const nodes = lineJsonLd(origin, { city: cityData(), line: lineData({ stops: [stopData()] }) });
    expect(nodes.some((node) => node['@type'] === 'BusTrip')).toBe(false);
  });
});
describe('stop page builders', () => {
  it.each(names)('keeps bounded SEO and preserved JSON text for %s', (name) => {
    const data = {
      city: cityData({ name }),
      stop: { ...stopData('durak', name), lines: [lineData()] },
    };
    checkSeo(stopSeo(data));
    checkNodes(stopJsonLd(origin, data), name, [1, 2, 3]);
    expect(stopSeo(data).index).toBe(false);
    expect(stopJsonLd(origin, data).find((node) => node['@type'] === 'BusStop')).toMatchObject({
      name,
      geo: { '@type': 'GeoCoordinates', latitude: 41, longitude: 29 },
    });
  });
});
describe('route page builders', () => {
  it.each(names)('keeps bounded SEO and preserved JSON text for %s', (name) => {
    const data = routeData(name);
    checkSeo(routeSeo(data));
    checkNodes(routeJsonLd(origin, data), name, [1, 2, 3]);
  });
  it.each([
    { count: 49, sample: false, canonical: true, index: false },
    { count: 50, sample: false, canonical: true, index: true },
    { count: 50, sample: true, canonical: true, index: false },
    { count: 50, sample: false, canonical: false, index: false },
  ])(
    'indexes $count lines, sample $sample, canonical $canonical as $index',
    ({ count, sample, canonical, index }) => {
      const data = {
        ...routeData(),
        city: cityData({ published_line_count: count, is_sample: sample }),
        canonical,
      };
      expect(routeSeo(data).index).toBe(index);
      expect(routeSeo(data).path).toBe('/ornek-sehir/rota/ilk-uzun-durak-son-uzun-durak');
    },
  );
});
