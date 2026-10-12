import { TestBed } from '@angular/core/testing';
import { ApiError, LineDetail } from '@inecekvar/data-access';
import {
  catalogTesting,
  fakeAccount,
  FakeAccount,
  fakeCatalog,
  FakeCatalog,
  FakeSession,
  MemoryPreferences,
  notFound,
  SAMPLE_CITY,
  sampleLineDetail,
} from '../testing/catalog.fixtures';
import { deferred } from '../testing/deferred';
import {
  FavoriteLine,
  FavoritesStore,
  GUEST_FAVORITES_KEY,
  MERGED_ACCOUNTS_KEY,
  MERGED_FAVORITES_KEY,
  mergedFavoritesKey,
} from './favorites.store';
import { PREF_KEYS } from './local-prefs';

const city = SAMPLE_CITY.slug;
const line = (n: number, withId = true): FavoriteLine => ({
  city,
  slug: `ornek-hat-${n}`,
  code: `ORN-${n}`,
  name: `[ÖRNEK] Hat ORN-${n}`,
  mode: 'dolmus',
  ...(withId ? { lineId: `line-${n}` } : {}),
});

interface Setup {
  store: FavoritesStore;
  session: FakeSession;
  account: FakeAccount;
  catalog: FakeCatalog;
  prefs: MemoryPreferences;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function setup(guest: FavoriteLine[] = [], prefs = new MemoryPreferences()): Promise<Setup> {
  if (guest.length > 0) prefs.values.set(GUEST_FAVORITES_KEY, JSON.stringify(guest));
  const session = new FakeSession();
  const account = fakeAccount(session);
  const catalog = fakeCatalog();
  // Every sample line resolves to its id, as `GET lines/{slug}?city=` does.
  catalog.line.impl = async (slug: string, c: string): Promise<LineDetail> => {
    const n = /^ornek-hat-(\d)$/.exec(slug)?.[1];
    if (c !== city || !n || Number(n) > 3) throw notFound();
    return sampleLineDetail({
      id: `line-${n}`,
      slug,
      code: `ORN-${n}`,
      name: `[ÖRNEK] Hat ORN-${n}`,
    });
  };
  TestBed.configureTestingModule({
    providers: catalogTesting({ session, account, catalog, prefs }),
  });
  const store = TestBed.inject(FavoritesStore);
  await store.ready();
  await flush();
  return { store, session, account, catalog, prefs };
}

const slugs = (lines: readonly FavoriteLine[]) => lines.map((l) => l.slug).sort();

describe('FavoritesStore as a guest', () => {
  beforeEach(() => localStorage.clear());

  it('toggles favourites by city and slug and keeps them in Preferences', async () => {
    const { store, prefs, account } = await setup();
    await store.toggle(line(1));
    expect(store.has(city, 'ornek-hat-1')).toBe(true);
    expect(store.has('baska-sehir', 'ornek-hat-1')).toBe(false);
    expect(store.count()).toBe(1);
    expect(JSON.parse(prefs.values.get(GUEST_FAVORITES_KEY) ?? '[]')).toEqual([line(1)]);
    await store.toggle(line(1));
    expect(store.has(city, 'ornek-hat-1')).toBe(false);
    expect(account.addFavorite.calls).toHaveLength(0);
  });

  it('survives corrupt storage and drops entries it cannot read', async () => {
    const prefs = new MemoryPreferences();
    prefs.values.set(GUEST_FAVORITES_KEY, '{not json');
    expect((await setup([], prefs)).store.all()).toEqual([]);
    TestBed.resetTestingModule();
    const mixed = new MemoryPreferences();
    mixed.values.set(
      GUEST_FAVORITES_KEY,
      JSON.stringify(['ornek-hat-1', 3, line(1), { ...line(2), mode: 'roket' }]),
    );
    expect((await setup([], mixed)).store.all()).toEqual([line(1)]);
  });

  it('moves the 3C localStorage list into Preferences once', async () => {
    const legacy = { ...line(2, false) };
    localStorage.setItem(PREF_KEYS.favorites, JSON.stringify([legacy]));
    const { store, prefs } = await setup();
    expect(store.all()).toEqual([legacy]);
    expect(JSON.parse(prefs.values.get(GUEST_FAVORITES_KEY) ?? '[]')).toEqual([legacy]);
  });
});

describe('FavoritesStore signed in', () => {
  beforeEach(() => localStorage.clear());

  it('merges guest favourites into the account once, deduplicated', async () => {
    const { store, session, account, catalog } = await setup([line(1), line(3, false)]);
    account.server.set('user-a', new Set(['line-1', 'line-2']));
    session.signIn('user-a');
    await flush();
    // line-1 is already on the account: no PUT; line-3 had no id and was looked up first.
    expect(account.addFavorite.calls).toEqual([['line-3']]);
    expect(catalog.line.calls.some(([slug]) => slug === 'ornek-hat-3')).toBe(true);
    expect([...(account.server.get('user-a') ?? [])].sort()).toEqual([
      'line-1',
      'line-2',
      'line-3',
    ]);
    expect(slugs(store.all())).toEqual(['ornek-hat-1', 'ornek-hat-2', 'ornek-hat-3']);
    expect(store.all().find((l) => l.slug === 'ornek-hat-2')?.code).toBe('ORN-2');
    expect(store.merge()).toEqual({ kind: 'done', added: 1 });
    expect(store.accountStatus()).toBe('ready');

    // Signing in again replays nothing, even after the account dropped a merged line.
    account.server.get('user-a')?.delete('line-3');
    session.signOut();
    await flush();
    session.signIn('user-a');
    await flush();
    expect(account.addFavorite.calls).toHaveLength(1);
    expect(slugs(store.all())).toEqual(['ornek-hat-1', 'ornek-hat-2']);
  });

  it('keeps going after a failed entry and replays only that one', async () => {
    const { store, session, account, prefs } = await setup([line(1), line(2), line(3)]);
    const add = account.addFavorite.impl;
    account.addFavorite.impl = async (id: string) => {
      if (id === 'line-2') throw new ApiError('network', 0, 'network', 'req-test');
      return add(id);
    };
    session.signIn('user-a');
    await flush();
    expect(store.merge()).toEqual({ kind: 'partial', added: 2, failed: 1 });
    expect([...(account.server.get('user-a') ?? [])].sort()).toEqual(['line-1', 'line-3']);
    const merged: unknown = JSON.parse(prefs.values.get(mergedFavoritesKey('user-a')) ?? '[]');
    expect(merged).toEqual([`${city}/ornek-hat-1`, `${city}/ornek-hat-3`]);

    account.addFavorite.impl = add;
    account.addFavorite.calls.length = 0;
    await store.retrySync();
    await flush();
    expect(account.addFavorite.calls).toEqual([['line-2']]);
    expect(store.merge()).toEqual({ kind: 'done', added: 1 });
    expect(slugs(store.all())).toEqual(['ornek-hat-1', 'ornek-hat-2', 'ornek-hat-3']);
  });

  it('skips a guest line that no longer exists and does not retry it', async () => {
    const gone = { ...line(9, false) };
    const { store, session, account, prefs } = await setup([gone]);
    session.signIn('user-a');
    await flush();
    expect(account.addFavorite.calls).toHaveLength(0);
    expect(store.merge()).toEqual({ kind: 'done', added: 0 });
    expect(JSON.parse(prefs.values.get(mergedFavoritesKey('user-a')) ?? '[]')).toEqual([
      `${city}/ornek-hat-9`,
    ]);
  });

  it('never shows the account list after sign-out or to another account', async () => {
    const { store, session, account, prefs } = await setup([line(1)]);
    account.server.set('user-a', new Set(['line-2']));
    session.signIn('user-a');
    await flush();
    expect(slugs(store.all())).toEqual(['ornek-hat-1', 'ornek-hat-2']);

    session.signOut();
    TestBed.tick();
    // At once, before anything is awaited: the guest list, exactly as it was.
    expect(store.all()).toEqual([line(1)]);
    expect(store.has(city, 'ornek-hat-2')).toBe(false);
    expect(JSON.parse(prefs.values.get(GUEST_FAVORITES_KEY) ?? '[]')).toEqual([line(1)]);

    session.signIn('user-b');
    TestBed.tick();
    expect(store.all()).toEqual([]);
    await flush();
    expect(slugs(store.all())).toEqual(['ornek-hat-1']);
  });

  it('drops an account answer that arrives after sign-out', async () => {
    const { store, session, account } = await setup();
    let release: () => void = () => undefined;
    const list = account.favorites.impl;
    account.favorites.impl = () => {
      // The answer is user-a's list, computed now and delivered late.
      const answer = list();
      return new Promise((resolve) => {
        release = () => resolve(answer);
      });
    };
    account.server.set('user-a', new Set(['line-2']));
    session.signIn('user-a');
    await flush();
    expect(account.favorites.calls).toHaveLength(1);
    session.signOut();
    TestBed.tick();
    release();
    await flush();
    expect(store.all()).toEqual([]);
    expect(store.accountStatus()).toBe('idle');
    session.signIn('user-b');
    TestBed.tick();
    expect(store.all()).toEqual([]);
  });

  it('toggles on the account optimistically and rolls back on failure', async () => {
    const { store, session, account } = await setup();
    session.signIn('user-a');
    await flush();
    let fail: (error: unknown) => void = () => undefined;
    account.addFavorite.impl = () =>
      new Promise<void>((_, reject) => {
        fail = reject;
      });
    const toggling = store.toggle(line(2));
    await new Promise((resolve) => setTimeout(resolve));
    expect(store.has(city, 'ornek-hat-2')).toBe(true);
    expect(store.isBusy(city, 'ornek-hat-2')).toBe(true);
    // A second tap while the first is in flight is ignored.
    await store.toggle(line(2));
    expect(account.addFavorite.calls).toHaveLength(1);
    fail(new ApiError('http', 500, 'http.500', 'req-test'));
    await toggling;
    expect(store.has(city, 'ornek-hat-2')).toBe(false);
    expect(store.toggleFailed()).toBe(true);
    expect(store.guestLines()).toEqual([]);
  });

  it('removes from the account and treats an already removed line as removed', async () => {
    const { store, session, account } = await setup();
    account.server.set('user-a', new Set(['line-1']));
    session.signIn('user-a');
    await flush();
    account.removeFavorite.impl = async () => {
      throw notFound('favorite.not_found');
    };
    await store.toggle(line(1));
    expect(store.has(city, 'ornek-hat-1')).toBe(false);
    expect(store.toggleFailed()).toBe(false);
    expect(account.removeFavorite.calls).toEqual([['line-1']]);
  });

  it('shows an error state when the account list cannot be read and retries', async () => {
    const { store, session, account } = await setup();
    const list = account.favorites.impl;
    account.favorites.impl = async () => {
      throw new ApiError('network', 0, 'network', 'req-test');
    };
    session.signIn('user-a');
    await flush();
    expect(store.accountStatus()).toBe('error');
    account.favorites.impl = list;
    await store.retrySync();
    expect(store.accountStatus()).toBe('ready');
  });
});

describe('FavoritesStore concurrent changes', () => {
  beforeEach(() => localStorage.clear());

  it('migrates legacy merge records once without reimporting removed favorites', async () => {
    const prefs = new MemoryPreferences();
    prefs.values.set(MERGED_FAVORITES_KEY, JSON.stringify({ 'user-a': [`${city}/ornek-hat-1`] }));
    const { session, account, store } = await setup([line(1)], prefs);
    session.signIn('user-a');
    await flush();
    expect(account.addFavorite.calls).toEqual([]);
    expect(prefs.values.has(MERGED_FAVORITES_KEY)).toBe(false);
    expect(JSON.parse(prefs.values.get(mergedFavoritesKey('user-a')) ?? '[]')).toEqual([
      `${city}/ornek-hat-1`,
    ]);
    expect(store.all()).toEqual([]);
  });

  it('drops a previous account late line description before the next account reloads', async () => {
    const { session, store, account, catalog } = await setup();
    account.server.set('user-a', new Set(['line-1']));
    const detail = deferred<LineDetail>();
    catalog.line.impl = () => detail.promise;
    session.signIn('user-a');
    await flush();
    expect(catalog.line.calls).toHaveLength(1);
    session.signIn('user-b');
    await flush();
    detail.resolve(sampleLineDetail({ name: 'Previous account detail' }));
    await flush();
    expect(store.all()).toEqual([]);
    account.server.set('user-b', new Set(['line-1']));
    catalog.line.impl = async () => sampleLineDetail({ name: 'Current account detail' });
    await store.retrySync();
    expect(store.all()[0]?.name).toBe('Current account detail');
  });

  it('aborts a merge identity lookup when the account switches', async () => {
    const { store, session, account, catalog, prefs } = await setup([line(3, false)]);
    const lookup = deferred<LineDetail>();
    catalog.line.impl = () => lookup.promise;
    prefs.values.set(mergedFavoritesKey('user-b'), JSON.stringify([`${city}/ornek-hat-3`]));
    session.signIn('user-a');
    await flush();
    expect(catalog.line.calls).toHaveLength(1);
    session.signIn('user-b');
    TestBed.tick();
    lookup.resolve(sampleLineDetail({ id: 'line-3', slug: 'ornek-hat-3' }));
    await flush();
    expect(account.addFavorite.calls).toEqual([]);
    expect(store.all()).toEqual([]);
  });

  it('keeps a removal made while a stale account list is loading', async () => {
    const { store, session, account } = await setup();
    account.server.set('user-a', new Set(['line-1']));
    session.signIn('user-a');
    await flush();
    const list = account.favorites.impl;
    const gate = deferred<void>();
    account.favorites.impl = async () => {
      const snapshot = await list();
      await gate.promise;
      return snapshot;
    };
    const loading = store.retrySync();
    await flush();
    await store.toggle(line(1));
    gate.resolve();
    await loading;
    expect(store.has(city, line(1).slug)).toBe(false);
  });

  it('keeps new additions during loading and drops entries absent from the server', async () => {
    const { store, session, account } = await setup();
    account.server.set('user-a', new Set(['line-1']));
    session.signIn('user-a');
    await flush();
    account.server.get('user-a')?.clear();
    const gate = deferred<void>();
    account.favorites.impl = async () => {
      await gate.promise;
      return [];
    };
    const loading = store.retrySync();
    await flush();
    await store.toggle(line(2));
    gate.resolve();
    await loading;
    expect(slugs(store.all())).toEqual([line(2).slug]);
  });

  it('queues a merge behind a user delete and never puts the removed line back', async () => {
    const { store, session, account, prefs } = await setup([line(1)]);
    session.signIn('user-a');
    await flush();
    prefs.values.delete(mergedFavoritesKey('user-a'));
    prefs.values.delete(MERGED_FAVORITES_KEY);
    account.addFavorite.calls.length = 0;
    const deleted = deferred<void>();
    account.removeFavorite.impl = async (id) => {
      await deleted.promise;
      account.server.get('user-a')?.delete(id);
    };
    const removing = store.toggle(line(1));
    await flush();
    account.favorites.impl = async () => [];
    const merging = store.retrySync();
    await flush();
    deleted.resolve();
    await removing;
    await merging;
    expect(store.has(city, line(1).slug)).toBe(false);
    expect(account.addFavorite.calls).toEqual([]);
    expect(account.server.get('user-a')?.has('line-1')).toBe(false);
  });

  it('preserves both account merge records when preference writes interleave', async () => {
    const prefs = new MemoryPreferences();
    const first = deferred<void>();
    const set = prefs.set.bind(prefs);
    let held = false;
    prefs.set = async (key, value) => {
      if (!held && key.startsWith(MERGED_FAVORITES_KEY)) {
        held = true;
        await first.promise;
      }
      await set(key, value);
    };
    const { session, store } = await setup([line(1)], prefs);
    session.signIn('user-a');
    await flush();
    expect(held).toBe(true);
    session.signIn('user-b');
    await flush();
    first.resolve();
    await flush();
    await store.retrySync();
    expect(JSON.parse(prefs.values.get(mergedFavoritesKey('user-a')) ?? '[]')).toEqual([
      `${city}/ornek-hat-1`,
    ]);
    expect(JSON.parse(prefs.values.get(mergedFavoritesKey('user-b')) ?? '[]')).toEqual([
      `${city}/ornek-hat-1`,
    ]);
  });

  it('resolves at most four unknown favorites concurrently', async () => {
    const { session, store, account, catalog } = await setup();
    const gates: ReturnType<typeof deferred<LineDetail>>[] = [];
    let active = 0;
    let peak = 0;
    account.favorites.impl = async () =>
      Array.from({ length: 20 }, (_, n) => ({
        city,
        slug: `unknown-${n}`,
        line_id: `unknown-${n}`,
      }));
    catalog.line.impl = async () => {
      active++;
      peak = Math.max(peak, active);
      const gate = deferred<LineDetail>();
      gates.push(gate);
      try {
        return await gate.promise;
      } finally {
        active--;
      }
    };
    session.signIn('user-a');
    await flush();
    expect(gates).toHaveLength(4);
    for (let batch = 0; batch < 5; batch++) {
      gates.slice(batch * 4, batch * 4 + 4).forEach((gate) => gate.resolve(sampleLineDetail()));
      await flush();
    }
    expect(peak).toBe(4);
    expect(store.count()).toBe(20);
  });

  it('caps unknown favorite lookups at one hundred per load', async () => {
    const { session, store, account, catalog } = await setup();
    account.favorites.impl = async () =>
      Array.from({ length: 120 }, (_, n) => ({
        city,
        slug: `unknown-${n}`,
        line_id: `unknown-${n}`,
      }));
    catalog.line.impl = async () => sampleLineDetail();
    session.signIn('user-a');
    await flush();
    expect(catalog.line.calls).toHaveLength(100);
    expect(store.count()).toBe(120);
    expect(store.all()[119]?.code).toBe('unknown-119');
  });

  it('trims the oldest guest favorite beyond two hundred entries', async () => {
    const { store, prefs } = await setup(Array.from({ length: 200 }, (_, n) => line(n)));
    await store.toggle(line(200));
    expect(store.count()).toBe(200);
    expect(store.has(city, line(0).slug)).toBe(false);
    expect(store.has(city, line(200).slug)).toBe(true);
    expect(JSON.parse(prefs.values.get(GUEST_FAVORITES_KEY) ?? '[]')).toHaveLength(200);
  });

  it('trims the least recently merged account beyond twenty records', async () => {
    const prefs = new MemoryPreferences();
    const accounts = Array.from({ length: 20 }, (_, n) => `old-${n}`);
    prefs.values.set(MERGED_ACCOUNTS_KEY, JSON.stringify(accounts));
    accounts.forEach((id) => prefs.values.set(mergedFavoritesKey(id), '[]'));
    const { session } = await setup([line(1)], prefs);
    session.signIn('user-a');
    await flush();
    expect(prefs.values.has(mergedFavoritesKey('old-0'))).toBe(false);
    expect(JSON.parse(prefs.values.get(MERGED_ACCOUNTS_KEY) ?? '[]')).toEqual([
      ...accounts.slice(1),
      'user-a',
    ]);
  });

  it('signals a rejected favorites preference write', async () => {
    const { store, prefs } = await setup();
    prefs.set = async () => {
      throw new Error('quota');
    };
    await store.toggle(line(1));
    expect(store.storageError()).toBe(true);
    expect(store.has(city, line(1).slug)).toBe(true);
  });

  it('clears account state on a switch and ignores its late list', async () => {
    const { session, store, account } = await setup();
    account.server.set('user-a', new Set(['line-1']));
    session.signIn('user-a');
    await flush();
    const gate = deferred<void>();
    account.favorites.impl = async () => {
      const id = session.user()?.id;
      if (id === 'user-a') await gate.promise;
      return id === 'user-a' ? [{ city, slug: line(1).slug, line_id: 'line-1' }] : [];
    };
    const loading = store.retrySync();
    await flush();
    session.signIn('user-b');
    TestBed.tick();
    expect(store.all()).toEqual([]);
    gate.resolve();
    await loading;
    await flush();
    expect(store.all()).toEqual([]);
  });
});
