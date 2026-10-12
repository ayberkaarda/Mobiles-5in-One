import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { AccountApi, ApiError, CatalogApi, Favorite, SessionStore } from '@inecekvar/data-access';
import { isLineMode, LineMode } from '@inecekvar/domain';
import { PREFERENCE_STORE } from '../city/city.store';
import { mapPool } from '../shared/async-pool';
import { lineMode } from '../shared/format';
import { PREF_KEYS, readPref } from './local-prefs';

/** What the favourites tab needs to list a line without a network call. */
export interface FavoriteLine {
  city: string;
  slug: string;
  code: string;
  name: string;
  mode: LineMode;
  /** The API line id, needed to sync; entries saved by package 3C do not have it yet. */
  lineId?: string;
}

/** Guest favourites in Preferences (non-sensitive, ADR-0004). */
export const GUEST_FAVORITES_KEY = 'iv.favorites';
/**
 * Which guest entries were already copied into which account, so a favourite removed from the
 * account is not copied back on the next sign-in. Holds account ids and `city/slug` keys of
 * this device's own guest list only, never the account list.
 */
export const MERGED_FAVORITES_KEY = 'iv.favorites.merged';
export const MERGED_ACCOUNTS_KEY = 'iv.favorites.merge-accounts';
export const mergedFavoritesKey = (userId: string) =>
  `${MERGED_FAVORITES_KEY}.${encodeURIComponent(userId)}`;
const MAX_GUEST_FAVORITES = 200;
const MAX_MERGED_ACCOUNTS = 20;
const MAX_DESCRIPTIONS = 100;

function parseKeys(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(value)
      ? value.filter((key): key is string => typeof key === 'string')
      : [];
  } catch {
    return [];
  }
}

export type AccountListStatus = 'idle' | 'loading' | 'ready' | 'error';

export type MergeState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; added: number }
  | { kind: 'partial'; added: number; failed: number };

function isFavoriteLine(value: unknown): value is FavoriteLine {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['city'] === 'string' &&
    typeof v['slug'] === 'string' &&
    typeof v['code'] === 'string' &&
    typeof v['name'] === 'string' &&
    isLineMode(v['mode']) &&
    (v['lineId'] === undefined || typeof v['lineId'] === 'string')
  );
}

const keyOf = (line: Pick<FavoriteLine, 'city' | 'slug'>) => `${line.city}/${line.slug}`;

const sameLine = (a: Pick<FavoriteLine, 'city' | 'slug'>, b: Pick<FavoriteLine, 'city' | 'slug'>) =>
  a.city === b.city && a.slug === b.slug;

function entryOf(line: FavoriteLine): FavoriteLine {
  const entry: FavoriteLine = {
    city: line.city,
    slug: line.slug,
    code: line.code,
    name: line.name,
    mode: line.mode,
  };
  if (line.lineId) entry.lineId = line.lineId;
  return entry;
}

function parseLines(raw: string | null): FavoriteLine[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    // Entries from the 3A shell were bare sample slugs without a city; they are dropped.
    return Array.isArray(parsed) ? parsed.filter(isFavoriteLine).map(entryOf) : [];
  } catch {
    return [];
  }
}

function parseMerged(raw: string | null): Record<string, string[]> {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string[]> = {};
    for (const [user, keys] of Object.entries(parsed)) {
      if (Array.isArray(keys)) out[user] = keys.filter((k): k is string => typeof k === 'string');
    }
    return out;
  } catch {
    return {};
  }
}

const isGone = (error: unknown) => error instanceof ApiError && error.status === 404;

/**
 * Favourite lines (user story 7). Guests keep them on the device. Signed in, the list is the
 * account's (`GET me/favorites`), toggles call the API with an optimistic update and roll back
 * on failure, and on every sign-in the guest entries not yet copied into that account are
 * merged (`PUT me/favorites/{lineId}`, idempotent, one at a time, deduplicated against the
 * account list; a failed entry is retried on the next sign-in or by `retrySync`). The guest
 * list is never changed by signing in or out, and the account list lives in memory only: it is
 * dropped the moment the session changes, so it cannot show after sign-out or to another
 * account.
 */
