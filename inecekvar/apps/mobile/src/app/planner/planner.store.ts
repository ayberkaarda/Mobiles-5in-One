import {
  computed,
  DestroyRef,
  effect,
  inject,
  Injectable,
  InjectionToken,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { ApiError, CatalogApi, LineDetail, PlanResult, SessionStore } from '@inecekvar/data-access';
import { CityStore } from '../city/city.store';
import { LanguageService } from '../core/language.service';
import { CatalogSource } from '../packs/catalog-source';
import { StopIndex } from '../search/stop-index';
import { SEARCH_DEBOUNCE_MS } from '../search/search.store';
import { ConnectivityService } from '../shared/connectivity.service';
import { debounced } from '../shared/debounced';
import { inBbox } from '../shared/format';
import { LOCATION_SOURCE } from '../shared/location';
import { Itinerary, itineraryPath, PathSegment } from './itinerary';
import {
  MaxTransfers,
  Place,
  PlanEnd,
  PlanFormError,
  toPlanRequest,
  validatePlanForm,
} from './plan-form';

/** Milliseconds since the epoch; tests replace it to drive the Retry-After countdown. */
export const PLANNER_NOW = new InjectionToken<() => number>('PLANNER_NOW', {
  providedIn: 'root',
  factory: () => () => Date.now(),
});

export type PlannerView =
  | 'no-city'
  | 'idle'
  | 'loading'
  | 'results'
  | 'empty'
  | 'degraded'
  | 'rate-limited'
  | 'offline'
  | 'outside-city'
  | 'error';

export type LocateProblem = 'denied' | 'unavailable' | 'outside-city';

type RequestState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; result: PlanResult }
  | { kind: 'failed'; error: unknown };

const SUGGESTION_LIMIT = 6;

const isOffline = (error: unknown) =>
  error instanceof ApiError && (error.kind === 'network' || error.kind === 'timeout');

/**
 * State of the Planla tab: two trip ends (a stop from the city data, a tap on the map or the
 * device position), the transfer limit, the `POST plan` request and its outcome, the selected
 * itinerary and its map segments. A 429 starts a countdown from `Retry-After` during which the
 * form does not send; `degraded: true` from the API (ADR-0020: the search timed out) is shown
 * as such, with or without itineraries.
 */
@Injectable()
export class PlannerStore {
  private readonly api = inject(CatalogApi);
  private readonly source = inject(CatalogSource);
  private readonly cities = inject(CityStore);
  private readonly session = inject(SessionStore);
  private readonly identity = computed(() => this.session.user()?.id ?? null);
  private readonly stopIndex = inject(StopIndex);
  private readonly connectivity = inject(ConnectivityService);
  private readonly location = inject(LOCATION_SOURCE);
  private readonly i18n = inject(LanguageService);
  private readonly now = inject(PLANNER_NOW);
  private readonly lineCache = new Map<string, Promise<LineDetail>>();
  private run = 0;
  private locationVersion = 0;
  private contextVersion = 0;
  private abort: AbortController | null = null;
  private ticker: ReturnType<typeof setInterval> | undefined;

  readonly from = signal<Place | null>(null);
  readonly to = signal<Place | null>(null);
  readonly fromText = signal('');
  readonly toText = signal('');
  readonly maxTransfers = signal<MaxTransfers>(2);
  /** The end a map tap fills; `null` fills the first empty end. */
  readonly pickTarget = signal<PlanEnd | null>(null);
  readonly locating = signal<PlanEnd | null>(null);
  readonly locateProblem = signal<{ end: PlanEnd; problem: LocateProblem } | null>(null);
  /** Shown after a submit attempt; cleared when the form changes. */
  readonly formError = signal<PlanFormError | null>(null);
  readonly selected = signal(0);
  private readonly request = signal<RequestState>({ kind: 'idle' });
  private readonly retryAt = signal<number | null>(null);
  private readonly clock = signal(this.now());
  private readonly lineStops = signal<ReadonlyMap<string, LineDetail['stops']>>(new Map());

  private readonly fromQuery = debounced(this.fromText, inject(SEARCH_DEBOUNCE_MS));
  private readonly toQuery = debounced(this.toText, inject(SEARCH_DEBOUNCE_MS));

  private readonly fromSuggestions = this.suggestionResource(this.fromQuery, this.from);
  private readonly toSuggestions = this.suggestionResource(this.toQuery, this.to);

