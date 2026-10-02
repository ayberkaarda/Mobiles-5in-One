import { SAMPLE_VENUE_SEEDS } from '@kadro/db/seed';
import { describe, expect, it, vi } from 'vitest';

import { renderedTitle } from '../../components/marketing/metadata';
import {
  clampText,
  countWords,
  DESCRIPTION_MAX,
  districtDescription,
  districtIntro,
  districtTitle,
  featureRows,
  formatMatchTime,
  formatPriceRange,
  positionLabel,
  venueDescription,
  venueIntro,
  venueTitle,
} from '../../components/seo/format';
import { serializeJsonLd } from '../../components/seo/json-ld';
import { districtStructuredData, venueStructuredData } from '../../lib/server/seo/structured-data';
import { type PublicVenue, isSlug } from '../../lib/server/seo/queries';

vi.mock('next/cache', () => ({ unstable_cache: vi.fn() }));
vi.mock('../../lib/server/runtime', () => ({ serverRuntime: vi.fn() }));

const { dataSource, liveCalls, liveDistricts, districtTag, venueTag } =
  await import('../../lib/server/seo/data');

/**
 * Copy, metadata limits, read-time filters and structured data of the programmatic SEO pages
 * (product spec §7, ADR-0057). Fixture names are the seeded `[ÖRNEK]` sample venues or plainly
 * fictional test names.
 */

const ORIGIN = 'https://kadro.app';

const DISTRICTS = [
  { il: 'İstanbul', ilce: 'Kadıköy' },
  { il: 'İstanbul', ilce: 'Küçükçekmece' },
  { il: 'Ankara', ilce: 'Çankaya' },
  { il: 'İzmir', ilce: 'Karşıyaka' },
];

const LONG_NAME = `[ÖRNEK] ${'Uzun Deneme Sahası Adı '.repeat(6)}`.trim();
const NAMES = [...SAMPLE_VENUE_SEEDS.map((seed) => seed.name), 'Deneme', LONG_NAME];