@Injectable({ providedIn: 'root' })
export class FavoritesStore {
  private readonly prefs = inject(PREFERENCE_STORE);
  private readonly session = inject(SessionStore);
  private readonly accountApi = inject(AccountApi);
  private readonly catalog = inject(CatalogApi);

  private readonly guest = signal<readonly FavoriteLine[]>([]);
  private readonly account = signal<readonly FavoriteLine[] | null>(null);
  private readonly busyKeys = signal<ReadonlySet<string>>(new Set());
  private readonly guestRestored: Promise<void>;
  /** Line details known for the current account, by line id; dropped with the session. */
  private known = new Map<string, FavoriteLine>();
  private userId: string | null = null;
  private epoch = 0;
  private syncing: Promise<void> | null = null;
  private readonly queues = new Map<string, Promise<void>>();
  private storageQueue = Promise.resolve();
  private legacyMerged: Promise<void> | null = null;
  private readonly decisions = new Map<string, { version: number; on: boolean }>();
  private decisionVersion = 0;
  private journal: Map<string, { line: FavoriteLine; on: boolean }> | null = null;

  readonly accountStatus = signal<AccountListStatus>('idle');
  readonly merge = signal<MergeState>({ kind: 'idle' });
  /** Set when a signed-in toggle failed and was rolled back. */
  readonly toggleFailed = signal(false);
  readonly storageError = signal(false);

  readonly signedIn = this.session.isSignedIn;
  /** The guest list on this device, whatever the session. */
  readonly guestLines = this.guest.asReadonly();
  /** What the app shows: the account list when signed in, else the guest list. */
  readonly all = computed<readonly FavoriteLine[]>(() =>
    this.signedIn() ? (this.account() ?? []) : this.guest(),
  );
  readonly count = computed(() => this.all().length);

  constructor() {
    this.guestRestored = this.restoreGuest();
    effect(() => {
      const id = this.session.user()?.id ?? null;
      untracked(() => this.onUser(id));
    });
  }

  /** Resolves once the guest list has been read from storage. */
  ready(): Promise<void> {
    return this.guestRestored;
  }

  has(city: string, slug: string): boolean {
    return this.all().some((line) => sameLine(line, { city, slug }));
  }

  /** True while a signed-in toggle of this line waits for the API. */
  isBusy(city: string, slug: string): boolean {
    return this.busyKeys().has(keyOf({ city, slug }));
  }

  toggle(line: FavoriteLine): Promise<void> {
    return this.signedIn() ? this.toggleAccount(entryOf(line)) : this.toggleGuest(entryOf(line));
  }

  /** Reloads the account list and replays guest entries whose merge failed. */
  retrySync(): Promise<void> {
    const id = this.userId;
    if (id === null) return Promise.resolve();
    return this.sync(this.epoch, id);
  }

  /**
   * Account deletion: forgets what this device recorded about the account (its id and which
   * guest entries were copied into it). The account list itself lives in memory and went with
   * the session; the guest list belongs to the device and stays. Rejects when storage refused.
   */
  forgetAccount(userId: string): Promise<void> {
    // The legacy migration queues itself first, so the removal below runs after it.
    this.legacyMerged ??= this.migrateMerged();
    const work = this.storageQueue.then(async () => {
      await this.prefs.remove(mergedFavoritesKey(userId));
      const accounts = parseKeys(await this.readPref(MERGED_ACCOUNTS_KEY));
      if (accounts.includes(userId)) {
        await this.prefs.set(
          MERGED_ACCOUNTS_KEY,
          JSON.stringify(accounts.filter((id) => id !== userId)),
        );
      }
    });
    this.storageQueue = work.catch(() => undefined);
    return work;
  }