  readonly result = computed(() => {
    const state = this.request();
    return state.kind === 'done' ? state.result : null;
  });
  readonly itineraries = computed<readonly Itinerary[]>(() => this.result()?.itineraries ?? []);
  readonly degraded = computed(() => this.result()?.degraded ?? false);
  readonly error = computed(() => {
    const state = this.request();
    return state.kind === 'failed' ? state.error : null;
  });
  readonly loading = computed(() => this.request().kind === 'loading');

  /** Whole seconds left before the API accepts another plan; 0 when not limited. */
  readonly retryIn = computed(() => {
    const at = this.retryAt();
    return at === null ? 0 : Math.max(0, Math.ceil((at - this.clock()) / 1000));
  });

  readonly selectedItinerary = computed<Itinerary | null>(
    () => this.itineraries()[this.selected()] ?? null,
  );

  readonly segments = computed<PathSegment[]>(() => {
    const itinerary = this.selectedItinerary();
    const from = this.from();
    const to = this.to();
    if (!itinerary || !from || !to) return [];
    const stops = this.lineStops();
    return itineraryPath(itinerary, from, to, (slug) => stops.get(slug));
  });

  readonly canSubmit = computed(
    () => this.from() !== null && this.to() !== null && !this.loading() && this.retryIn() === 0,
  );

