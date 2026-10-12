import {
  CityDetail,
  CitySitemap,
  LineOut,
  SitemapIndex,
  StopOut,
  StopPairOut,
} from './public-types';

export const timestamp = '2026-10-12T09:30:00Z';
const id = '00000000-0000-0000-0000-000000000001';

export function stopData(slug = 'ilk-durak', name = 'İlk Durak'): StopOut {
  return { id, slug, name, kind: 'informal', location: [29, 41] };
}

export function lineData(change: Partial<LineOut> = {}): LineOut {
  return {
    slug: 'ornek-hat',
    code: 'Ö1',
    name: 'Örnek Hat',
    mode: 'minibus',
    id,
    status: 'published',
    version_no: 1,
    published_at: timestamp,
    geometry: {
      type: 'LineString',
      coordinates: [
        [29, 41],
        [29.1, 41.1],
      ],
    },
    stops: [stopData(), stopData('son-durak', 'Son Durak')],
    fare_minor: 2750,
    fare_updated_at: timestamp,
    hours_text: 'Her gün 06:00–23:00',
    payment_methods: ['nakit', 'kart'],
    hail_notes: null,
    last_verified_at: timestamp,
    contributor_count: 3,
    ...change,
  };
}

export function cityData(change: Partial<CityDetail> = {}): CityDetail {
  const line = lineData();
  return {
    name: 'Örnek Şehir',
    slug: 'ornek-sehir',
    is_sample: true,
    bbox: [28, 40, 30, 42],
    centroid: [29, 41],
    timezone: 'Europe/Istanbul',
    pack_version: 1,
    published_line_count: 50,
    recently_updated_lines: [{ ...line, updated_at: timestamp }],
    popular_lines: [line],
    lastmod: timestamp,
    ...change,
  };
}

export function pairData(): StopPairOut {
  return {
    from_stop: { slug: 'ilk-uzun-durak', name: 'İlk Uzun Durak' },
    to_stop: { slug: 'son-uzun-durak', name: 'Son Uzun Durak' },
    shared_line_count: 2,
  };
}

export function sitemapData(): CitySitemap {
  return {
    city: 'ornek-sehir',
    lastmod: timestamp,
    lines: [{ slug: 'ornek-hat', lastmod: '2026-10-01T12:30:00+03:00' }],
    stops: [{ slug: 'ilk-durak', lastmod: '2026-10-02T13:00:00+03:00' }],
  };
}

export function sitemapIndexData(): SitemapIndex {
  return {
    cities: [
      { slug: 'ornek-sehir', lastmod: timestamp, is_sample: true, published_line_count: 50 },
      { slug: 'istanbul', lastmod: timestamp, is_sample: false, published_line_count: 51 },
    ],
  };
}
