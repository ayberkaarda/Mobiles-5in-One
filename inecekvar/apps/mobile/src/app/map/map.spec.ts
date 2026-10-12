import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TILES_BASE_URL } from '@inecekvar/data-access';
import type { StyleSpecification } from 'maplibre-gl';
import { ThemeService } from '../core/theme.service';
import { i18nTesting } from '../testing/i18n.testing';
import {
  createMapLibrary,
  CreateMapOptions,
  MAP_LIBRARY_LOADER,
  MapHandle,
  MapLibrary,
  workerUrlFor,
} from './map-library';
import { BASEMAP_PROBE_MS, basemapUrlFor, MapComponent } from './map.component';
import { boundsOf, buildMapStyle, DARK_PALETTE, LIGHT_PALETTE } from './map-style';

const LINE = [
  [34.01, 42.51],
  [34.05, 42.51],
  [34.09, 42.51],
];

class FakeMap implements MapHandle {
  readonly listeners = new Map<string, ((event: { sourceId?: string }) => void)[]>();
  readonly styles: StyleSpecification[] = [];
  removed = false;
  constructor(readonly options: CreateMapOptions) {
    this.styles.push(options.style);
  }
  on(type: string, listener: (event: { sourceId?: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    return this;
  }
  emit(type: string, event: { sourceId?: string } = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  setStyle(style: StyleSpecification) {
    this.styles.push(style);
    return this;
  }
  resize() {
    return this;
  }
  remove() {
    this.removed = true;
  }
}

class FakeLibrary implements MapLibrary {
  maps: FakeMap[] = [];
  probes: string[] = [];
  basemap = true;
  failCreate = false;
  async probeBasemap(url: string) {
    this.probes.push(url);
    return this.basemap;
  }
  createMap(options: CreateMapOptions) {
    if (this.failCreate) throw new Error('WebGL unavailable');
    const map = new FakeMap(options);
    this.maps.push(map);
    return map;
  }
}

@Component({
  imports: [MapComponent],
  template: `@if (shown()) {
    <iv-map [line]="line()" [stops]="line()" [city]="city()" label="Hat ORN-1" />
  }`,
})
class HostComponent {
  readonly shown = signal(true);
  readonly line = signal<number[][]>(LINE);
  readonly city = signal<string | null>('ornek-test-sehri');
}

async function settle(fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) {
  for (let i = 0; i < 4; i++) {
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }
}

function render(library = new FakeLibrary(), loader?: () => Promise<MapLibrary>) {
  localStorage.clear();
  TestBed.configureTestingModule({
    imports: [HostComponent, i18nTesting()],
    providers: [
      { provide: MAP_LIBRARY_LOADER, useValue: loader ?? (async () => library) },
      { provide: TILES_BASE_URL, useValue: 'https://tiles.test/' },
    ],
  });
  const fixture = TestBed.createComponent(HostComponent);
  return { fixture, library, el: fixture.nativeElement as HTMLElement };
}

describe('MapComponent', () => {
  it('shows the route sketch while loading, then the map with the basemap', async () => {
    const { fixture, library, el } = render();
    fixture.detectChanges();
    expect(el.querySelector('iv-route-sketch path.route')).not.toBeNull();
    await settle(fixture);
    expect(library.probes).toEqual(['pmtiles://https://tiles.test/ornek-test-sehri.pmtiles']);
    const map = library.maps[0];
    expect(map?.options.bounds).toEqual([
      [34.01, 42.51],
      [34.09, 42.51],
    ]);
    expect(map?.options.style.sources['basemap']).toBeDefined();
    expect(el.querySelector('iv-map')?.getAttribute('data-status')).toBe('loading');
    map?.emit('load');
    await settle(fixture);
    expect(el.querySelector('iv-map')?.getAttribute('data-status')).toBe('ready');
    expect(el.querySelector('.iv-map-attribution')?.textContent).toContain('OpenStreetMap');
  });

  it('draws the route on a plain background when the tiles are unreachable', async () => {
    const library = new FakeLibrary();
    library.basemap = false;
    const { fixture, el } = render(library);
    await settle(fixture);
    const style = library.maps[0]?.options.style;
    expect(style?.sources['basemap']).toBeUndefined();
    expect(style?.layers.map((l) => l.id)).toEqual([
      'background',
      'route-casing',
      'route',
      'stops',
    ]);
    library.maps[0]?.emit('load');
    await settle(fixture);
    expect(el.querySelector('iv-map')?.getAttribute('data-status')).toBe('no-basemap');
    expect(el.querySelector('.iv-map-note')?.textContent).toContain('Harita altlığı yüklenemedi');
  });

  it('falls back to the sketch when the map cannot start', async () => {
    const library = new FakeLibrary();
    library.failCreate = true;
    const { fixture, el } = render(library);
    await settle(fixture);
    expect(el.querySelector('iv-map')?.getAttribute('data-status')).toBe('failed');
    expect(el.querySelector('iv-route-sketch')).not.toBeNull();
    expect(el.querySelector('.iv-map-note')?.textContent).toContain('taslağı');
  });

  it('falls back when the map chunk cannot load', async () => {
    const { fixture, el } = render(undefined, () => Promise.reject(new Error('chunk')));
    await settle(fixture);
    expect(el.querySelector('iv-map')?.getAttribute('data-status')).toBe('failed');
  });

  it('switches to the dark style with the theme and removes the map on destroy', async () => {
    const { fixture, library } = render();
    await settle(fixture);
    const map = library.maps[0];
    if (!map) throw new Error('no map');
    expect(map.styles).toHaveLength(1);
    TestBed.inject(ThemeService).set('dark');
    await settle(fixture);
    expect(map.styles).toHaveLength(2);
    const background = map.styles[1]?.layers[0];
    expect(background?.type === 'background' && background.paint?.['background-color']).toBe(
      DARK_PALETTE.background,
    );
    TestBed.inject(ThemeService).set('light');
    fixture.componentInstance.shown.set(false);
    await settle(fixture);
    expect(map.removed).toBe(true);
  });

  it('skips the basemap without a city and centres a single stop', async () => {
    const { fixture, library } = render();
    fixture.componentInstance.city.set(null);
    fixture.componentInstance.line.set([[34.05, 42.53]]);
    await settle(fixture);
    expect(library.probes).toEqual([]);
    expect(library.maps[0]?.options.center).toEqual([34.05, 42.53]);
    expect(library.maps[0]?.options.zoom).toBe(15);
  });
});

describe('createMapLibrary', () => {
  function fakeModules(header: () => Promise<unknown>) {
    const added: unknown[] = [];
    const maps: unknown[] = [];
    const maplibre = {
      setWorkerUrl: vi.fn(),
      addProtocol: vi.fn(),
      Map: vi.fn(function (this: unknown, options: unknown) {
        maps.push(options);
      }),
    };
    const pmtiles = {
      Protocol: vi.fn(function (this: { tile: string; add: (p: unknown) => void }) {
        this.tile = 'tile-handler';
        this.add = (p) => added.push(p);
      }),
      PMTiles: vi.fn(function (
        this: { url: string; getHeader: () => Promise<unknown> },
        url: string,
      ) {
        this.url = url;
        this.getHeader = header;
      }),
    };
    return { maplibre, pmtiles, added, maps };
  }

  it('registers one pmtiles protocol and the worker URL, keyless', () => {
    const m = fakeModules(async () => ({}));
    createMapLibrary(m.maplibre as never, m.pmtiles as never, workerUrlFor('https://app.test/'));
    expect(m.maplibre.setWorkerUrl).toHaveBeenCalledWith(
      'https://app.test/maplibre/maplibre-gl-worker.mjs',
    );
    expect(m.maplibre.addProtocol).toHaveBeenCalledWith('pmtiles', 'tile-handler');
  });

  it('serves a readable archive and refuses an unreachable or slow one', async () => {
    vi.useFakeTimers();
    try {
      const ok = fakeModules(async () => ({ tileType: 1 }));
      const lib = createMapLibrary(ok.maplibre as never, ok.pmtiles as never, 'w');
      await expect(lib.probeBasemap('pmtiles://https://t/x.pmtiles', 100)).resolves.toBe(true);
      expect(ok.pmtiles.PMTiles).toHaveBeenCalledWith('https://t/x.pmtiles');
      expect(ok.added).toHaveLength(1);

      const down = fakeModules(() => Promise.reject(new TypeError('Failed to fetch')));
      const lib2 = createMapLibrary(down.maplibre as never, down.pmtiles as never, 'w');
      await expect(lib2.probeBasemap('u', 100)).resolves.toBe(false);
      expect(down.added).toHaveLength(0);

      const slow = fakeModules(() => new Promise(() => undefined));
      const lib3 = createMapLibrary(slow.maplibre as never, slow.pmtiles as never, 'w');
      const pending = lib3.probeBasemap('u', BASEMAP_PROBE_MS);
      vi.advanceTimersByTime(BASEMAP_PROBE_MS);
      await expect(pending).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('creates maps without attribution control, rotation or scroll zoom', () => {
    const m = fakeModules(async () => ({}));
    const lib = createMapLibrary(m.maplibre as never, m.pmtiles as never, 'w');
    const container = document.createElement('div');
    const style = buildMapStyle({
      palette: LIGHT_PALETTE,
      basemapUrl: null,
      line: LINE,
      stops: [],
    });
    lib.createMap({
      container,
      style,
      bounds: [
        [1, 2],
        [3, 4],
      ],
    });
    expect(m.maps[0]).toMatchObject({
      container,
      attributionControl: false,
      dragRotate: false,
      scrollZoom: false,
      bounds: [
        [1, 2],
        [3, 4],
      ],
    });
  });
});

describe('map style', () => {
  it('builds the basemap layers only with a basemap and never needs glyphs or keys', () => {
    const withBase = buildMapStyle({
      palette: LIGHT_PALETTE,
      basemapUrl: basemapUrlFor('https://tiles.test', 'ornek-test-sehri'),
      line: LINE,
      stops: LINE,
    });
    expect(withBase.glyphs).toBeUndefined();
    expect(withBase.sprite).toBeUndefined();
    expect(JSON.stringify(withBase)).not.toMatch(/key=|token=/i);
    expect(withBase.layers.map((l) => l.id)).toContain('roads-major');
    const route = withBase.sources['route'];
    expect(route?.type === 'geojson' && JSON.stringify(route.data)).toContain('LineString');
  });

  it('computes bounds and ignores broken coordinates', () => {
    expect(boundsOf([])).toBeNull();
    expect(
      boundsOf([
        [1, 2],
        [NaN, 5],
        [3, 0],
      ]),
    ).toEqual([
      [1, 0],
      [3, 2],
    ]);
  });
});