  private async toggleGuest(entry: FavoriteLine): Promise<void> {
    await this.guestRestored;
    await this.storeSerial(async () => {
      const lines = this.guest();
      const next = lines.some((l) => sameLine(l, entry))
        ? lines.filter((l) => !sameLine(l, entry))
        : [...lines, entry].slice(-MAX_GUEST_FAVORITES);
      this.guest.set(next);
      await this.prefs.set(GUEST_FAVORITES_KEY, JSON.stringify(next));
    });
  }

  private async toggleAccount(entry: FavoriteLine): Promise<void> {
    const key = keyOf(entry);
    if (this.busyKeys().has(key)) return;
    const epoch = this.epoch;
    const userId = this.userId;
    const current = () => this.isCurrent(epoch, userId);
    this.setBusy(key, true);
    this.toggleFailed.set(false);
    const wasOn = this.has(entry.city, entry.slug);
    const existing = this.account()?.find((l) => sameLine(l, entry));
    this.decisions.set(key, { version: ++this.decisionVersion, on: !wasOn });
    this.applyAccount(entry, !wasOn);
    await this.enqueue(key, async () => {
      if (!current()) return;
      try {
        const lineId = existing?.lineId ?? (await this.resolveId(entry));
        if (!current()) return;
        const withId: FavoriteLine = { ...entry, lineId };
        this.known.set(lineId, withId);
        // Optimistic: the star changes before the API answers.
        this.applyAccount(withId, !wasOn);
        try {
          if (!current()) return;
          if (wasOn) await this.accountApi.removeFavorite(lineId);
          else await this.accountApi.addFavorite(lineId);
          if (!current()) return;
        } catch (error) {
          if (!current()) return;
          // Removing a favourite that is already gone is the wanted end state.
          if (wasOn && isGone(error)) return;
          this.applyAccount(existing ?? withId, wasOn);
          this.toggleFailed.set(true);
        }
      } catch {
        if (current()) {
          this.applyAccount(existing ?? entry, wasOn);
          this.toggleFailed.set(true);
        }
      } finally {
        if (current()) this.setBusy(key, false);
      }
    });
  }

  private applyAccount(line: FavoriteLine, on: boolean): void {
    this.journal?.set(keyOf(line), { line, on });
    const lines = this.account() ?? [];
    const without = lines.filter((l) => !sameLine(l, line));
    this.account.set(on ? [...without, line] : without);
  }

  private setBusy(key: string, busy: boolean): void {
    const next = new Set(this.busyKeys());
    if (busy) next.add(key);
    else next.delete(key);
    this.busyKeys.set(next);
  }

  private onUser(id: string | null): void {
    if (id === this.userId) return;
    // Whatever belonged to the previous account goes first, before anything is awaited.
    this.epoch += 1;
    this.userId = id;
    this.account.set(null);
    this.known = new Map();
    this.journal = null;
    this.decisions.clear();
    this.syncing = null;
    this.busyKeys.set(new Set());
    this.merge.set({ kind: 'idle' });
    this.toggleFailed.set(false);
    this.accountStatus.set('idle');
    if (id !== null) void this.sync(this.epoch, id);
  }

  private sync(epoch: number, userId: string): Promise<void> {
    this.syncing ??= this.runSync(epoch, userId).finally(() => {
      if (epoch === this.epoch) this.syncing = null;
    });
    return this.syncing;
  }

