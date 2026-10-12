import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  article,
  breadcrumbList,
  busStop,
  busTrip,
  dataset,
  faqPage,
  JsonLdNode,
  mobileApplication,
  organization,
  serializeJsonLd,
  webApplication,
  webSite,
} from './json-ld';
import { JsonLdService } from './json-ld.service';

const origin = 'https://canonical.example';
const payload = '</script><script>alert(1)</script>&\u2028\u2029';

afterEach(() => {
  for (const script of document.head.querySelectorAll('script[data-iv-jsonld]')) {
    script.remove();
  }
  TestBed.resetTestingModule();
});

describe('JSON-LD serialization', () => {
  it('escapes HTML delimiters and line separators without changing data', () => {
    const item = organization(origin, { name: payload, path: '/' });
    const text = serializeJsonLd([item]);
    expect(text).not.toMatch(/[<>&\u2028\u2029]/);
    expect(text).toContain('\\u2028\\u2029');
    expect(JSON.parse(text)).toEqual({ '@context': 'https://schema.org', ...item });
  });

  it('uses a graph for several nodes and permits shared nested nodes', () => {
    const provider = organization(origin);
    const stop = busStop(origin, { name: 'Durak', path: '/durak/a' });
    const trip = busTrip(origin, {
      name: 'Hat',
      path: '/hat/a',
      departureBusStop: stop,
      arrivalBusStop: stop,
      provider,
    });
    expect(JSON.parse(serializeJsonLd([provider, trip]))).toEqual({
      '@context': 'https://schema.org',
      '@graph': [provider, trip],
    });
  });

  it.each([NaN, Infinity, -Infinity, () => 1, Symbol('invalid'), BigInt(1)])(
    'rejects values JSON cannot preserve',
    (value) => {
      const invalid = { ...organization(origin), value };
      expect(() => serializeJsonLd([invalid])).toThrow('Invalid JSON value');
    },
  );

  it('rejects cycles', () => {
    const cyclic: JsonLdNode & { self?: unknown } = { ...organization(origin) };
    cyclic.self = cyclic;
    expect(() => serializeJsonLd([cyclic])).toThrow('Cyclic JSON value');
  });

  it('builds canonical URLs for the supported page schemas', () => {
    const author = organization(origin);
    const nodes = [
      webSite(origin, {
        name: 'Site',
        path: '/',
        searchTargetTemplate: '/arama?q={search_term_string}',
      }),
      breadcrumbList(origin, [{ name: 'Ana sayfa', path: '/' }]),
      dataset(origin, {
        name: 'Veri',
        path: '/veri',
        licensePath: '/veri-lisansi',
        dateModified: '2026-10-12',
      }),
      faqPage(origin, { path: '/sss', items: [{ question: 'Nerede?', answer: 'Durakta.' }] }),
      article(origin, {
        headline: 'Rehber',
        path: '/rehber/a',
        datePublished: '2026-10-01',
        dateModified: '2026-10-12T10:00:00Z',
        author,
      }),
      mobileApplication(origin, { name: 'Uygulama', path: '/', operatingSystem: 'iOS, Android' }),
      webApplication(origin, { name: 'Web', path: '/', operatingSystem: 'Web' }),
    ];
    const parsed = JSON.parse(serializeJsonLd(nodes));
    expect(parsed['@graph'].map((item: Record<string, unknown>) => item['@type'])).toEqual([
      'WebSite',
      'BreadcrumbList',
      'Dataset',
      'FAQPage',
      'Article',
      'MobileApplication',
      'WebApplication',
    ]);
    expect(parsed['@graph'][0].potentialAction.target.urlTemplate).toBe(
      origin + '/arama?q={search_term_string}',
    );
    expect(parsed['@graph'][1].itemListElement[0].item).toBe(origin + '/');
    expect(parsed['@graph'][2].license).toBe(origin + '/veri-lisansi');
  });

  it('rejects external paths, malformed dates, search templates and invalid coordinates', () => {
    expect(() => organization(origin, { name: 'Site', path: '//evil.example' })).toThrow();
    expect(() =>
      dataset(origin, {
        name: 'Veri',
        path: '/veri',
        licensePath: '/veri-lisansi',
        dateModified: 'yesterday',
      }),
    ).toThrow('Invalid ISO date');
    expect(() =>
      webSite(origin, {
        name: 'Site',
        path: '/',
        searchTargetTemplate: 'https://evil.example?q={search_term_string}',
      }),
    ).toThrow();
    expect(() =>
      busStop(origin, {
        name: 'Durak',
        path: '/durak/a',
        latitude: NaN,
        longitude: 29,
      }),
    ).toThrow();
  });
});

describe('JSON-LD service', () => {
  function setup(platform: 'server' | 'browser' = 'browser') {
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platform }] });
    return TestBed.inject(JsonLdService);
  }

  it.each(['server', 'browser'] as const)('replaces one data block per id on %s', (platform) => {
    const service = setup(platform);
    const nodes = [organization(origin, { name: payload, path: '/' })];
    service.set('page', [organization(origin)]);
    service.set('page', nodes);
    const scripts = document.head.querySelectorAll('script[data-iv-jsonld="page"]');
    expect(scripts).toHaveLength(1);
    const script = scripts.item(0);
    expect(script.getAttribute('type')?.split('/')).toEqual(['application', 'ld+json']);
    expect(script.hasAttribute('nonce')).toBe(false);
    expect(script.textContent).toBe(serializeJsonLd(nodes));
    expect(script.textContent).not.toContain('</script>');
    expect(JSON.parse(script.textContent ?? '')).toEqual({
      '@context': 'https://schema.org',
      ...nodes[0],
    });
  });

  it('clears one id or all owned blocks', () => {
    const service = setup();
    service.set('page', [organization(origin)]);
    service.set('site', [webSite(origin)]);
    service.clear('page');
    expect(document.head.querySelectorAll('script[data-iv-jsonld]')).toHaveLength(1);
    service.clearAll();
    expect(document.head.querySelectorAll('script[data-iv-jsonld]')).toHaveLength(0);
  });

  it.each(['', 'UPPER', 'a'.repeat(33), 'a"b'])('rejects an invalid id', (id) => {
    const service = setup();
    expect(() => service.set(id, [organization(origin)])).toThrow('Invalid JSON-LD id');
    expect(() => service.clear(id)).toThrow('Invalid JSON-LD id');
  });
});
