import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DEFAULT_PUBLIC_WEB_CONFIG, PUBLIC_WEB_CONFIG } from '../public-config';
import { BRAND, clampText, DESCRIPTION_MAX, pagePath, pageTitle, TITLE_MAX } from './seo';
import { SeoService } from './seo.service';

const origin = 'https://canonical.example';
let service: SeoService | undefined;
const initialTitle = document.title;

function setup(appStoreId: string | null = null) {
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: 'browser' },
      {
        provide: PUBLIC_WEB_CONFIG,
        useValue: { ...DEFAULT_PUBLIC_WEB_CONFIG, canonicalOrigin: origin, appStoreId },
      },
    ],
  });
  service = TestBed.inject(SeoService);
  return service;
}

function content(name: string, attribute = 'name') {
  return document.head.querySelector(`meta[${attribute}="${name}"]`)?.getAttribute('content');
}

afterEach(() => {
  service?.reset();
  service = undefined;
  document.title = initialTitle;
  TestBed.resetTestingModule();
});

describe('SEO text', () => {
  it('clamps Turkish text and emoji by code points', () => {
    const subject = 'İş ğü 🚌 '.repeat(30);
    expect(Array.from(pageTitle(subject)).length).toBeLessThanOrEqual(TITLE_MAX);
    const text = clampText(subject, DESCRIPTION_MAX);
    expect(Array.from(text).length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(text.endsWith('…')).toBe(true);
    expect(text).not.toMatch(/[\ud800-\udbff]$/);
    expect(pageTitle(null)).toBe(BRAND);
  });

  it('preserves exact limits', () => {
    const suffix = ' | ' + BRAND;
    const subject = 'ş'.repeat(TITLE_MAX - Array.from(suffix).length);
    expect(pageTitle(subject)).toBe(subject + suffix);
    const description = 'ü'.repeat(DESCRIPTION_MAX);
    expect(clampText(description, DESCRIPTION_MAX)).toBe(description);
  });

  it('removes control characters and collapses whitespace', () => {
    expect(clampText('  İ\u0000ş\u0085 \u2028ğ\u2029ü   🚌  ', 40)).toBe('İş ğ ü 🚌');
    expect(clampText('Kadıköy\nBostancı', 40)).toBe('Kadıköy Bostancı');
    expect(clampText('abcdefgh ijklmnop', 12)).toBe('abcdefgh…');
    expect(clampText('ab cdefghijklmnop', 12)).toBe('ab cdefghij…');
  });
});

describe('SEO service', () => {
  it.each([
    { page: 1, prevPage: null, nextPage: 2 },
    { page: 2, prevPage: 1, nextPage: 3 },
    { page: 3, prevPage: 2, nextPage: null },
  ])('writes canonical and pagination links for page $page', ({ page, prevPage, nextPage }) => {
    const seo = setup();
    seo.apply({
      title: 'Hatlar',
      description: 'Hat listesi',
      path: '/istanbul/hatlar',
      page,
      pagination: { prevPage, nextPage },
      alternates: { en: '/en/istanbul/hatlar' },
    });
    const canonical = origin + pagePath('/istanbul/hatlar', page);
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      canonical,
    );
    expect(content('og:url', 'property')).toBe(canonical);
    for (const language of ['tr-TR', 'x-default']) {
      expect(
        document.head.querySelector(`link[hreflang="${language}"]`)?.getAttribute('href'),
      ).toBe(canonical);
    }
    expect(document.head.querySelector('link[hreflang="en"]')?.getAttribute('href')).toBe(
      origin + pagePath('/en/istanbul/hatlar', page),
    );
    for (const [rel, number] of [
      ['prev', prevPage],
      ['next', nextPage],
    ] as const) {
      expect(document.head.querySelector(`link[rel="${rel}"]`)?.getAttribute('href') ?? null).toBe(
        number === null ? null : origin + pagePath('/istanbul/hatlar', number),
      );
    }
    seo.apply({ title: null, description: 'Ana sayfa', path: '/' });
    expect(document.head.querySelector('link[rel="prev"]')).toBeNull();
    expect(document.head.querySelector('link[rel="next"]')).toBeNull();
  });

  it.each([0, -1, 1.5, 10000, NaN, Infinity])(
    'rejects invalid page number %s before changing metadata',
    (page) => {
      const seo = setup();
      seo.apply({ title: null, description: 'Ana sayfa', path: '/' });
      expect(() => seo.apply({ title: null, description: '', path: '/', page })).toThrow(
        'Invalid page number',
      );
      for (const pagination of [
        { prevPage: page, nextPage: null },
        { prevPage: null, nextPage: page },
      ]) {
        expect(() => seo.apply({ title: null, description: '', path: '/', pagination })).toThrow(
          'Invalid page number',
        );
      }
      expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
        origin + '/',
      );
    },
  );

  it('replaces canonical, alternate, OG and Twitter tags without duplicates', () => {
    const seo = setup('123456');
    seo.apply({
      title: 'İstanbul',
      description: 'İş ğü 🚌 '.repeat(40),
      path: '/istanbul',
      alternates: { en: '/en/istanbul' },
      ogImagePath: '/images/istanbul.png',
      appBanner: true,
    });
    expect(Array.from(document.title).length).toBeLessThanOrEqual(TITLE_MAX);
    expect(Array.from(content('description') ?? '').length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      origin + '/istanbul',
    );
    expect(content('og:url', 'property')).toBe(origin + '/istanbul');
    expect(content('og:locale', 'property')).toBe('tr_TR');
    expect(content('og:site_name', 'property')).toBe(BRAND);
    expect(content('og:image', 'property')).toBe(origin + '/images/istanbul.png');
    expect(content('twitter:card')).toBe('summary_large_image');
    expect(content('apple-itunes-app')).toBe('app-id=123456, app-argument=' + origin + '/istanbul');
    expect(document.head.querySelector('link[hreflang="en"]')?.getAttribute('href')).toBe(
      origin + '/en/istanbul',
    );
    seo.apply({ title: 'İzmir', description: 'Yeni açıklama', path: '/izmir', ogType: 'article' });
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(document.head.querySelectorAll('link[rel="alternate"]')).toHaveLength(2);
    for (const language of ['tr-TR', 'x-default']) {
      const alternate = document.head.querySelector(`link[hreflang="${language}"]`);
      expect(alternate?.getAttribute('href')).toBe(origin + '/izmir');
    }
    const properties = [
      'og:title',
      'og:description',
      'og:url',
      'og:type',
      'og:site_name',
      'og:locale',
    ];
    for (const name of properties) {
      expect(document.head.querySelectorAll(`meta[property="${name}"]`)).toHaveLength(1);
    }
    const names = ['description', 'robots', 'twitter:card', 'twitter:title', 'twitter:description'];
    for (const name of names) {
      expect(document.head.querySelectorAll(`meta[name="${name}"]`)).toHaveLength(1);
    }
    expect(content('og:title', 'property')).toBe(pageTitle('İzmir'));
    expect(content('og:type', 'property')).toBe('article');
    expect(content('twitter:title')).toBe(pageTitle('İzmir'));
    expect(content('twitter:description')).toBe('Yeni açıklama');
    expect(content('twitter:card')).toBe('summary');
    expect(content('og:image', 'property')).toBeUndefined();
    expect(content('apple-itunes-app')).toBeUndefined();
    expect(document.head.querySelector('link[hreflang="en"]')).toBeNull();
    expect(content('og:url', 'property')).not.toBe(document.location.origin + '/izmir');
  });

  it.each([
    [true, true, 'index,follow,max-image-preview:large'],
    [true, false, 'index,nofollow,max-image-preview:large'],
    [false, true, 'noindex,follow'],
    [false, false, 'noindex,nofollow'],
  ] as const)('supports index %s and follow %s', (index, follow, expected) => {
    setup().apply({ title: null, description: 'Sayfa', path: '/', index, follow });
    expect(content('robots')).toBe(expected);
  });

  it('omits the app banner without an app store id and resets its owned tags', () => {
    const seo = setup();
    const before = document.title;
    seo.apply({ title: null, description: 'Sayfa', path: '/', appBanner: true });
    expect(content('apple-itunes-app')).toBeUndefined();
    expect(content('robots')).toBe('index,follow,max-image-preview:large');
    expect(document.head.querySelectorAll('[data-iv-seo]').length).toBeGreaterThan(0);
    seo.reset();
    expect(document.head.querySelectorAll('[data-iv-seo]')).toHaveLength(0);
    expect(document.title).toBe(before);
  });

  it.each(['//evil.example', 'https://evil.example', '/a/../b', '/a?x=1'])(
    'rejects invalid paths in every URL field',
    (path) => {
      const seo = setup();
      expect(() => seo.apply({ title: null, description: '', path })).toThrow();
      expect(() =>
        seo.apply({ title: null, description: '', path: '/', alternates: { en: path } }),
      ).toThrow();
      expect(() =>
        seo.apply({ title: null, description: '', path: '/', ogImagePath: path }),
      ).toThrow();
    },
  );
});
