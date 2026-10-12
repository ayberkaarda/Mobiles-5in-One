import { TestBed } from '@angular/core/testing';
import { ApiError } from '@inecekvar/data-access';
import { CityStore } from '../city/city.store';
import { ConnectivityService } from '../shared/connectivity.service';
import { LocateResult } from '../shared/location';
import {
  catalogTesting,
  fakeCatalog,
  FakeCatalog,
  offline,
  SAMPLE_CITY,
} from '../testing/catalog.fixtures';
import { MAX_QUERY_LENGTH, SEARCH_DEBOUNCE_MS, SearchStore } from './search.store';
import { samplePoints, StopIndex } from './stop-index';

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function setup(
  options: { catalog?: FakeCatalog; city?: boolean; locate?: () => Promise<LocateResult> } = {},
) {
  const catalog = options.catalog ?? fakeCatalog();
  TestBed.configureTestingModule({
    providers: [...catalogTesting({ catalog, locate: options.locate }), SearchStore],
  });
  const cities = TestBed.inject(CityStore);
  await cities.init();
  if (options.city !== false) await cities.select(SAMPLE_CITY.slug);
  const store = TestBed.inject(SearchStore);
  await flush();
  return { store, catalog, cities };
}

describe('SearchStore', () => {
  it('asks for a city before searching', async () => {
    const { store, catalog } = await setup({ city: false });
    expect(store.view()).toBe('no-city');
    expect(catalog.lines.calls).toHaveLength(0);
  });

  it('lists every line of the city, then searches with the city and the trimmed query', async () => {
    const { store, catalog } = await setup();
    expect(store.view()).toBe('results');
    expect(store.lines().map((l) => l.code)).toEqual(['ORN-1', 'ORN-2', 'ORN-3']);
    expect(catalog.lines.calls[0]?.[0]).toEqual({
      city: SAMPLE_CITY.slug,
      q: undefined,
      limit: 100,
    });

    store.setQuery('  orn-2 ');
    await flush();
    expect(catalog.lines.calls.at(-1)?.[0]).toMatchObject({ city: SAMPLE_CITY.slug, q: 'orn-2' });
    expect(store.lines().map((l) => l.code)).toEqual(['ORN-2']);
  });

  it('cuts the query to the API limit', async () => {
    const { store, catalog } = await setup();
    store.setQuery('x'.repeat(200));
    await flush();
    expect(catalog.lines.calls.at(-1)?.[0].q).toHaveLength(MAX_QUERY_LENGTH);
  });

  it('filters by mode on the device and shows the empty state', async () => {
    const { store } = await setup();
    store.mode.set('servis');
    expect(store.lines().map((l) => l.code)).toEqual(['ORN-3']);
    store.setQuery('zzz');
    await flush();
    expect(store.view()).toBe('empty');
    store.clear();
    await flush();
    expect(store.mode()).toBe('all');
    expect(store.lines()).toHaveLength(3);
  });

  it('finds stops by name from the sampled stop index', async () => {
    const { store, catalog } = await setup();
    store.setQuery('durak 2-2');
    await flush();
    expect(store.stops().map((s) => s.slug)).toEqual(['ornek-durak-2-2']);
    expect(store.view()).toBe('results');
    store.setQuery('durak 3');
    await flush();
    expect(store.stops().length).toBeGreaterThan(1);
    // The grid is sampled once per city and session.
    expect(catalog.stopsNear.calls).toHaveLength(samplePoints(SAMPLE_CITY.bbox).length);
  });

  it('shows offline for a network failure and retries when the connection returns', async () => {
    const catalog = fakeCatalog();
    const working = catalog.lines.impl;
    catalog.lines.impl = async () => Promise.reject(offline());
    const { store } = await setup({ catalog });
    expect(store.view()).toBe('offline');

    catalog.lines.impl = working;
    const connectivity = TestBed.inject(ConnectivityService);
    connectivity.online.set(false);
    await flush();
    connectivity.online.set(true);
    await flush();
    expect(store.view()).toBe('results');
  });

  it('shows the error state for a server error and flags rate limiting', async () => {
    const catalog = fakeCatalog();
    catalog.lines.impl = async () =>
      Promise.reject(new ApiError('rate_limited', 429, 'rate_limited', 'r', null, 30));
    const { store } = await setup({ catalog });
    expect(store.view()).toBe('error');
    expect(store.rateLimited()).toBe(true);
  });

  it('waits for a typing pause before searching', async () => {
    vi.useFakeTimers();
    try {
      const catalog = fakeCatalog();
      TestBed.configureTestingModule({
        providers: [
          ...catalogTesting({ catalog }),
          { provide: SEARCH_DEBOUNCE_MS, useValue: 300 },
          SearchStore,
        ],
      });
      const store = TestBed.inject(SearchStore);
      store.setQuery('o');
      TestBed.tick();
      store.setQuery('orn');
      TestBed.tick();
      vi.advanceTimersByTime(299);
      expect(store.term()).toBe('');
      vi.advanceTimersByTime(1);
      expect(store.term()).toBe('orn');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('SearchStore nearby lines', () => {
  it('turns nearby stops of the city into lines with the nearest stop and distance', async () => {
    const { store, catalog } = await setup();
    catalog.stopsNear.impl = async () => [
      {
        id: 'a',
        slug: 'ornek-durak-1-5',
        name: '[ÖRNEK] Durak 1-5',
        kind: 'formal',
        location: [34.09, 42.51],
      },
      { id: 'b', slug: 'baska-sehir', name: 'Başka', kind: 'formal', location: [29.0, 41.0] },
    ];
    await store.findNearby();
    const state = store.nearby();
    expect(state.kind).toBe('ready');
    if (state.kind !== 'ready') return;
    expect(state.lines.map((l) => l.line.code)).toEqual(['ORN-1', 'ORN-3']);
    expect(state.lines[0]?.stopName).toBe('[ÖRNEK] Durak 1-5');
    expect(state.lines[0]?.distanceM).toBeLessThan(5);
    // The stop outside the city bbox is never requested.
    expect(catalog.stop.calls.map((c) => c[0])).toEqual(['ornek-durak-1-5']);
    expect(catalog.stop.calls[0]?.[1]).toBe(SAMPLE_CITY.slug);
  });

  it('reports a refused permission without calling the API', async () => {
    const { store, catalog } = await setup({ locate: async () => ({ kind: 'denied' }) });
    await store.findNearby();
    expect(store.nearby().kind).toBe('denied');
    expect(catalog.stopsNear.calls).toHaveLength(0);
  });

  it('reports an unavailable position and an empty neighbourhood', async () => {
    const { store, catalog } = await setup({ locate: async () => ({ kind: 'unavailable' }) });
    await store.findNearby();
    expect(store.nearby().kind).toBe('unavailable');

    TestBed.resetTestingModule();
    const second = await setup();
    second.catalog.stopsNear.impl = async () => [];
    await second.store.findNearby();
    expect(second.store.nearby()).toEqual({ kind: 'ready', lines: [] });
    expect(catalog.stop.calls).toHaveLength(0);
  });

  it('skips stops of another city (404) and fails only when nothing loads', async () => {
    const { store, catalog } = await setup();
    catalog.stopsNear.impl = async () => [
      { id: 'a', slug: 'ornek-durak-1-1', name: 'x', kind: 'formal', location: [34.01, 42.51] },
    ];
    await store.findNearby();
    expect(store.nearby()).toEqual({ kind: 'ready', lines: [] });

    catalog.stopsNear.impl = async () => Promise.reject(offline());
    await store.findNearby();
    expect(store.nearby()).toEqual({ kind: 'error', offline: true });
  });

  it('resets when the city changes', async () => {
    const { store, cities } = await setup({ locate: async () => ({ kind: 'denied' }) });
    await store.findNearby();
    expect(store.nearby().kind).toBe('denied');
    await cities.clear();
    await flush();
    expect(store.nearby().kind).toBe('idle');
  });
});

describe('StopIndex', () => {
  it('samples at most a 3 x 3 grid and keeps stops inside the bbox', async () => {
    expect(samplePoints([34.0, 42.5, 34.001, 42.501])).toHaveLength(1);
    expect(samplePoints(SAMPLE_CITY.bbox)).toHaveLength(9);
    expect(samplePoints([28.5, 40.8, 29.5, 41.3])).toHaveLength(9);

    const catalog = fakeCatalog();
    TestBed.configureTestingModule({ providers: catalogTesting({ catalog }) });
    const index = TestBed.inject(StopIndex);
    expect(await index.search(SAMPLE_CITY, 'd')).toEqual([]);
    const found = await index.search(SAMPLE_CITY, 'DURAK 4-4');
    expect(found.map((s) => s.slug)).toEqual(['ornek-durak-4-4']);
  });

  it('forgets a failed sampling so the next search retries', async () => {
    const catalog = fakeCatalog();
    const working = catalog.stopsNear.impl;
    catalog.stopsNear.impl = async () => Promise.reject(offline());
    TestBed.configureTestingModule({ providers: catalogTesting({ catalog }) });
    const index = TestBed.inject(StopIndex);
    await expect(index.search(SAMPLE_CITY, 'durak')).rejects.toBeInstanceOf(ApiError);
    catalog.stopsNear.impl = working;
    expect((await index.search(SAMPLE_CITY, 'durak 1-1')).length).toBe(1);
  });
});
