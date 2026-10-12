import { Component, Provider, signal, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { ApiBytes, ApiError, BytesOptions, City, TILES_BASE_URL } from '@inecekvar/data-access';
import { CityStore } from '../city/city.store';
import { MAP_LIBRARY_LOADER, MapLibrary } from '../map/map-library';
import { MapComponent } from '../map/map.component';
import { PacksPage } from '../pages/packs.page';
import { SearchStore } from '../search/search.store';
import { StopIndex } from '../search/stop-index';
import { ConnectivityService } from '../shared/connectivity.service';
import {
  catalogTesting,
  FakeCatalog,
  fakeCatalog,
  FakeNetwork,
  notFound,
  offline,
  packBody,
  SAMPLE_CITY,
  samplePackData,
  settle,
  spy,
} from '../testing/catalog.fixtures';
import { i18nTesting } from '../testing/i18n.testing';
import { deferred, FakeCacheStorage, fakePmtiles } from '../testing/pack.fakes';
import { CachePackStorage, INDEX_CACHE, INSTALL_CACHE_PREFIX } from './cache-pack-storage';
import { CatalogSource } from './catalog-source';
import {
  apiLineId,
  MAX_PACK_LINES,
  MAX_ROUTE_POINTS,
  PackFormatError,
  PackIndex,
  parsePack,
} from './pack-data';
import { failureOf, isPmtilesV3, PackManager } from './pack-manager';
import { PackRegistry } from './pack-registry';
import { MemoryPackStorage, PackStorage, PackStorageError } from './pack-storage';
import { PACK_STORAGE } from './pack-storage.provider';

const CITY = SAMPLE_CITY.slug;

interface SetupOptions {
  catalog?: FakeCatalog;
  storage?: MemoryPackStorage;
  network?: FakeNetwork;
  providers?: Provider[];
  imports?: Type<unknown>[];
}

function setup(options: SetupOptions = {}) {
  const catalog = options.catalog ?? fakeCatalog();
  const storage = options.storage ?? new MemoryPackStorage();
  const network = options.network ?? new FakeNetwork();
  const warmups = spy(async () => undefined);
  TestBed.configureTestingModule({
    providers: [
      ...catalogTesting({ catalog, packs: storage, network, warmup: warmups }),
      provideRouter([]),
      provideIonicAngular({}),
      ...(options.providers ?? []),
    ],
    imports: [i18nTesting(), ...(options.imports ?? [])],
  });
  return {
    catalog,
    storage,
    network,
    warmups,
    manager: TestBed.inject(PackManager),
    registry: TestBed.inject(PackRegistry),
    cities: TestBed.inject(CityStore),
  };
}

/** A pack download that waits until the test releases it, reporting progress on the way. */
function controllablePack() {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const impl = async (_slug: string, options?: BytesOptions): Promise<ApiBytes> => {
    const body = packBody();
    options?.onProgress?.(0, body.bytes.length);
    options?.onProgress?.(10, body.bytes.length);
    await new Promise<void>((resolve, reject) => {
      options?.signal?.addEventListener('abort', () =>
        reject(new ApiError('aborted', 0, 'aborted', 'req-test')),
      );
      void gate.then(resolve);
    });
    return body;
  };
  return { impl, release: () => release() };
}

describe('pack data', () => {
  const index = new PackIndex(parsePack(packBody().bytes, CITY));

  it('rejects a dataset with too many lines before building its pack index', () => {
    const data = samplePackData();
    const line = data.lines[0];
    if (!line) throw new Error('fixture has no lines');
    const body = packBody({
      ...data,
      lines: Array.from({ length: MAX_PACK_LINES + 1 }, () => line),
    });
    expect(() => parsePack(body.bytes, CITY)).toThrow('too many lines');
  });

  it('rejects a line with too many route points before indexing it', () => {
    const data = samplePackData();
    const line = data.lines[0];
    if (!line) throw new Error('fixture has no lines');
    line.geometry = Array.from({ length: MAX_ROUTE_POINTS + 1 }, () => [34, 42]);
    expect(() => parsePack(packBody(data).bytes, CITY)).toThrow('too many route points per line');
  });

  it('refuses bodies that are not a format 1 pack of the city', () => {
    const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
    expect(() => parsePack(new TextEncoder().encode('{"format":1,'), CITY)).toThrow(
      PackFormatError,
    );
    expect(() => parsePack(enc({ ...samplePackData(), format: 2 }), CITY)).toThrow(
      'unknown format',
    );
    expect(() => parsePack(packBody().bytes, 'baska-sehir')).toThrow('another city');
    const broken = samplePackData();
    (broken.lines[0] as unknown as Record<string, unknown>)['stops'] = 'x';
    expect(() => parsePack(enc(broken), CITY)).toThrow('lines');
  });

  it('searches lines by code or name with Turkish folding, sorted by code', () => {
    expect(index.searchLines(null).map((l) => l.code)).toEqual(['ORN-1', 'ORN-2', 'ORN-3']);
    expect(index.searchLines('orn-2').map((l) => l.code)).toEqual(['ORN-2']);
    expect(index.searchLines('örnek] hat orn-3').map((l) => l.code)).toEqual(['ORN-3']);
    expect(index.searchLines('zzz')).toEqual([]);
  });

  it('answers line and stop pages in the API shape, without database ids', () => {
    const line = index.line('ornek-hat-1');
    expect(line?.stops.map((s) => s.slug)).toEqual(
      [1, 2, 3, 4, 5].map((c) => `ornek-durak-1-${c}`),
    );
    expect(line?.geometry.type).toBe('LineString');
    expect(apiLineId(line?.id)).toBeUndefined();
    expect(apiLineId('0192-real')).toBe('0192-real');
    expect(index.line('yok')).toBeNull();
    const stop = index.stop('ornek-durak-1-3');
    expect(stop?.lines.map((l) => l.code)).toEqual(['ORN-1', 'ORN-2']);
  });

  it('computes nearby stops on the device with haversine, nearest first', () => {
    // 34.03, 42.51 is stop 1-2; 2 km covers the neighbours 0.02 degrees away (about 1.6 km east).
    const near = index.stopsNear(42.51, 34.03, 1000);
    expect(near.map((s) => s.slug)).toEqual(['ornek-durak-1-2']);
    const wider = index.stopsNear(42.51, 34.03, 2000).map((s) => s.slug);
    expect(wider[0]).toBe('ornek-durak-1-2');
    expect(wider).toEqual(expect.arrayContaining(['ornek-durak-1-1', 'ornek-durak-1-3']));
    expect(wider).not.toContain('ornek-durak-1-5');
  });

  it('finds stops by name from two characters', () => {
    expect(index.searchStops('d')).toEqual([]);
    expect(index.searchStops('durak 3-4').map((s) => s.slug)).toEqual(['ornek-durak-3-4']);
  });
});

describe('PackManager', () => {
  it('cancels during saving without committing or deleting the previous pack', async () => {
    const backing = new FakeCacheStorage();
    const storage = new CachePackStorage(backing);
    const { manager, registry, catalog } = setup({
      providers: [{ provide: PACK_STORAGE, useValue: storage }],
    });
    await manager.download(CITY);
    const first = registry.manifest(CITY);
    const index = backing.caches.get(INDEX_CACHE)?.get('/__iv-packs/index.json')?.bytes.slice();
    const entered = deferred<void>();
    const release = deferred<void>();
    backing.faults.before = async (key) => {
      if (key.endsWith('dataset.json')) {
        entered.resolve();
        await release.promise;
      }
    };
    catalog.packBytes.impl = async () => packBody(samplePackData(2));
    const installing = manager.download(CITY);
    await entered.promise;
    expect(manager.jobs().get(CITY)?.phase).toBe('saving');
    manager.cancel(CITY);
    release.resolve();
    expect(await installing).toBe(false);
    expect(registry.manifest(CITY)).toEqual(first);
    expect(backing.caches.get(INDEX_CACHE)?.get('/__iv-packs/index.json')?.bytes).toEqual(index);
    expect(
      [...backing.caches.keys()].filter((key) => key.startsWith(INSTALL_CACHE_PREFIX)),
    ).toEqual([expect.stringContaining(first?.installId ?? '')]);
    expect(manager.failures().size).toBe(0);
    expect(manager.jobs().size).toBe(0);
    expect(manager.state({ ...SAMPLE_CITY, pack_version: 2 })).toBe('update');
  });

  it('downloads with progress, installs, warms the map and reports the state', async () => {
    const { manager, registry, catalog, warmups } = setup();
    const gate = controllablePack();
    catalog.packBytes.impl = gate.impl;
    const run = manager.download(CITY);
    await settle();
    expect(manager.state(SAMPLE_CITY)).toBe('working');
    expect(manager.jobs().get(CITY)).toMatchObject({ phase: 'dataset', received: 10 });
    gate.release();
    expect(await run).toBe(true);
    expect(manager.state(SAMPLE_CITY)).toBe('installed');
    expect(registry.manifest(CITY)).toMatchObject({ packVersion: 1, lineCount: 3, basemap: null });
    expect(manager.jobs().size).toBe(0);
    expect(warmups.calls).toHaveLength(1);
    expect(catalog.tilesArchive.calls).toHaveLength(1);
  });

  it('cancels a download: nothing is written and no error is shown', async () => {
    const { manager, registry, catalog, storage } = setup();
    const gate = controllablePack();
    catalog.packBytes.impl = gate.impl;
    const run = manager.download(CITY);
    await settle();
    manager.cancel(CITY);
    expect(await run).toBe(false);
    expect(await storage.list()).toEqual([]);
    expect(registry.has(CITY)).toBe(false);
    expect(manager.failures().size).toBe(0);
    expect(manager.state(SAMPLE_CITY)).toBe('none');
  });

  it('explains an entitlement refusal and keeps nothing', async () => {
    const { manager, catalog, registry } = setup();
    catalog.packBytes.impl = async () => {
      throw new ApiError('problem', 403, 'pack.entitlement_required', 'req-test');
    };
    expect(await manager.download(CITY)).toBe(false);
    expect(manager.failures().get(CITY)?.kind).toBe('entitlement');
    expect(registry.has(CITY)).toBe(false);
    expect(failureOf(new ApiError('problem', 402, 'payment', 'r')).kind).toBe('entitlement');
  });

  it('maps rate limits, no connection and bad bodies to their own failures', async () => {
    const { manager, catalog } = setup();
    catalog.packBytes.impl = async () => {
      throw new ApiError('problem', 429, 'rate_limited', 'req-test', null, 3600);
    };
    await manager.download(CITY);
    expect(manager.failures().get(CITY)?.kind).toBe('rate_limited');
    catalog.packBytes.impl = async () => {
      throw offline();
    };
    await manager.download(CITY);
    expect(manager.failures().get(CITY)?.kind).toBe('offline');
    catalog.packBytes.impl = async () => ({ ...packBody(), declaredLength: 5 });
    await manager.download(CITY);
    expect(manager.failures().get(CITY)?.kind).toBe('integrity');
    catalog.packBytes.impl = async () => packBody({ ...samplePackData(), format: 9 });
    await manager.download(CITY);
    expect(manager.failures().get(CITY)?.kind).toBe('invalid');
    expect(failureOf(new PackStorageError('quota', 'full')).kind).toBe('quota');
  });

  it('installs the basemap when the city has a PMTiles archive', async () => {
    const { manager, catalog, registry, storage } = setup();
    const tiles = fakePmtiles(500);
    catalog.tilesArchive.impl = async () => ({
      bytes: tiles,
      declaredLength: tiles.length,
      etag: null,
      contentType: 'application/vnd.pmtiles',
    });
    await manager.download(CITY);
    expect(registry.manifest(CITY)?.basemap?.bytes).toBe(tiles.length);
    expect([...((await storage.readBasemap(CITY, 0, 8)) ?? [])]).toEqual([...tiles.slice(0, 8)]);
    expect(isPmtilesV3(new Uint8Array(200))).toBe(false);
  });

  it('detects an update from pack_version and replaces the pack, removing on request', async () => {
    const { manager, catalog, registry, cities } = setup();
    await cities.init();
    await manager.download(CITY);
    expect(manager.updates()).toEqual([]);
    cities.cities.set([{ ...SAMPLE_CITY, pack_version: 2 }]);
    expect(manager.updateAvailable(cities.cities()[0] as City)).toBe(true);
    expect(manager.state(cities.cities()[0] as City)).toBe('update');
    expect(manager.updates().map((c) => c.slug)).toEqual([CITY]);
    catalog.packBytes.impl = async () => packBody(samplePackData(2));
    await manager.download(CITY);
    expect(registry.manifest(CITY)?.packVersion).toBe(2);
    expect(manager.updates()).toEqual([]);
    await manager.remove(CITY);
    expect(registry.has(CITY)).toBe(false);
    expect(manager.estimate()?.packs).toBe(0);
  });

  it('keeps the installed pack when an update fails', async () => {
    const { manager, catalog, registry } = setup();
    await manager.download(CITY);
    const first = registry.manifest(CITY);
    catalog.packBytes.impl = async () => ({ ...packBody(samplePackData(2)), declaredLength: 1 });
    await manager.download(CITY);
    expect(registry.manifest(CITY)).toEqual(first);
    expect((await registry.dataset(CITY))?.data.pack_version).toBe(1);
  });
});

describe('PackRegistry', () => {
  it('evicts dataset promises from obsolete generations on update and removal', async () => {
    const { manager, registry, catalog } = setup();
    await manager.download(CITY);
    await registry.dataset(CITY);
    const cache = (registry as unknown as { datasets: Map<string, unknown> }).datasets;
    const oldKey = [...cache.keys()][0];
    expect(cache.size).toBe(1);
    catalog.packBytes.impl = async () => packBody(samplePackData(2));
    await manager.download(CITY);
    expect(cache.has(oldKey ?? '')).toBe(false);
    await registry.dataset(CITY);
    expect(cache.size).toBe(1);
    await manager.remove(CITY);
    expect(cache.size).toBe(0);
  });

  it('refreshes committed manifests after a cross-tab invalidation', async () => {
    let invalidate: () => void = () => undefined;
    const memory = new MemoryPackStorage();
    const storage: PackStorage = {
      kind: 'memory',
      list: () => memory.list(),
      readDataset: (city) => memory.readDataset(city),
      readBasemap: (city, offset, length, installId) =>
        memory.readBasemap(city, offset, length, installId),
      install: (manifest, files, signal) => memory.install(manifest, files, signal),
      remove: (city) => memory.remove(city),
      estimate: () => memory.estimate(),
      subscribeInvalidation: (listener) => {
        invalidate = listener;
        return () => undefined;
      },
    };
    const { manager, registry } = setup({
      providers: [{ provide: PACK_STORAGE, useValue: storage }],
    });
    await manager.download(CITY);
    expect(registry.has(CITY)).toBe(true);
    await memory.remove(CITY);
    invalidate();
    await settle();
    expect(registry.has(CITY)).toBe(false);
  });

  it('rejects reads through an old PMTiles source after its install is replaced', async () => {
    const { manager, registry, catalog } = setup();
    catalog.tilesArchive.impl = async () => ({
      bytes: fakePmtiles(100),
      declaredLength: null,
      etag: null,
      contentType: null,
    });
    await manager.download(CITY);
    const source = registry.basemapSource(CITY);
    expect(source).not.toBeNull();
    await source?.getBytes(0, 8);
    catalog.packBytes.impl = async () => packBody(samplePackData(2));
    await manager.download(CITY);
    await expect(source?.getBytes(0, 8)).rejects.toThrow('basemap not installed');
  });

  it('lists offline cities and ignores a dataset that no longer matches its manifest', async () => {
    const { manager, registry, storage } = setup();
    await manager.download(CITY);
    expect((await registry.offlineCities()).map((c) => [c.slug, c.published_line_count])).toEqual([
      [CITY, 3],
    ]);
    const bytes = (await storage.readDataset(CITY)) ?? new Uint8Array(11);
    bytes[10] = (bytes[10] ?? 0) ^ 0xff;
    expect(await registry.dataset(CITY)).toBeNull();
    expect(registry.corrupt().has(CITY)).toBe(true);
  });
});

describe('offline data path', () => {
  async function installed(network?: FakeNetwork, providers: Provider[] = []) {
    const ctx = setup({ network, providers });
    await ctx.manager.download(CITY);
    for (const key of ['lines', 'line', 'stop', 'stopsNear'] as const)
      ctx.catalog[key].calls.length = 0;
    return ctx;
  }

  it('answers line search, line and stop pages and nearby stops from the pack, offline', async () => {
    const network = new FakeNetwork();
    const { catalog } = await installed(network);
    network.set(false);
    for (const key of ['lines', 'line', 'stop', 'stopsNear'] as const) {
      catalog[key].impl = (async () => {
        throw offline();
      }) as never;
    }
    const source = TestBed.inject(CatalogSource);
    expect((await source.lines({ city: CITY, q: 'orn-3' })).map((l) => l.code)).toEqual(['ORN-3']);
    expect((await source.line('ornek-hat-2', CITY)).code).toBe('ORN-2');
    expect((await source.stop('ornek-durak-2-3', CITY)).lines.map((l) => l.code)).toEqual([
      'ORN-2',
    ]);
    expect(
      (await source.stopsNear({ lat: 42.51, lng: 34.01, radius: 500 }, CITY)).map((s) => s.slug),
    ).toEqual(['ornek-durak-1-1']);
    expect(catalog.lines.calls.length + catalog.line.calls.length + catalog.stop.calls.length).toBe(
      0,
    );
    expect(catalog.stopsNear.calls).toHaveLength(0);
  });

  it('asks the API for what the pack lacks, and calls an offline miss not found', async () => {
    const { catalog } = await installed();
    const source = TestBed.inject(CatalogSource);
    catalog.line.impl = async () => {
      throw notFound();
    };
    await expect(source.line('yeni-hat', CITY)).rejects.toMatchObject({ status: 404 });
    expect(catalog.line.calls).toHaveLength(1);
    catalog.line.impl = async () => {
      throw offline();
    };
    await expect(source.line('yeni-hat', CITY)).rejects.toMatchObject({
      status: 404,
      code: 'line.not_found',
    });
  });

  it('uses the API when no pack is installed', async () => {
    const { catalog } = setup();
    const source = TestBed.inject(CatalogSource);
    await source.lines({ city: CITY, q: 'orn' });
    expect(catalog.lines.calls).toHaveLength(1);
    expect(await source.searchStops(CITY, 'durak', 5)).toBeNull();
  });

  it('feeds the Ara tab and the stop index from the pack instead of the grid workaround', async () => {
    const { catalog, cities } = await installed(undefined, [SearchStore]);
    await cities.init();
    await cities.select(CITY);
    const store = TestBed.inject(SearchStore);
    store.setQuery('durak 4-4');
    for (let i = 0; i < 6; i++) {
      TestBed.tick();
      await settle();
    }
    expect(store.stops().map((s) => s.slug)).toEqual(['ornek-durak-4-4']);
    expect(catalog.lines.calls).toHaveLength(0);
    expect(catalog.stopsNear.calls).toHaveLength(0);
    const suggestions = await TestBed.inject(StopIndex).search(SAMPLE_CITY, 'durak 1-', 3);
    expect(suggestions).toHaveLength(3);
    expect(catalog.stopsNear.calls).toHaveLength(0);
    await store.findNearby();
    expect(store.nearby().kind).toBe('ready');
    expect(catalog.stopsNear.calls).toHaveLength(0);
    expect(catalog.stop.calls).toHaveLength(0);
  });

  it('lists the installed cities when the city list cannot be loaded', async () => {
    const { catalog, manager, cities, network } = setup();
    await manager.download(CITY);
    catalog.cities.impl = async () => {
      throw offline();
    };
    network.set(false);
    await cities.load();
    expect(cities.status()).toBe('ready');
    expect(cities.fromPacks()).toBe(true);
    expect(cities.cities().map((c) => c.slug)).toEqual([CITY]);
    catalog.cities.impl = async () => [SAMPLE_CITY];
    TestBed.inject(ConnectivityService);
    network.set(true);
    TestBed.tick();
    await settle();
    expect(cities.fromPacks()).toBe(false);
  });
});

describe('map basemap from the pack', () => {
  @Component({
    imports: [MapComponent],
    template: `<iv-map [line]="line" [city]="city()" label="Hat" />`,
  })
  class Host {
    readonly line = [
      [34.01, 42.51],
      [34.05, 42.51],
    ];
    readonly city = signal<string | null>(CITY);
  }

  function library() {
    const probes: { url: string; source: unknown }[] = [];
    const lib: MapLibrary = {
      probeBasemap: async (url, _ms, source) => {
        probes.push({ url, source });
        return true;
      },
      createMap: () => ({
        on: () => undefined,
        setStyle: () => undefined,
        fitBounds: () => undefined,
        resize: () => undefined,
        remove: () => undefined,
        getCenter: () => ({ lng: 0, lat: 0 }),
      }),
    };
    return { lib, probes };
  }

  async function renderMap(network: FakeNetwork, withBasemap: boolean) {
    const { lib, probes } = library();
    const ctx = setup({
      network,
      imports: [Host],
      providers: [
        { provide: MAP_LIBRARY_LOADER, useValue: async () => lib },
        { provide: TILES_BASE_URL, useValue: 'https://tiles.test' },
      ],
    });
    if (withBasemap) {
      const tiles = fakePmtiles(100);
      ctx.catalog.tilesArchive.impl = async () => ({
        bytes: tiles,
        declaredLength: null,
        etag: null,
        contentType: null,
      });
      await ctx.manager.download(CITY);
    }
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    for (let i = 0; i < 4; i++) {
      await settle(fixture);
      fixture.detectChanges();
    }
    return { probes, ctx };
  }

  it('reads the installed basemap from the device', async () => {
    const { probes } = await renderMap(new FakeNetwork(), true);
    expect(probes).toHaveLength(1);
    expect(probes[0]?.url).toMatch(/^pmtiles:\/\/iv-pack\/ornek-test-sehri\/.+\.pmtiles$/);
    const source = probes[0]?.source as {
      getBytes(o: number, l: number): Promise<{ data: ArrayBuffer }>;
    };
    const head = await source.getBytes(0, 7);
    expect(new TextDecoder().decode(head.data)).toBe('PMTiles');
  });

  it('does not wait for the tiles host while offline without a basemap', async () => {
    const network = new FakeNetwork();
    network.connected = false;
    const { probes } = await renderMap(network, false);
    expect(probes).toEqual([]);
  });
});

describe('PacksPage', () => {
  async function render(catalog = fakeCatalog()) {
    const ctx = setup({ catalog });
    const fixture = TestBed.createComponent(PacksPage);
    fixture.detectChanges();
    await settle(fixture);
    fixture.detectChanges();
    return { ...ctx, fixture, el: fixture.nativeElement as HTMLElement };
  }

  const row = (el: HTMLElement) => el.querySelector(`[data-city="${CITY}"]`) as HTMLElement;
  const button = (el: HTMLElement, label: string) =>
    [...row(el).querySelectorAll('button')].find((b) => b.textContent?.trim() === label);

  it('refreshes catalog versions whenever the packs page is activated', async () => {
    const { fixture, catalog, cities } = await render();
    const calls = catalog.cities.calls.length;
    catalog.cities.impl = async () => [{ ...SAMPLE_CITY, pack_version: 9 }];
    fixture.componentInstance.ionViewWillEnter();
    await settle(fixture);
    expect(catalog.cities.calls.length).toBe(calls + 1);
    expect(cities.cities()[0]?.pack_version).toBe(9);
  });

  it('lists the city, downloads it and offers delete with a second tap', async () => {
    const { el, fixture, registry } = await render();
    expect(row(el).getAttribute('data-state')).toBe('none');
    expect(row(el).textContent).toContain('Yüklü değil');
    button(el, 'İndir')?.click();
    await settle(fixture);
    fixture.detectChanges();
    expect(registry.has(CITY)).toBe(true);
    expect(row(el).getAttribute('data-state')).toBe('installed');
    expect(row(el).textContent).toContain('Harita altlığı yok');
    button(el, 'Sil')?.click();
    fixture.detectChanges();
    expect(registry.has(CITY)).toBe(true);
    button(el, 'Silmek için yeniden dokun')?.click();
    await settle(fixture);
    fixture.detectChanges();
    expect(registry.has(CITY)).toBe(false);
  });

  it('explains the free city limit and points to Plus', async () => {
    const catalog = fakeCatalog();
    catalog.packBytes.impl = async () => {
      throw new ApiError('problem', 403, 'pack.entitlement_required', 'req-test');
    };
    const { el, fixture } = await render(catalog);
    button(el, 'İndir')?.click();
    await settle(fixture);
    fixture.detectChanges();
    expect(row(el).textContent).toContain('Ücretsiz planda 1 şehir');
    const link = [...row(el).querySelectorAll('a')].find(
      (a) => a.textContent?.trim() === 'Plus’a bak',
    );
    expect(link?.getAttribute('href')).toBe(`/plus?sehir=${CITY}`);
  });

  it('shows progress with a cancel button while downloading', async () => {
    const catalog = fakeCatalog();
    const gate = controllablePack();
    catalog.packBytes.impl = gate.impl;
    const { el, fixture, manager } = await render(catalog);
    button(el, 'İndir')?.click();
    await settle(fixture);
    fixture.detectChanges();
    const bar = row(el).querySelector('iv-progress-bar');
    expect(bar?.getAttribute('aria-valuenow')).not.toBeNull();
    button(el, 'Vazgeç')?.click();
    await settle(fixture);
    fixture.detectChanges();
    expect(manager.jobs().size).toBe(0);
    expect(row(el).getAttribute('data-state')).toBe('none');
  });
});