function venue(overrides: Partial<PublicVenue> = {}): PublicVenue {
  return {
    id: '01900000-0000-7000-8000-000000000001',
    name: '[ÖRNEK] Deneme Sahası',
    slug: 'ornek-deneme-sahasi',
    districtId: '01900000-0000-7000-8000-000000000002',
    location: { latitude: 40.99, longitude: 29.03 },
    indoor: false,
    priceMinMinor: 250_000,
    priceMaxMinor: 350_000,
    verified: true,
    isSample: false,
    rating: { average: null, count: 0 },
    address: 'Deneme Mahallesi 1',
    phone: '+90 216 000 00 00',
    features: { lighting: true, shower: false },
    recentReviews: [],
    myReview: null,
    district: {
      id: '01900000-0000-7000-8000-000000000002',
      il: 'İstanbul',
      ilce: 'Kadıköy',
      ilSlug: 'istanbul',
      slug: 'kadikoy',
    },
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('answer-first paragraphs (spec §7 GEO: 40 to 60 words, names Kadro)', () => {
  it('venue pages', () => {
    for (const name of NAMES) {
      for (const district of DISTRICTS) {
        for (const indoor of [true, false]) {
          const text = venueIntro({ name, ...district, indoor });
          expect(countWords(text), text).toBeGreaterThanOrEqual(40);
          expect(countWords(text), text).toBeLessThanOrEqual(60);
          expect(text).toContain('Kadro');
        }
      }
    }
  });

  it('district pages', () => {
    for (const district of DISTRICTS) {
      const text = districtIntro(district);
      expect(countWords(text), text).toBeGreaterThanOrEqual(40);
      expect(countWords(text), text).toBeLessThanOrEqual(60);
      expect(text).toContain('Kadro');
    }
  });
});

describe('metadata limits (spec §7: title ≤ 60, description ≤ 155)', () => {
  it('venue titles and descriptions, including a 120-character name', () => {
    for (const name of NAMES) {
      for (const district of DISTRICTS) {
        expect(renderedTitle(venueTitle(name)).length, name).toBeLessThanOrEqual(60);
        const description = venueDescription(
          { name, ...district, indoor: true },
          formatPriceRange(250_000, 3_500_000),
        );
        expect(description.length, description).toBeLessThanOrEqual(DESCRIPTION_MAX);
      }
    }
    expect(LONG_NAME.length).toBeGreaterThan(100);
  });

  it('district titles and descriptions', () => {
    for (const district of DISTRICTS) {
      for (const count of [0, 1, 50]) {
        expect(renderedTitle(districtTitle(district)).length).toBeLessThanOrEqual(60);
        expect(districtDescription(district, count).length).toBeLessThanOrEqual(DESCRIPTION_MAX);
      }
    }
    expect(districtDescription(DISTRICTS[0] ?? { il: '', ilce: '' }, 0)).toContain('ilanı yok');
  });

  it('clamps at a word boundary with an ellipsis', () => {
    expect(clampText('kısa metin', 20)).toBe('kısa metin');
    const clamped = clampText('bir iki üç dört beş altı yedi', 15);
    expect(clamped.length).toBeLessThanOrEqual(15);
    expect(clamped).toBe('bir iki üç…');
  });
});

describe('formatting', () => {
  it('prices in lira from minor units, one value when equal, null without a price', () => {
    expect(formatPriceRange(250_000, 350_000)).toMatch(/^₺2\.500 – ₺3\.500$/);
    expect(formatPriceRange(250_000, 250_000)).toMatch(/^₺2\.500$/);
    expect(formatPriceRange(null, 300_000)).toMatch(/^₺3\.000$/);
    expect(formatPriceRange(null, null)).toBeNull();
  });

  it('match times in Turkey whatever the server zone', () => {
    // 17:00 UTC is 20:00 in Istanbul (UTC+3 all year).
    expect(formatMatchTime('2026-10-04T17:00:00.000Z')).toMatch(/4 Ekim Pazar 20:00/);
  });

  it('positions and features with the app labels', () => {
    expect(positionLabel(null)).toBe('Her mevki');
    expect(positionLabel('GK')).toBe('Kaleci');
    expect(featureRows({ shower: false, lighting: true })).toEqual([
      { key: 'lighting', label: 'Aydınlatma', present: true },
      { key: 'shower', label: 'Duş', present: false },
    ]);
  });

  it('accepts only slug path segments', () => {
    for (const ok of ['istanbul', 'kadikoy', 'ornek-kadikoy-hali-saha-a', 'a1']) {
      expect(isSlug(ok), ok).toBe(true);
    }
    for (const bad of [
      '',
      'Kadikoy',
      'kadıköy',
      '-a',
      'a-',
      'a--b',
      'a b',
      'a/b',
      'a'.repeat(81),
    ]) {
      expect(isSlug(bad), bad).toBe(false);
    }
  });
});

describe('read-time bounds of cached data (ADR-0055 decision 2)', () => {
  const now = new Date('2026-10-04T12:00:00.000Z');
  const call = (id: string, expiresAt: string, startsAt: string) => ({
    id,
    districtId: 'd',
    startsAt,
    format: '7v7' as const,
    missingCount: 2,
    position: null,
    level: 'regular' as const,
    venue: null,
    teamName: 'Deneme FK',
    expiresAt,
  });

  it('drops calls whose expiry or match start has passed, whatever the cache holds', () => {
    const listing = {
      district: { id: 'd', il: 'İstanbul', ilce: 'Kadıköy', ilSlug: 'istanbul', slug: 'kadikoy' },
      venues: [],
      calls: [
        call('live', '2026-10-04T13:00:00.000Z', '2026-10-04T15:00:00.000Z'),
        call('expired', '2026-10-04T12:00:00.000Z', '2026-10-04T15:00:00.000Z'),
        call('started', '2026-10-04T13:00:00.000Z', '2026-10-04T11:59:59.000Z'),
      ],
    };
    expect(liveCalls(listing, now).calls.map((entry) => entry.id)).toEqual(['live']);
  });

  it('drops sitemap districts whose last call has ended', () => {
    const rows = [
      { ilSlug: 'istanbul', slug: 'kadikoy', listedUntil: '2026-10-04T12:00:01.000Z' },
      { ilSlug: 'izmir', slug: 'karsiyaka', listedUntil: '2026-10-04T12:00:00.000Z' },
    ];
    expect(liveDistricts(rows, now).map((row) => row.slug)).toEqual(['kadikoy']);
  });

  it('keys entries by a digest of the database URL, never the URL itself', () => {
    const source = (url: string) =>
      dataSource({ env: { DATABASE_URL: url } } as Parameters<typeof dataSource>[0]);
    const first = source('postgres://kadro:birinci-parola@127.0.0.1:5432/kadro');
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(source('postgres://kadro:ikinci-parola@127.0.0.1:5432/kadro')).not.toBe(first);
  });

  it('tags entries per venue and per district', () => {
    expect(venueTag('ornek-a')).toBe('seo:venue:ornek-a');
    expect(districtTag('istanbul', 'kadikoy')).toBe('seo:district:istanbul/kadikoy');
  });
});

describe('structured data (spec §7 JSON-LD)', () => {
  it('describes a verified venue as SportsActivityLocation with breadcrumbs', () => {
    const data = venueStructuredData(ORIGIN, venue(), '/saha/ornek-deneme-sahasi');
    const graph = data['@graph'] as Record<string, unknown>[];
    expect(graph.map((node) => node['@type'])).toEqual([
      'BreadcrumbList',
      'SportsActivityLocation',
    ]);
    expect(graph[1]).toMatchObject({
      url: 'https://kadro.app/saha/ornek-deneme-sahasi',
      telephone: '+90 216 000 00 00',
      address: { addressLocality: 'Kadıköy', addressRegion: 'İstanbul', addressCountry: 'TR' },
      geo: { latitude: 40.99, longitude: 29.03 },
    });
    expect(graph[1]).not.toHaveProperty('aggregateRating');
  });

  it('adds aggregateRating only when the page shows an average (three or more reviews)', () => {
    const data = venueStructuredData(
      ORIGIN,
      venue({ rating: { average: 4.3, count: 3 } }),
      '/saha/ornek-deneme-sahasi',
    );
    const place = (data['@graph'] as Record<string, unknown>[])[1];
    expect(place?.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 4.3,
      reviewCount: 3,
      bestRating: 5,
      worstRating: 1,
    });
  });

  it('gives a sample venue breadcrumbs only, never a place description', () => {
    const data = venueStructuredData(
      ORIGIN,
      venue({ isSample: true, verified: false, phone: null, address: null }),
      '/saha/ornek-deneme-sahasi',
    );
    const graph = data['@graph'] as Record<string, unknown>[];
    expect(graph.map((node) => node['@type'])).toEqual(['BreadcrumbList']);
  });

  it('keeps hostile names inside the data block', () => {
    const name = '</script><script>alert(1)</script><!--';
    const text = serializeJsonLd(venueStructuredData(ORIGIN, venue({ name }), '/saha/x'));
    expect(text).not.toMatch(/[<>]/);
    expect(JSON.stringify(JSON.parse(text))).toContain(name);
  });

  it('describes a district page with breadcrumbs', () => {
    const data = districtStructuredData(ORIGIN, '/eksik-var/istanbul/kadikoy', 'Kadıköy');
    expect(data['@graph']).toEqual([
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Kadro', item: 'https://kadro.app/' },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'Kadıköy',
            item: 'https://kadro.app/eksik-var/istanbul/kadikoy',
          },
        ],
      },
    ]);
  });
});
