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
import {
  FavoriteLine,
  FavoritesStore,
  GUEST_FAVORITES_KEY,
  MERGED_FAVORITES_KEY,
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
    const merged = JSON.parse(prefs.values.get(MERGED_FAVORITES_KEY) ?? '{}');
    expect(merged['user-a'].sort()).toEqual([`${city}/ornek-hat-1`, `${city}/ornek-hat-3`]);

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
    expect(JSON.parse(prefs.values.get(MERGED_FAVORITES_KEY) ?? '{}')['user-a']).toEqual([
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