  private async runSync(epoch: number, userId: string): Promise<void> {
    const current = () => this.isCurrent(epoch, userId);
    await this.guestRestored;
    if (!current()) return;
    this.accountStatus.set('loading');
    const journal = new Map<string, { line: FavoriteLine; on: boolean }>();
    this.journal = journal;
    let remote: Favorite[];
    try {
      remote = await this.accountApi.favorites();
    } catch {
      if (current()) {
        this.journal = null;
        this.accountStatus.set('error');
      }
      return;
    }
    if (!current()) return;
    for (const line of this.guest()) {
      if (line.lineId) this.known.set(line.lineId, line);
    }
    let unknown = 0;
    const listed = await mapPool(remote, 4, (fav) => {
      const resolve = this.known.has(fav.line_id) || unknown++ < MAX_DESCRIPTIONS;
      return current() ? this.describe(fav, resolve, current) : Promise.resolve(this.minimal(fav));
    });
    if (!current()) return;
    // Keep optimistic changes made while the list was loading.
    const reconciled = new Map(listed.map((line) => [keyOf(line), line]));
    for (const [key, change] of journal) {
      if (change.on) reconciled.set(key, change.line);
      else reconciled.delete(key);
    }
    this.journal = null;
    this.account.set([...reconciled.values()]);
    this.accountStatus.set('ready');
    await this.mergeGuest(epoch, userId, new Set(remote.map((f) => f.line_id)));
  }

  private async mergeGuest(epoch: number, userId: string, onAccount: Set<string>): Promise<void> {
    const current = () => this.isCurrent(epoch, userId);
    const started = this.decisionVersion;
    this.legacyMerged ??= this.migrateMerged();
    await this.legacyMerged;
    if (!current()) return;
    const stored = await this.readPref(mergedFavoritesKey(userId));
    if (!current()) return;
    const done = new Set(parseKeys(stored));
    const todo = this.guest().filter((line) => !done.has(keyOf(line)));
    if (!current()) return;
    if (todo.length === 0) {
      if (stored !== null) await this.writeMerged(userId, done);
      if (!current()) return;
      return;
    }
    this.merge.set({ kind: 'running' });
    let added = 0;
    let failed = 0;
    for (const line of todo) {
      if (!current()) return;
      await this.enqueue(keyOf(line), async () => {
        if (!current()) return;
        const decision = this.decisions.get(keyOf(line));
        if (decision && (!decision.on || decision.version > started)) {
          done.add(keyOf(line));
          return;
        }
        try {
          const lineId = line.lineId ?? (await this.resolveId(line));
          if (!current()) return;
          const latest = this.decisions.get(keyOf(line));
          if (latest && (!latest.on || latest.version > started)) {
            done.add(keyOf(line));
            return;
          }
          if (!onAccount.has(lineId)) {
            if (!current()) return;
            await this.accountApi.addFavorite(lineId);
            if (!current()) return;
            onAccount.add(lineId);
            added += 1;
            if (current()) {
              const withId = { ...line, lineId };
              this.known.set(lineId, withId);
              if (!this.account()?.some((l) => l.lineId === lineId)) {
                this.applyAccount(withId, true);
              }
            }
          }
          done.add(keyOf(line));
        } catch (error) {
          if (!current()) return;
          // A line that no longer exists cannot be merged; it is not tried again.
          if (isGone(error)) done.add(keyOf(line));
          else failed += 1;
        }
      });
      if (!current()) return;
      await this.writeMerged(userId, done);
      if (!current()) return;
    }
    if (current()) {
      this.merge.set(failed > 0 ? { kind: 'partial', added, failed } : { kind: 'done', added });
    }
  }

  private async writeMerged(userId: string, done: Set<string>): Promise<void> {
    const keys = [...done].slice(-MAX_GUEST_FAVORITES);
    await this.storeSerial(async () => {
      await this.prefs.set(mergedFavoritesKey(userId), JSON.stringify(keys));
      const accounts = parseKeys(await this.readPref(MERGED_ACCOUNTS_KEY));
      const next = [...accounts.filter((id) => id !== userId), userId];
      await this.prefs.set(MERGED_ACCOUNTS_KEY, JSON.stringify(next.slice(-MAX_MERGED_ACCOUNTS)));
      for (const id of next.slice(0, Math.max(0, next.length - MAX_MERGED_ACCOUNTS))) {
        await this.prefs.remove(mergedFavoritesKey(id));
      }
    });
  }

