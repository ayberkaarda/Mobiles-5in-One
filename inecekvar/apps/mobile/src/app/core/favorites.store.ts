import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { AccountApi, ApiError, CatalogApi, Favorite, SessionStore } from '@inecekvar/data-access';
import { isLineMode, LineMode } from '@inecekvar/domain';
import { PREFERENCE_STORE } from '../city/city.store';
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

  readonly accountStatus = signal<AccountListStatus>('idle');
  readonly merge = signal<MergeState>({ kind: 'idle' });
  /** Set when a signed-in toggle failed and was rolled back. */
  readonly toggleFailed = signal(false);

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

  private async toggleGuest(entry: FavoriteLine): Promise<void> {
    await this.guestRestored;
    const lines = this.guest();
    const next = lines.some((l) => sameLine(l, entry))
      ? lines.filter((l) => !sameLine(l, entry))
      : [...lines, entry];
    this.guest.set(next);
    try {
      await this.prefs.set(GUEST_FAVORITES_KEY, JSON.stringify(next));
    } catch {
      // The change still holds for this session.
    }
  }

  private async toggleAccount(entry: FavoriteLine): Promise<void> {
    const key = keyOf(entry);
    if (this.busyKeys().has(key)) return;
    const epoch = this.epoch;
    const current = () => epoch === this.epoch;
    this.setBusy(key, true);
    this.toggleFailed.set(false);
    const wasOn = this.has(entry.city, entry.slug);
    const existing = this.account()?.find((l) => sameLine(l, entry));
    try {
      const lineId = existing?.lineId ?? (await this.resolveId(entry));
      if (!current()) return;
      const withId: FavoriteLine = { ...entry, lineId };
      this.known.set(lineId, withId);
      // Optimistic: the star changes before the API answers.
      this.applyAccount(withId, !wasOn);
      try {
        if (wasOn) await this.accountApi.removeFavorite(lineId);
        else await this.accountApi.addFavorite(lineId);
      } catch (error) {
        if (!current()) return;
        // Removing a favourite that is already gone is the wanted end state.
        if (wasOn && isGone(error)) return;
        this.applyAccount(existing ?? withId, wasOn);
        this.toggleFailed.set(true);
      }
    } catch {
      if (current()) this.toggleFailed.set(true);
    } finally {
      if (current()) this.setBusy(key, false);
    }
  }

  private applyAccount(line: FavoriteLine, on: boolean): void {
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
    const current = () => epoch === this.epoch;
    await this.guestRestored;
    if (!current()) return;
    this.accountStatus.set('loading');
    let remote: Favorite[];
    try {
      remote = await this.accountApi.favorites();
    } catch {
      if (current()) this.accountStatus.set('error');
      return;
    }
    if (!current()) return;
    for (const line of this.guest()) {
      if (line.lineId) this.known.set(line.lineId, line);
    }
    const listed = await Promise.all(remote.map((fav) => this.describe(fav)));
    if (!current()) return;
    // Keep optimistic changes made while the list was loading.
    const pending = (this.account() ?? []).filter((l) => !listed.some((r) => sameLine(r, l)));
    this.account.set([...listed, ...pending]);
    this.accountStatus.set('ready');
    await this.mergeGuest(epoch, userId, new Set(remote.map((f) => f.line_id)));
  }

  private async mergeGuest(epoch: number, userId: string, onAccount: Set<string>): Promise<void> {
    const current = () => epoch === this.epoch;
    const mergedAll = parseMerged(await this.readPref(MERGED_FAVORITES_KEY));
    const done = new Set(mergedAll[userId] ?? []);
    const todo = this.guest().filter((line) => !done.has(keyOf(line)));
    if (todo.length === 0 || !current()) return;
    this.merge.set({ kind: 'running' });
    let added = 0;
    let failed = 0;
    for (const line of todo) {
      if (!current()) return;
      try {
        const lineId = line.lineId ?? (await this.resolveId(line));
        if (!onAccount.has(lineId)) {
          await this.accountApi.addFavorite(lineId);
          onAccount.add(lineId);
          added += 1;
          if (current()) {
            const withId = { ...line, lineId };
            this.known.set(lineId, withId);
            if (!this.account()?.some((l) => l.lineId === lineId)) this.applyAccount(withId, true);
          }
        }
        done.add(keyOf(line));
      } catch (error) {
        // A line that no longer exists cannot be merged; it is not tried again.
        if (isGone(error)) done.add(keyOf(line));
        else failed += 1;
      }
      await this.writeMerged(userId, done);
    }
    if (current()) {
      this.merge.set(failed > 0 ? { kind: 'partial', added, failed } : { kind: 'done', added });
    }
  }

  private async writeMerged(userId: string, done: Set<string>): Promise<void> {
    const all = parseMerged(await this.readPref(MERGED_FAVORITES_KEY));
    all[userId] = [...done];
    try {
      await this.prefs.set(MERGED_FAVORITES_KEY, JSON.stringify(all));
    } catch {
      // Without storage the merge is simply replayed; PUT is idempotent.
    }
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
  private async describe(fav: Favorite): Promise<FavoriteLine> {
    const known = this.known.get(fav.line_id);
    if (known) return { ...known, city: fav.city, slug: fav.slug, lineId: fav.line_id };
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
      this.known.set(fav.line_id, entry);
      return entry;
    } catch {
      return {
        city: fav.city,
        slug: fav.slug,
        code: fav.slug,
        name: fav.slug,
        mode: 'dolmus',
        lineId: fav.line_id,
      };
    }
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
      lines = legacy ?? [];
      if (legacy !== null) {
        try {
          await this.prefs.set(GUEST_FAVORITES_KEY, JSON.stringify(lines));
        } catch {
          // Read again from localStorage next time.
        }
      }
    }
    this.guest.set(lines);
  }
}
