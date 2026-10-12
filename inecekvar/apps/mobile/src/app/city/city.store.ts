import {
  computed,
  effect,
  inject,
  Injectable,
  InjectionToken,
  signal,
  untracked,
} from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { ApiError, CatalogApi, City } from '@inecekvar/data-access';
import { PackRegistry } from '../packs/pack-registry';
import { ConnectivityService } from '../shared/connectivity.service';

/** Key/value storage for non-sensitive settings (ADR-0004: Preferences is not secure storage). */
export interface PreferenceStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Capacitor Preferences: SharedPreferences / UserDefaults natively, localStorage on the web. */
export const capacitorPreferenceStore: PreferenceStore = {
  get: async (key) => (await Preferences.get({ key })).value,
  set: (key, value) => Preferences.set({ key, value }),
  remove: (key) => Preferences.remove({ key }),
};

export const PREFERENCE_STORE = new InjectionToken<PreferenceStore>('PREFERENCE_STORE', {
  providedIn: 'root',
  factory: () => capacitorPreferenceStore,
});

/**
 * Cities usable without the API (those with an installed pack). Kept behind a token so the
 * city store does not depend on the pack layer.
 */
export const OFFLINE_CITIES = new InjectionToken<() => Promise<City[]>>('OFFLINE_CITIES', {
  providedIn: 'root',
  factory: () => {
    const registry = inject(PackRegistry);
    return () => registry.offlineCities();
  },
});

export const CITY_PREF_KEY = 'iv.city';
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type CityListStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * The selected city and the list of cities. The slug is restored from Preferences before the
 * list arrives, so line searches can start at once; a slug the API no longer knows is dropped
 * when the list loads.
 */
@Injectable({ providedIn: 'root' })
export class CityStore {
  private readonly api = inject(CatalogApi);
  private readonly prefs = inject(PREFERENCE_STORE);
  private readonly offlineCities = inject(OFFLINE_CITIES);
  private readonly connectivity = inject(ConnectivityService);
  private initOnce: Promise<void> | null = null;

  /** True while the list shows only the cities of installed packs (the API was unreachable). */
  readonly fromPacks = signal(false);

  readonly cities = signal<readonly City[]>([]);
  readonly status = signal<CityListStatus>('idle');
  readonly error = signal<ApiError | null>(null);
  /** True once the stored choice has been read (or found missing). */
  readonly restored = signal(false);
  readonly selectedSlug = signal<string | null>(null);
  readonly selected = computed(
    () => this.cities().find((city) => city.slug === this.selectedSlug()) ?? null,
  );

  /** Restores the stored choice and loads the list; later calls reuse the first run. */
  constructor() {
    // Back online after a pack-only list: fetch the full list again.
    effect(() => {
      if (this.connectivity.online() && untracked(() => this.fromPacks())) void this.load();
    });
  }

  init(): Promise<void> {
    this.initOnce ??= this.restore().then(() => this.load());
    return this.initOnce;
  }

  async load(): Promise<void> {
    this.status.set('loading');
    this.error.set(null);
    try {
      const cities = await this.api.cities();
      this.cities.set(cities);
      this.fromPacks.set(false);
      this.status.set('ready');
      const slug = this.selectedSlug();
      if (slug !== null && !cities.some((city) => city.slug === slug)) await this.clear();
    } catch (error) {
      // Without the API the installed packs still name their cities; the stored choice is
      // kept either way, since an unreachable API says nothing about the city.
      const offline = await this.offlineCities().catch(() => [] as City[]);
      if (offline.length > 0) {
        this.cities.set(offline);
        this.fromPacks.set(true);
        this.status.set('ready');
        return;
      }
      this.error.set(error instanceof ApiError ? error : null);
      this.status.set('error');
    }
  }

  async select(slug: string): Promise<void> {
    if (!SLUG.test(slug)) return;
    this.selectedSlug.set(slug);
    try {
      await this.prefs.set(CITY_PREF_KEY, slug);
    } catch {
      // The choice still holds for this session.
    }
  }

  async clear(): Promise<void> {
    this.selectedSlug.set(null);
    try {
      await this.prefs.remove(CITY_PREF_KEY);
    } catch {
      // Nothing stored to clean up.
    }
  }

  private async restore(): Promise<void> {
    try {
      const stored = await this.prefs.get(CITY_PREF_KEY);
      if (stored !== null && SLUG.test(stored) && this.selectedSlug() === null) {
        this.selectedSlug.set(stored);
      }
    } catch {
      // Unreadable storage behaves like a first start.
    } finally {
      this.restored.set(true);
    }
  }
}
