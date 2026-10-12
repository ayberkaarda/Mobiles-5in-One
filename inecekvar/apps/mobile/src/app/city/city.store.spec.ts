import { TestBed } from '@angular/core/testing';
import { City } from '@inecekvar/data-access';
import { ConnectivityService } from '../shared/connectivity.service';
import { deferred } from '../testing/pack.fakes';
import {
  catalogTesting,
  fakeCatalog,
  MemoryPreferences,
  offline,
  SAMPLE_CITY,
} from '../testing/catalog.fixtures';
import { CITY_PREF_KEY, CityStore } from './city.store';

function setup(prefs = new MemoryPreferences(), catalog = fakeCatalog()) {
  TestBed.configureTestingModule({ providers: catalogTesting({ prefs, catalog }) });
  return { store: TestBed.inject(CityStore), prefs, catalog };
}

describe('CityStore', () => {
  it('refreshes catalog versions on reconnect even when the list came from the API', async () => {
    const { store, catalog } = setup();
    await store.init();
    const connectivity = TestBed.inject(ConnectivityService);
    await Promise.resolve();
    connectivity.online.set(false);
    TestBed.tick();
    expect(store.fromPacks()).toBe(false);
    catalog.cities.impl = async () => [{ ...SAMPLE_CITY, pack_version: 5 }];
    connectivity.online.set(true);
    TestBed.tick();
    await Promise.resolve();
    expect(catalog.cities.calls).toHaveLength(2);
    expect(store.cities()[0]?.pack_version).toBe(5);
  });

  it('ignores an older catalog response that arrives after a newer refresh', async () => {
    const { store, catalog } = setup();
    const first = deferred<City[]>();
    let calls = 0;
    catalog.cities.impl = () => {
      calls++;
      return calls === 1 ? first.promise : Promise.resolve([{ ...SAMPLE_CITY, pack_version: 7 }]);
    };
    const slow = store.load();
    await store.load();
    first.resolve([{ ...SAMPLE_CITY, pack_version: 2 }]);
    await slow;
    expect(store.cities()[0]?.pack_version).toBe(7);
  });

  it('starts without a city, loads the list and stores a choice in Preferences', async () => {
    const { store, prefs } = setup();
    await store.init();
    expect(store.restored()).toBe(true);
    expect(store.status()).toBe('ready');
    expect(store.cities()).toEqual([SAMPLE_CITY]);
    expect(store.selected()).toBeNull();

    await store.select(SAMPLE_CITY.slug);
    expect(store.selected()?.name).toBe('[ÖRNEK] Test Şehri');
    expect(prefs.values.get(CITY_PREF_KEY)).toBe(SAMPLE_CITY.slug);
  });

  it('restores the stored city and runs init once', async () => {
    const prefs = new MemoryPreferences();
    prefs.values.set(CITY_PREF_KEY, SAMPLE_CITY.slug);
    const { store, catalog } = setup(prefs);
    await Promise.all([store.init(), store.init()]);
    expect(store.selectedSlug()).toBe(SAMPLE_CITY.slug);
    expect(store.selected()?.is_sample).toBe(true);
    expect(catalog.cities.calls).toHaveLength(1);
  });

  it('drops a stored slug the API does not know and ignores malformed values', async () => {
    const prefs = new MemoryPreferences();
    prefs.values.set(CITY_PREF_KEY, 'kaybolan-sehir');
    const { store } = setup(prefs);
    await store.init();
    expect(store.selectedSlug()).toBeNull();
    expect(prefs.values.has(CITY_PREF_KEY)).toBe(false);

    await store.select('../../etc');
    expect(store.selectedSlug()).toBeNull();
  });

  it('keeps the restored slug when the list fails and recovers on reload', async () => {
    const prefs = new MemoryPreferences();
    prefs.values.set(CITY_PREF_KEY, SAMPLE_CITY.slug);
    const catalog = fakeCatalog();
    const working = catalog.cities.impl;
    catalog.cities.impl = async () => Promise.reject(offline());
    const { store } = setup(prefs, catalog);
    await store.init();
    expect(store.status()).toBe('error');
    expect(store.error()?.kind).toBe('network');
    expect(store.selectedSlug()).toBe(SAMPLE_CITY.slug);

    catalog.cities.impl = working;
    await store.load();
    expect(store.status()).toBe('ready');
    expect(store.selected()?.slug).toBe(SAMPLE_CITY.slug);
  });

  it('survives storage that throws', async () => {
    const prefs = new MemoryPreferences();
    prefs.get = () => Promise.reject(new Error('blocked'));
    prefs.set = () => Promise.reject(new Error('blocked'));
    const { store } = setup(prefs);
    await store.init();
    expect(store.restored()).toBe(true);
    await store.select(SAMPLE_CITY.slug);
    expect(store.selectedSlug()).toBe(SAMPLE_CITY.slug);
  });
});