  private async migrateMerged(): Promise<void> {
    await this.storeSerial(async () => {
      const legacy = parseMerged(await this.readPref(MERGED_FAVORITES_KEY));
      const accounts = parseKeys(await this.readPref(MERGED_ACCOUNTS_KEY));
      const next = [...new Set([...Object.keys(legacy), ...accounts])];
      const retained = next.slice(-MAX_MERGED_ACCOUNTS);
      for (const id of retained) {
        const key = mergedFavoritesKey(id);
        if (legacy[id] && (await this.readPref(key)) === null) {
          await this.prefs.set(key, JSON.stringify(legacy[id].slice(-MAX_GUEST_FAVORITES)));
        }
      }
      if (Object.keys(legacy).length > 0) {
        await this.prefs.set(MERGED_ACCOUNTS_KEY, JSON.stringify(retained));
        await this.prefs.remove(MERGED_FAVORITES_KEY);
      }
    });
  }

  private isCurrent(epoch: number, userId: string | null): boolean {
    return (
      epoch === this.epoch && userId === this.userId && userId === (this.session.user()?.id ?? null)
    );
  }

  private enqueue(key: string, work: () => Promise<void>): Promise<void> {
    const pending = (this.queues.get(key) ?? Promise.resolve()).then(work);
    this.queues.set(key, pending);
    void pending.finally(() => {
      if (this.queues.get(key) === pending) this.queues.delete(key);
    });
    return pending;
  }

  private storeSerial(work: () => Promise<void>): Promise<void> {
    const pending = this.storageQueue.then(work).catch(() => this.storageError.set(true));
    this.storageQueue = pending;
    return pending;
  }

  /** The line id of a saved entry; entries from before sync carry only city and slug. */
  private async resolveId(line: Pick<FavoriteLine, 'city' | 'slug' | 'lineId'>): Promise<string> {
    if (line.lineId) return line.lineId;
    for (const known of this.known.values()) {
      if (sameLine(known, line) && known.lineId) return known.lineId;
    }
    return (await this.catalog.line(line.slug, line.city)).id;
  }

  /** Code, name and mode of an account favourite, from what is known or from the line page. */
  private async describe(
    fav: Favorite,
    resolve: boolean,
    current: () => boolean,
  ): Promise<FavoriteLine> {
    const known = this.known.get(fav.line_id);
    if (known) return { ...known, city: fav.city, slug: fav.slug, lineId: fav.line_id };
    if (!resolve) return this.minimal(fav);
    try {
      const line = await this.catalog.line(fav.slug, fav.city);
      const entry: FavoriteLine = {
        city: fav.city,
        slug: fav.slug,
        code: line.code,
        name: line.name,
        mode: lineMode(line.mode),
        lineId: fav.line_id,
      };
      if (current()) this.known.set(fav.line_id, entry);
      return entry;
    } catch {
      return this.minimal(fav);
    }
  }

  private minimal(fav: Favorite): FavoriteLine {
    return {
      city: fav.city,
      slug: fav.slug,
      code: fav.slug,
      name: fav.slug,
      mode: 'dolmus',
      lineId: fav.line_id,
    };
  }

  private async readPref(key: string): Promise<string | null> {
    try {
      return await this.prefs.get(key);
    } catch {
      return null;
    }
  }

  private async restoreGuest(): Promise<void> {
    let lines = parseLines(await this.readPref(GUEST_FAVORITES_KEY));
    if (lines === null) {
      // Package 3C kept guest favourites in localStorage; they move to Preferences once.
      const legacy = parseLines(readPref(PREF_KEYS.favorites));
      lines = (legacy ?? []).slice(-MAX_GUEST_FAVORITES);
      if (legacy !== null) {
        try {
          await this.prefs.set(GUEST_FAVORITES_KEY, JSON.stringify(lines));
        } catch {
          this.storageError.set(true);
        }
      }
    }
    const trimmed = lines.slice(-MAX_GUEST_FAVORITES);
    this.guest.set(trimmed);
    if (trimmed.length !== lines.length) {
      await this.storeSerial(() => this.prefs.set(GUEST_FAVORITES_KEY, JSON.stringify(trimmed)));
    }
  }
}
