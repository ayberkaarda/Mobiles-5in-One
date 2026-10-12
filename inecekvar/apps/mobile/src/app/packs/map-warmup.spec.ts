import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { catalogTesting, SAMPLE_CITY, settle } from '../testing/catalog.fixtures';
import { MAP_WARMUP, MAP_WARMUP_RUNTIME, MapWarmup, WarmupRuntime } from './map-warmup';
import { PackManager } from './pack-manager';
import { MemoryPackStorage } from './pack-storage';

class FakeRuntime implements WarmupRuntime {
  hasController = false;
  appVersion = 'app-one';
  stored: string | null = null;
  private readonly listeners = new Set<() => void>();
  controlled = () => this.hasController;
  version = () => this.appVersion;
  marker = () => this.stored;
  saveMarker = (version: string) => {
    this.stored = version;
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  activate(): void {
    this.listeners.forEach((listener) => listener());
  }
}

function setup(runtime: FakeRuntime, warm: () => Promise<void>, storage = new MemoryPackStorage()) {
  TestBed.configureTestingModule({
    providers: [
      ...catalogTesting({ packs: storage, warmup: warm }),
      { provide: MAP_WARMUP_RUNTIME, useValue: runtime },
    ],
  });
  return {
    manager: TestBed.inject(PackManager),
    warmer: TestBed.inject(MapWarmup),
    storage,
  };
}

describe('map asset warmup', () => {
  it('rejects warmup when a lazy map asset responds with an error', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: { baseURI: 'https://app.test/' } }],
    });
    const fetchFn = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith('/ngsw.json')) {
        return new Response(
          JSON.stringify({ assetGroups: [{ name: 'map', urls: ['/map.component-test.js'] }] }),
        );
      }
      return new Response('unavailable', { status: 503 });
    });
    vi.stubGlobal('fetch', fetchFn);
    try {
      await expect(TestBed.inject(MAP_WARMUP)()).rejects.toThrow('map asset unavailable');
      expect(fetchFn).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('defers warmup until a service worker controller appears', async () => {
    const runtime = new FakeRuntime();
    const warm = vi.fn(async () => undefined);
    const { manager, warmer } = setup(runtime, warm);
    await manager.download(SAMPLE_CITY.slug);
    expect(await warmer.ensure()).toBe(false);
    expect(warm).not.toHaveBeenCalled();
    runtime.hasController = true;
    runtime.activate();
    expect(await warmer.ensure()).toBe(true);
    expect(warm).toHaveBeenCalledTimes(1);
    expect(runtime.stored).toBe('app-one');
  });

  it('warms map assets again when the app version changes with a pack installed', async () => {
    const runtime = new FakeRuntime();
    runtime.hasController = true;
    const warm = vi.fn(async () => undefined);
    const { manager, warmer } = setup(runtime, warm);
    await manager.download(SAMPLE_CITY.slug);
    await warmer.ensure();
    runtime.appVersion = 'app-two';
    runtime.activate();
    await warmer.ensure();
    expect(warm).toHaveBeenCalledTimes(2);
    expect(runtime.stored).toBe('app-two');
  });

  it('retries a failed warmup without recording a successful version', async () => {
    const runtime = new FakeRuntime();
    runtime.hasController = true;
    let fail = true;
    const warm = vi.fn(async () => {
      if (fail) throw new Error('asset request failed');
    });
    const { manager, warmer } = setup(runtime, warm);
    await manager.download(SAMPLE_CITY.slug);
    await settle();
    expect(runtime.stored).toBeNull();
    const attempts = warm.mock.calls.length;
    fail = false;
    runtime.activate();
    expect(await warmer.ensure()).toBe(true);
    expect(warm.mock.calls.length).toBeGreaterThan(attempts);
    expect(runtime.stored).toBe('app-one');
  });

  it('warms an existing pack on activation after an uncontrolled installation', async () => {
    const runtime = new FakeRuntime();
    const warm = vi.fn(async () => undefined);
    const { manager, storage } = setup(runtime, warm);
    await manager.download(SAMPLE_CITY.slug);
    await settle();
    expect(warm).not.toHaveBeenCalled();
    TestBed.resetTestingModule();
    const reloaded = setup(runtime, warm, storage);
    await reloaded.warmer.ensure();
    runtime.hasController = true;
    runtime.activate();
    await vi.waitFor(() => expect(runtime.stored).toBe('app-one'));
    expect(warm).toHaveBeenCalledTimes(1);
    expect(await storage.list()).toHaveLength(1);
  });
});
