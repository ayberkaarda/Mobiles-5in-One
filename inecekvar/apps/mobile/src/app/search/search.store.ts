import {
  computed,
  effect,
  inject,
  Injectable,
  InjectionToken,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { ApiError, CatalogApi, LineListItem, StopSummary } from '@inecekvar/data-access';
import { LineMode } from '@inecekvar/domain';
import { CityStore } from '../city/city.store';
import { ConnectivityService } from '../shared/connectivity.service';
import { debounced } from '../shared/debounced';
import { distanceMeters, inBbox } from '../shared/format';
import { LOCATION_SOURCE } from '../shared/location';
import { StopIndex } from './stop-index';

export type ModeFilter = LineMode | 'all';

/** Typing pause before a search goes out. */
export const SEARCH_DEBOUNCE_MS = new InjectionToken<number>('SEARCH_DEBOUNCE_MS', {
  providedIn: 'root',
  factory: () => 300,
});

/** The API accepts 1 to 80 characters in `q`. */
export const MAX_QUERY_LENGTH = 80;
const NEARBY_RADIUS_M = 800;
const NEARBY_STOPS = 5;

export type SearchView = 'no-city' | 'loading' | 'offline' | 'error' | 'empty' | 'results';

export interface NearbyLine {
  line: { slug: string; code: string; name: string; mode: string };
  stopName: string;
  distanceM: number;
}

export type NearbyState =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'loading' }
  | { kind: 'denied' }
  | { kind: 'unavailable' }
  | { kind: 'error'; offline: boolean }
  | { kind: 'ready'; lines: NearbyLine[] };

const isOfflineError = (error: unknown) =>
  error instanceof ApiError && (error.kind === 'network' || error.kind === 'timeout');

/**
 * State of the Ara tab: a debounced query and a mode filter over the lines of the selected
 * city (`GET lines?city=&q=`), stop names from the interim stop index, and nearby lines from
 * one foreground location fix (`GET stops/near`, then each stop's lines).
 */
@Injectable()
export class SearchStore {
  private readonly api = inject(CatalogApi);
  private readonly cities = inject(CityStore);
  private readonly stopIndex = inject(StopIndex);
  private readonly connectivity = inject(ConnectivityService);
  private readonly location = inject(LOCATION_SOURCE);
  private nearbyRun = 0;

  readonly query = signal('');
  readonly mode = signal<ModeFilter>('all');
  private readonly debouncedQuery = debounced(this.query, inject(SEARCH_DEBOUNCE_MS));
  /** The query as sent: debounced, trimmed and cut to the API limit. */
  readonly term = computed(() => this.debouncedQuery().trim().slice(0, MAX_QUERY_LENGTH));
  readonly nearby = signal<NearbyState>({ kind: 'idle' });

  private readonly linesResource = resource({
    params: () => {
      const city = this.cities.selectedSlug();
      return city ? { city, q: this.term() } : undefined;
    },
    loader: ({ params, abortSignal }) =>
      this.api.lines({ city: params.city, q: params.q || undefined, limit: 100 }, abortSignal),
  });

  private readonly stopsResource = resource({
    params: () => {
      const city = this.cities.selected();
      const q = this.term();
      return city && q.length >= 2 ? { city, q } : undefined;
    },
    loader: ({ params }) => this.stopIndex.search(params.city, params.q),
  });

  readonly lines = computed<readonly LineListItem[]>(() => {
    const lines = this.linesResource.hasValue() ? this.linesResource.value() : [];
    const mode = this.mode();
    return mode === 'all' ? lines : lines.filter((line) => line.mode === mode);
  });

  readonly stops = computed<readonly StopSummary[]>(() =>
    this.stopsResource.hasValue() ? (this.stopsResource.value() ?? []) : [],
  );

  readonly error = computed<unknown>(() => this.linesResource.error() ?? null);
  readonly rateLimited = computed(() => {
    const error = this.error();
    return error instanceof ApiError && error.kind === 'rate_limited';
  });

  readonly view = computed<SearchView>(() => {
    if (this.cities.selectedSlug() === null) return 'no-city';
    const error = this.error();
    if (error) return !this.connectivity.online() || isOfflineError(error) ? 'offline' : 'error';
    if (this.linesResource.isLoading() && !this.linesResource.hasValue()) return 'loading';
    if (this.lines().length > 0 || this.stops().length > 0) return 'results';
    return this.linesResource.isLoading() ? 'loading' : 'empty';
  });

  constructor() {
    // Coming back online retries a search that failed for lack of a connection.
    effect(() => {
      if (this.connectivity.online() && untracked(() => this.view()) === 'offline') this.retry();
    });
    // A nearby result belongs to the city it was computed for.
    effect(() => {
      this.cities.selectedSlug();
      untracked(() => {
        this.nearbyRun++;
        this.nearby.set({ kind: 'idle' });
      });
    });
  }

  setQuery(value: string | null | undefined): void {
    this.query.set(value ?? '');
  }

  clear(): void {
    this.query.set('');
    this.mode.set('all');
  }

  retry(): void {
    this.linesResource.reload();
    this.stopsResource.reload();
  }

  async findNearby(): Promise<void> {
    const city = this.cities.selected();
    const slug = this.cities.selectedSlug();
    if (!slug) return;
    const run = ++this.nearbyRun;
    const current = () => run === this.nearbyRun;
    this.nearby.set({ kind: 'locating' });
    const fix = await this.location.locate();
    if (!current()) return;
    if (fix.kind !== 'ok') {
      this.nearby.set({ kind: fix.kind });
      return;
    }
    this.nearby.set({ kind: 'loading' });
    const here = [fix.lng, fix.lat];
    try {
      const near = await this.api.stopsNear({
        lat: fix.lat,
        lng: fix.lng,
        radius: NEARBY_RADIUS_M,
      });
      // `stops/near` is not scoped to a city; keep the selected city's stops only.
      const candidates = near
        .filter((stop) => !city || inBbox(stop.location, city.bbox))
        .slice(0, NEARBY_STOPS);
      const details = await Promise.allSettled(candidates.map((s) => this.api.stop(s.slug, slug)));
      if (!current()) return;
      const seen = new Set<string>();
      const lines: NearbyLine[] = [];
      details.forEach((result, i) => {
        const stop = candidates[i];
        if (result.status !== 'fulfilled' || !stop) return;
        for (const line of result.value.lines) {
          if (seen.has(line.slug)) continue;
          seen.add(line.slug);
          lines.push({ line, stopName: stop.name, distanceM: distanceMeters(here, stop.location) });
        }
      });
      // A 404 is a stop of another city; any other failure with nothing to show is an error.
      const failed = details.find(
        (r): r is PromiseRejectedResult =>
          r.status === 'rejected' && !(r.reason instanceof ApiError && r.reason.status === 404),
      );
      if (lines.length === 0 && failed) throw failed.reason;
      this.nearby.set({ kind: 'ready', lines });
    } catch (error) {
      if (current()) {
        this.nearby.set({
          kind: 'error',
          offline: !this.connectivity.online() || isOfflineError(error),
        });
      }
    }
  }
}
