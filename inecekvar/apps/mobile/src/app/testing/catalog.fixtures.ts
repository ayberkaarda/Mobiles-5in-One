import { Provider } from '@angular/core';
import {
  ApiError,
  CatalogApi,
  City,
  LineDetail,
  LineListItem,
  StopDetail,
  StopSummary,
  TILES_BASE_URL,
} from '@inecekvar/data-access';
import { PREFERENCE_STORE, PreferenceStore } from '../city/city.store';
import { LOCATION_SOURCE, LocateResult } from '../shared/location';
import { SEARCH_DEBOUNCE_MS } from '../search/search.store';

/**
 * API-shaped fixtures mirroring `api/app/seed/sample_city.py` (`[ÖRNEK] Test Şehri`). They exist
 * for tests only; the app reads the same data from the API.
 */
export const SAMPLE_CITY: City = {
  name: '[ÖRNEK] Test Şehri',
  slug: 'ornek-test-sehri',
  is_sample: true,
  bbox: [34.0, 42.5, 34.1, 42.58],
  centroid: [34.05, 42.54],
  timezone: 'Europe/Istanbul',
  pack_version: 0,
  published_line_count: 3,
};

const point = (row: number, col: number): number[] => [
  34.01 + (col - 1) * 0.02,
  42.51 + (row - 1) * 0.02,
];

export function sampleStop(row: number, col: number): StopSummary {
  return {
    id: `stop-${row}-${col}`,
    slug: `ornek-durak-${row}-${col}`,
    name: `[ÖRNEK] Durak ${row}-${col}`,
    kind: (row === 2 && col === 2) || (row === 4 && col === 4) ? 'informal' : 'formal',
    location: point(row, col),
  };
}

export const SAMPLE_LINES: LineListItem[] = [
  { id: 'line-1', slug: 'ornek-hat-1', code: 'ORN-1', name: '[ÖRNEK] Hat ORN-1', mode: 'dolmus' },
  { id: 'line-2', slug: 'ornek-hat-2', code: 'ORN-2', name: '[ÖRNEK] Hat ORN-2', mode: 'minibus' },
  { id: 'line-3', slug: 'ornek-hat-3', code: 'ORN-3', name: '[ÖRNEK] Hat ORN-3', mode: 'servis' },
];

export function sampleLineDetail(overrides: Partial<LineDetail> = {}): LineDetail {
  const stops = [1, 2, 3, 4, 5].map((col) => sampleStop(1, col));
  return {
    id: 'line-1',
    slug: 'ornek-hat-1',
    code: 'ORN-1',
    name: '[ÖRNEK] Hat ORN-1',
    mode: 'dolmus',
    status: 'published',
    version_no: 1,
    published_at: '2026-10-12T08:15:58Z',
    geometry: { type: 'LineString', coordinates: stops.map((s) => s.location) },
    stops,
    fare_minor: 2500,
    fare_updated_at: '2026-10-01T09:00:00Z',
    hours_text: '[ÖRNEK] 06:00-23:00',
    payment_methods: ['nakit'],
    hail_notes: null,
    last_verified_at: null,
    contributor_count: 0,
    ...overrides,
  };
}

export function sampleStopDetail(overrides: Partial<StopDetail> = {}): StopDetail {
  return {
    ...sampleStop(1, 5),
    lines: [
      { slug: 'ornek-hat-1', code: 'ORN-1', name: '[ÖRNEK] Hat ORN-1', mode: 'dolmus' },
      { slug: 'ornek-hat-3', code: 'ORN-3', name: '[ÖRNEK] Hat ORN-3', mode: 'servis' },
    ],
    ...overrides,
  };
}

export const notFound = (code = 'line.not_found') => new ApiError('problem', 404, code, 'req-test');
export const offline = () => new ApiError('network', 0, 'network', 'req-test');

/** Matches the API: `q` filters code or name, case-insensitively. */
function filterByQuery(q: string | null | undefined): LineListItem[] {
  if (!q) return SAMPLE_LINES;
  const needle = q.toLocaleLowerCase('tr');
  return SAMPLE_LINES.filter(
    (l) =>
      l.code.toLocaleLowerCase('tr').includes(needle) ||
      l.name.toLocaleLowerCase('tr').includes(needle),
  );
}

export interface Spy<A extends unknown[], R> {
  (...args: A): R;
  calls: A[];
  impl: (...args: A) => R;
}

/** A recording function whose implementation tests can swap (no test globals in app sources). */
export function spy<A extends unknown[], R>(impl: (...args: A) => R): Spy<A, R> {
  const fn = ((...args: A) => {
    fn.calls.push(args);
    return fn.impl(...args);
  }) as Spy<A, R>;
  fn.calls = [];
  fn.impl = impl;
  return fn;
}

/** A CatalogApi stand-in answering from the fixtures; every method is a spy. */
export function fakeCatalog() {
  const allStops = [1, 2, 3, 4].flatMap((row) =>
    [1, 2, 3, 4, 5].map((col) => sampleStop(row, col)),
  );
  return {
    cities: spy(async (): Promise<City[]> => [SAMPLE_CITY]),
    lines: spy(async (query: { city: string; q?: string | null }): Promise<LineListItem[]> =>
      query.city === SAMPLE_CITY.slug ? filterByQuery(query.q) : Promise.reject(notFound()),
    ),
    line: spy(async (slug: string, city: string): Promise<LineDetail> => {
      if (city !== SAMPLE_CITY.slug || slug !== 'ornek-hat-1') throw notFound();
      return sampleLineDetail();
    }),
    stop: spy(async (slug: string, city: string): Promise<StopDetail> => {
      if (city !== SAMPLE_CITY.slug || slug !== 'ornek-durak-1-5') throw notFound('stop.not_found');
      return sampleStopDetail();
    }),
    stopsNear: spy(async (): Promise<StopSummary[]> => allStops),
  };
}

export type FakeCatalog = ReturnType<typeof fakeCatalog>;

export class MemoryPreferences implements PreferenceStore {
  readonly values = new Map<string, string>();
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.values.set(key, value);
  }
  async remove(key: string) {
    this.values.delete(key);
  }
}

export interface CatalogTestingOptions {
  catalog?: FakeCatalog;
  prefs?: MemoryPreferences;
  locate?: () => Promise<LocateResult>;
}

/** Providers for pages and stores: fake API, in-memory preferences, no debounce, fake location. */
export function catalogTesting(options: CatalogTestingOptions = {}): Provider[] {
  const catalog = options.catalog ?? fakeCatalog();
  const prefs = options.prefs ?? new MemoryPreferences();
  return [
    { provide: CatalogApi, useValue: catalog },
    { provide: PREFERENCE_STORE, useValue: prefs },
    { provide: SEARCH_DEBOUNCE_MS, useValue: 0 },
    { provide: TILES_BASE_URL, useValue: 'https://tiles.test' },
    {
      provide: LOCATION_SOURCE,
      useValue: {
        locate: options.locate ?? (async () => ({ kind: 'ok', lat: 42.51, lng: 34.09 })),
      },
    },
  ];
}

/** Lets resource loaders, effects and change detection settle. */
export async function settle(fixture?: { whenStable(): Promise<unknown> }): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture?.whenStable();
  }
}