  readonly view = computed<PlannerView>(() => {
    if (this.cities.selectedSlug() === null) return 'no-city';
    const state = this.request();
    switch (state.kind) {
      case 'loading':
        return 'loading';
      case 'done':
        if (state.result.itineraries.length > 0) return 'results';
        return state.result.degraded ? 'degraded' : 'empty';
      case 'failed': {
        const error = state.error;
        if (error instanceof ApiError && error.status === 429) return 'rate-limited';
        if (isOffline(error) || !this.connectivity.online()) return 'offline';
        if (error instanceof ApiError && error.code === 'plan.outside_city') return 'outside-city';
        return 'error';
      }
      default:
        return this.connectivity.online() ? 'idle' : 'offline';
    }
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      clearInterval(this.ticker);
      this.abort?.abort();
    });
    // Ends and results belong to the city they were chosen in.
    effect(() => {
      this.cities.selectedSlug();
      this.identity();
      untracked(() => this.reset());
    });
    // The selected itinerary is drawn along its lines' stops once they are known.
    effect(() => {
      const itinerary = this.selectedItinerary();
      const city = this.cities.selectedSlug();
      if (itinerary && city) untracked(() => this.loadLineStops(itinerary, city));
    });
  }

  suggestions(end: PlanEnd) {
    const source = end === 'from' ? this.fromSuggestions : this.toSuggestions;
    return source.hasValue() ? (source.value() ?? []) : [];
  }

  setText(end: PlanEnd, value: string): void {
    (end === 'from' ? this.fromText : this.toText).set(value);
    // Typing replaces whatever place was chosen for this end.
    this.placeOf(end).set(null);
    this.changed();
  }

  choose(end: PlanEnd, place: Place): void {
    this.placeOf(end).set(place);
    (end === 'from' ? this.fromText : this.toText).set(this.labelOf(place));
    if (this.pickTarget() === end) this.pickTarget.set(null);
    this.changed();
  }

  chooseStop(end: PlanEnd, stop: { name: string; location: readonly number[] }): void {
    const [lng = NaN, lat = NaN] = stop.location;
    this.choose(end, { source: 'stop', label: stop.name, lng, lat });
  }

  /** A tap on the map fills the end being picked, else the first empty end. */
  pickOnMap([lng, lat]: [number, number]): void {
    const end = this.pickTarget() ?? (this.from() === null ? 'from' : 'to');
    this.choose(end, { source: 'map', label: '', lng, lat });
  }

  async useMyLocation(end: PlanEnd): Promise<void> {
    const version = ++this.locationVersion;
    const city = this.cities.selected();
    this.locating.set(end);
    this.locateProblem.set(null);
    const fix = await this.location.locate();
    if (version !== this.locationVersion || this.locating() !== end) return;
    this.locating.set(null);
    if (fix.kind !== 'ok') {
      this.locateProblem.set({ end, problem: fix.kind });
      return;
    }
    if (city && !inBbox([fix.lng, fix.lat], city.bbox)) {
      this.locateProblem.set({ end, problem: 'outside-city' });
      return;
    }
    this.choose(end, { source: 'gps', label: '', lng: fix.lng, lat: fix.lat });
  }

  swap(): void {
    const [from, to] = [this.from(), this.to()];
    const [fromText, toText] = [this.fromText(), this.toText()];
    this.from.set(to);
    this.to.set(from);
    this.fromText.set(toText);
    this.toText.set(fromText);
    this.changed();
  }

  setMaxTransfers(value: MaxTransfers): void {
    this.maxTransfers.set(value);
    this.changed();
  }

  select(index: number): void {
    if (index >= 0 && index < this.itineraries().length) this.selected.set(index);
  }

  /** The form's first problem, as it would be checked on submit. */
  validate(): PlanFormError | null {
    return validatePlanForm(this.formInput());
  }

  async submit(): Promise<void> {
    const input = this.formInput();
    const problem = validatePlanForm(input);
    this.formError.set(problem);
    const body = toPlanRequest(input);
    if (problem !== null || body === null || this.retryIn() > 0 || this.loading()) return;
    const run = ++this.run;
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    this.selected.set(0);
    if (!this.connectivity.online()) {
      this.request.set({ kind: 'failed', error: ApiError.noResponse('network', 'offline') });
      return;
    }
    this.request.set({ kind: 'loading' });
    try {
      const result = await this.api.plan(body, abort.signal);
      if (run === this.run) this.request.set({ kind: 'done', result });
    } catch (error) {
      if (run !== this.run) return;
      if (error instanceof ApiError && error.kind === 'aborted') return;
      this.request.set({ kind: 'failed', error });
      if (error instanceof ApiError && error.status === 429) {
        this.startCountdown(error.retryAfterSeconds ?? 60);
      }
    }
  }

  private formInput() {
    return {
      city: this.cities.selected(),
      from: this.from(),
      to: this.to(),
      maxTransfers: this.maxTransfers(),
    };
  }

  private startCountdown(seconds: number): void {
    this.clock.set(this.now());
    this.retryAt.set(this.now() + seconds * 1000);
    clearInterval(this.ticker);
    this.ticker = setInterval(() => {
      this.clock.set(this.now());
      if (this.retryIn() === 0) {
        clearInterval(this.ticker);
        this.ticker = undefined;
      }
    }, 1000);
  }

  private changed(): void {
    this.locationVersion++;
    this.locating.set(null);
    this.formError.set(null);
    this.locateProblem.set(null);
    this.run++;
    this.abort?.abort();
    if (this.request().kind !== 'idle' && !(this.view() === 'rate-limited' && this.retryIn() > 0)) {
      this.request.set({ kind: 'idle' });
    }
  }

  private reset(): void {
    this.contextVersion++;
    clearInterval(this.ticker);
    this.retryAt.set(null);
    this.request.set({ kind: 'idle' });
    this.selected.set(0);
    this.from.set(null);
    this.to.set(null);
    this.fromText.set('');
    this.toText.set('');
    this.pickTarget.set(null);
    this.locating.set(null);
    this.lineStops.set(new Map());
    this.lineCache.clear();
    this.changed();
  }

  private placeOf(end: PlanEnd) {
    return end === 'from' ? this.from : this.to;
  }

  private labelOf(place: Place): string {
    if (place.source === 'stop') return place.label;
    return this.i18n.t(place.source === 'gps' ? 'planner.myLocation' : 'planner.mapPoint');
  }

  private loadLineStops(itinerary: Itinerary, city: string): void {
    const context = this.contextVersion;
    for (const leg of itinerary.legs) {
      if (leg.kind !== 'ride' || this.lineStops().has(leg.line_slug)) continue;
      const key = `${city}/${leg.line_slug}`;
      let pending = this.lineCache.get(key);
      if (!pending) {
        pending = this.source.line(leg.line_slug, city);
        this.lineCache.set(key, pending);
        pending.then(
          (line) => {
            if (context !== this.contextVersion || this.cities.selectedSlug() !== city) return;
            const next = new Map(this.lineStops());
            next.set(leg.line_slug, line.stops);
            this.lineStops.set(next);
          },
          // Without the line's stops the ride is drawn as a straight segment.
          () => {
            if (context === this.contextVersion) this.lineCache.delete(key);
          },
        );
      }
    }
  }

  private suggestionResource(query: () => string, place: () => Place | null) {
    return resource({
      params: () => {
        const city = this.cities.selected();
        const q = query().trim();
        const userId = this.identity();
        return city && q.length >= 2 && place() === null ? { city, q, userId } : undefined;
      },
      loader: ({ params }) => this.stopIndex.search(params.city, params.q, SUGGESTION_LIMIT),
    });
  }
}
