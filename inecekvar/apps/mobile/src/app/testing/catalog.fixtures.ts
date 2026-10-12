import { computed, Provider, signal } from '@angular/core';
import {
  AccountApi,
  ApiBytes,
  BytesOptions,
  ApiError,
  CatalogApi,
  ContributionApi,
  Edit,
  EditProposal,
  Favorite,
  Me,
  SessionStore,
  City,
  LineDetail,
  LineListItem,
  PlanResult,
  PresignedUpload,
  PresignRequest,
  StopDetail,
  StopSummary,
  TILES_BASE_URL,
  TraceCreated,
  TraceUpload,
} from '@inecekvar/data-access';
import { PREFERENCE_STORE, PreferenceStore } from '../city/city.store';
import { CityPackData } from '../packs/pack-data';
import { MAP_WARMUP } from '../packs/pack-manager';
import { MAP_WARMUP_RUNTIME, WarmupRuntime } from '../packs/map-warmup';
import { MemoryPackStorage, PackStorage } from '../packs/pack-storage';
import { PACK_STORAGE } from '../packs/pack-storage.provider';
import { NETWORK_SOURCE, NetworkSource } from '../shared/connectivity.service';
import { LOCATION_SOURCE, LocateResult } from '../shared/location';
import { SEARCH_DEBOUNCE_MS } from '../search/search.store';

/**
 * API-shaped fixtures mirroring `api/app/seed/sample_city.py` (`[ÖRNEK] Test Şehri`). They exist
 * for tests only; the app reads the same data from the API.
 */
export const SAMPLE_CITY: City = {
  name: '[ÖRNEK] Test Şehri',
  slug: 'ornek-test-sehri',
  is_sample: true,
  bbox: [34.0, 42.5, 34.1, 42.58],
  centroid: [34.05, 42.54],
  timezone: 'Europe/Istanbul',
  pack_version: 0,
  published_line_count: 3,
};

const point = (row: number, col: number): number[] => [
  34.01 + (col - 1) * 0.02,
  42.51 + (row - 1) * 0.02,
];

export function sampleStop(row: number, col: number): StopSummary {
  return {
    id: `stop-${row}-${col}`,
    slug: `ornek-durak-${row}-${col}`,
    name: `[ÖRNEK] Durak ${row}-${col}`,
    kind: (row === 2 && col === 2) || (row === 4 && col === 4) ? 'informal' : 'formal',
    location: point(row, col),
  };
}

export const SAMPLE_LINES: LineListItem[] = [
  { id: 'line-1', slug: 'ornek-hat-1', code: 'ORN-1', name: '[ÖRNEK] Hat ORN-1', mode: 'dolmus' },
  { id: 'line-2', slug: 'ornek-hat-2', code: 'ORN-2', name: '[ÖRNEK] Hat ORN-2', mode: 'minibus' },
  { id: 'line-3', slug: 'ornek-hat-3', code: 'ORN-3', name: '[ÖRNEK] Hat ORN-3', mode: 'servis' },
];

export function sampleLineDetail(overrides: Partial<LineDetail> = {}): LineDetail {
  const stops = [1, 2, 3, 4, 5].map((col) => sampleStop(1, col));
  return {
    id: 'line-1',
    slug: 'ornek-hat-1',
    code: 'ORN-1',
    name: '[ÖRNEK] Hat ORN-1',
    mode: 'dolmus',
    status: 'published',
    version_no: 1,
    published_at: '2026-10-12T08:15:58Z',
    geometry: { type: 'LineString', coordinates: stops.map((s) => s.location) },
    stops,
    fare_minor: 2500,
    fare_updated_at: '2026-10-01T09:00:00Z',
    hours_text: '[ÖRNEK] 06:00-23:00',
    payment_methods: ['nakit'],
    hail_notes: null,
    last_verified_at: null,
    contributor_count: 0,
    ...overrides,
  };
}

export function sampleStopDetail(overrides: Partial<StopDetail> = {}): StopDetail {
  return {
    ...sampleStop(1, 5),
    lines: [
      { slug: 'ornek-hat-1', code: 'ORN-1', name: '[ÖRNEK] Hat ORN-1', mode: 'dolmus' },
      { slug: 'ornek-hat-3', code: 'ORN-3', name: '[ÖRNEK] Hat ORN-3', mode: 'servis' },
    ],
    ...overrides,
  };
}

const planStop = (row: number, col: number) => {
  const stop = sampleStop(row, col);
  return { slug: stop.slug, name: stop.name, location: stop.location as [number, number] };
};

/** A planner answer in the sample city: one transfer, then a direct option. */
export function samplePlan(overrides: Partial<PlanResult> = {}): PlanResult {
  return {
    city: SAMPLE_CITY.slug,
    degraded: false,
    itineraries: [
      {
        legs: [
          { kind: 'walk', metres: 84, from_stop: null, to_stop: planStop(1, 1) },
          {
            kind: 'ride',
            line_id: 'line-1',
            line_slug: 'ornek-hat-1',
            line_code: 'ORN-1',
            line_name: '[ÖRNEK] Hat ORN-1',
            board_stop: planStop(1, 1),
            alight_stop: planStop(1, 3),
            stop_count: 2,
          },
          { kind: 'walk', metres: 218, from_stop: planStop(1, 3), to_stop: planStop(2, 3) },
          {
            kind: 'ride',
            line_id: 'line-2',
            line_slug: 'ornek-hat-2',
            line_code: 'ORN-2',
            line_name: '[ÖRNEK] Hat ORN-2',
            board_stop: planStop(2, 3),
            alight_stop: planStop(3, 3),
            stop_count: 1,
          },
          { kind: 'walk', metres: 41, from_stop: planStop(3, 3), to_stop: null },
        ],
        transfers: 1,
        walk_m: 343,
        ride_stops: 3,
        estimated_fare_minor: 5000,
      },
      {
        legs: [
          {
            kind: 'ride',
            line_id: 'line-3',
            line_slug: 'ornek-hat-3',
            line_code: 'ORN-3',
            line_name: '[ÖRNEK] Hat ORN-3',
            board_stop: planStop(1, 1),
            alight_stop: planStop(3, 3),
            stop_count: 6,
          },
        ],
        transfers: 0,
        walk_m: 0,
        ride_stops: 6,
        estimated_fare_minor: null,
      },
    ],
    ...overrides,
  };
}

/** A format 1 pack of the sample city, as `GET cities/{slug}/pack` returns it. */
export function samplePackData(packVersion = 1): CityPackData {
  const stops = [1, 2, 3, 4].flatMap((row) => [1, 2, 3, 4, 5].map((col) => sampleStop(row, col)));
  const routes: Record<string, [number, number][]> = {
    'ornek-hat-1': [1, 2, 3, 4, 5].map((col) => [1, col] as [number, number]),
    'ornek-hat-2': [1, 2, 3, 4].map((row) => [row, 3] as [number, number]),
    'ornek-hat-3': [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ],
  };
  return {
    city: {
      name: SAMPLE_CITY.name,
      slug: SAMPLE_CITY.slug,
      is_sample: true,
      bbox: [...SAMPLE_CITY.bbox],
      centroid: [...SAMPLE_CITY.centroid],
      timezone: SAMPLE_CITY.timezone,
    },
    pack_version: packVersion,
    format: 1,
    lines: SAMPLE_LINES.map((line) => {
      const cells = routes[line.slug] ?? [];
      return {
        slug: line.slug,
        code: line.code,
        name: line.name,
        mode: line.mode,
        version_no: 1,
        published_at: '2026-10-12T08:15:58Z',
        geometry: cells.map(([r, c]) => sampleStop(r, c).location),
        stops: cells.map(([r, c]) => sampleStop(r, c).slug),
        fare_minor: 2500,
        fare_updated_at: '2026-10-01T09:00:00Z',
        hours_text: '[ÖRNEK] 06:00-23:00',
        payment_methods: ['nakit'],
        hail_notes: null,
        last_verified_at: null,
        contributor_count: 0,
      };
    }),
    stops: stops.map((s) => ({ slug: s.slug, name: s.name, kind: s.kind, location: s.location })),
  };
}

export function packBody(data: unknown = samplePackData()): ApiBytes {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  return { bytes, declaredLength: bytes.length, etag: null, contentType: 'application/json' };
}

export const notFound = (code = 'line.not_found') => new ApiError('problem', 404, code, 'req-test');
export const offline = () => new ApiError('network', 0, 'network', 'req-test');

/** Matches the API: `q` filters code or name, case-insensitively. */
function filterByQuery(q: string | null | undefined): LineListItem[] {
  if (!q) return SAMPLE_LINES;
  const needle = q.toLocaleLowerCase('tr');
  return SAMPLE_LINES.filter(
    (l) =>
      l.code.toLocaleLowerCase('tr').includes(needle) ||
      l.name.toLocaleLowerCase('tr').includes(needle),
  );
}

export interface Spy<A extends unknown[], R> {
  (...args: A): R;
  calls: A[];
  impl: (...args: A) => R;
}

/** A recording function whose implementation tests can swap (no test globals in app sources). */
export function spy<A extends unknown[], R>(impl: (...args: A) => R): Spy<A, R> {
  const fn = ((...args: A) => {
    fn.calls.push(args);
    return fn.impl(...args);
  }) as Spy<A, R>;
  fn.calls = [];
  fn.impl = impl;
  return fn;
}

/** A CatalogApi stand-in answering from the fixtures; every method is a spy. */
export function fakeCatalog() {
  const allStops = [1, 2, 3, 4].flatMap((row) =>
    [1, 2, 3, 4, 5].map((col) => sampleStop(row, col)),
  );
  return {
    cities: spy(async (): Promise<City[]> => [SAMPLE_CITY]),
    lines: spy(async (query: { city: string; q?: string | null }): Promise<LineListItem[]> =>
      query.city === SAMPLE_CITY.slug ? filterByQuery(query.q) : Promise.reject(notFound()),
    ),
    line: spy(async (slug: string, city: string): Promise<LineDetail> => {
      if (city !== SAMPLE_CITY.slug || slug !== 'ornek-hat-1') throw notFound();
      return sampleLineDetail();
    }),
    stop: spy(async (slug: string, city: string): Promise<StopDetail> => {
      if (city !== SAMPLE_CITY.slug || slug !== 'ornek-durak-1-5') throw notFound('stop.not_found');
      return sampleStopDetail();
    }),
    stopsNear: spy(async (): Promise<StopSummary[]> => allStops),
    packBytes: spy(async (slug: string, options?: BytesOptions): Promise<ApiBytes> => {
      void options;
      if (slug !== SAMPLE_CITY.slug) throw notFound('city.not_found');
      return packBody();
    }),
    tilesArchive: spy(async (slug: string, options?: BytesOptions): Promise<ApiBytes> => {
      void slug;
      void options;
      throw notFound('tiles.not_configured');
    }),
    // Body and signal are recorded in `calls` for the tests to inspect.
    plan: spy(async (body: unknown, signal?: AbortSignal): Promise<PlanResult> => {
      void body;
      void signal;
      return samplePlan();
    }),
  };
}

export type FakeCatalog = ReturnType<typeof fakeCatalog>;

export class MemoryPreferences implements PreferenceStore {
  readonly values = new Map<string, string>();
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.values.set(key, value);
  }
  async remove(key: string) {
    this.values.delete(key);
  }
}

/** A session whose user tests set directly; the favourites store only reads `user`. */
export class FakeSession {
  readonly current = signal<Me | null>(null);
  readonly user = this.current.asReadonly();
  readonly isSignedIn = computed(() => this.current() !== null);
  readonly status = computed(() => (this.current() ? 'signed-in' : 'anonymous'));
  readonly licenceAccepted = computed(() => this.current()?.licence_accepted ?? false);
  readonly logout = spy(async (): Promise<void> => this.signOut());
  readonly acceptLicence = spy(async (): Promise<Me> => {
    const user = this.current();
    if (!user) throw new ApiError('problem', 401, 'auth.required', 'req-test');
    const next = { ...user, licence_accepted: true };
    this.current.set(next);
    return next;
  });
  readonly reload = spy(async (): Promise<Me> => {
    const user = this.current();
    if (!user) throw new ApiError('problem', 401, 'auth.required', 'req-test');
    return user;
  });

  signIn(id = 'user-a', licenceAccepted = false): void {
    this.current.set({
      id,
      email: `${id}@example.test`,
      display_name: null,
      email_verified: true,
      licence_accepted: licenceAccepted,
      reputation: 0,
      role: 'user',
      created_at: '2026-10-01T00:00:00Z',
    });
  }

  signOut(): void {
    this.current.set(null);
  }
}

const LINE_INDEX: Record<string, { slug: string }> = {
  'line-1': { slug: 'ornek-hat-1' },
  'line-2': { slug: 'ornek-hat-2' },
  'line-3': { slug: 'ornek-hat-3' },
};

/** An AccountApi stand-in with one favourites set per signed-in account id. */
export function fakeAccount(session: FakeSession) {
  const server = new Map<string, Set<string>>();
  const own = () => {
    const id = session.user()?.id;
    if (!id) throw new ApiError('problem', 401, 'auth.required', 'req-test');
    let set = server.get(id);
    if (!set) server.set(id, (set = new Set()));
    return set;
  };
  return {
    server,
    favorites: spy(async (): Promise<Favorite[]> =>
      [...own()].map((lineId) => ({
        line_id: lineId,
        slug: LINE_INDEX[lineId]?.slug ?? lineId,
        city: SAMPLE_CITY.slug,
      })),
    ),
    addFavorite: spy(async (lineId: string): Promise<void> => {
      if (!LINE_INDEX[lineId]) throw notFound();
      own().add(lineId);
    }),
    removeFavorite: spy(async (lineId: string): Promise<void> => {
      own().delete(lineId);
    }),
  };
}

export type FakeAccount = ReturnType<typeof fakeAccount>;

/** A ContributionApi stand-in: every call is a spy; tests swap its impl for failures. */
export function fakeContributions() {
  return {
    myEdits: spy(async (): Promise<Edit[]> => []),
    proposeEdit: spy(async (proposal: EditProposal): Promise<Edit> => ({
      id: 'edit-1',
      kind: proposal.kind,
      state: 'pending',
      payload: { ...proposal },
      diff: null,
      reason: null,
      created_at: '2026-10-12T10:00:00Z',
      reviewed_at: null,
      city: SAMPLE_CITY.slug,
    })),
    uploadTrace: spy(async (trace: TraceUpload): Promise<TraceCreated> => ({
      id: '01920000-0000-7000-8000-00000000c0de',
      point_count: trace.points.length,
      delete_after: '2026-11-11T10:00:00Z',
    })),
    deleteTrace: spy(async (id: string): Promise<void> => void id),
    presignPhoto: spy(async (input: PresignRequest): Promise<PresignedUpload> => ({
      photo_id: '01920000-0000-7000-8000-0000000000aa',
      upload_url: 'https://storage.test/incoming/aa?sig=1',
      method: 'PUT',
      headers: { 'Content-Type': input.content_type, 'Content-Length': String(input.byte_size) },
      expires_in: 300,
    })),
    uploadPhoto: spy(
      async (upload: PresignedUpload, body: Blob, signal?: AbortSignal): Promise<void> =>
        void [upload, body, signal],
    ),
  };
}

export type FakeContributions = ReturnType<typeof fakeContributions>;

/** A Capacitor Network stand-in; `set` fires the status listeners. */
export class FakeNetwork implements NetworkSource {
  connected = true;
  private readonly listeners = new Set<(status: { connected: boolean }) => void>();

  async getStatus() {
    return { connected: this.connected };
  }

  async addListener(_event: 'networkStatusChange', listener: (s: { connected: boolean }) => void) {
    this.listeners.add(listener);
    return { remove: async () => void this.listeners.delete(listener) };
  }

  set(connected: boolean): void {
    this.connected = connected;
    for (const listener of this.listeners) listener({ connected });
  }
}

export interface CatalogTestingOptions {
  packs?: PackStorage;
  network?: FakeNetwork;
  warmup?: () => Promise<void>;
  session?: FakeSession;
  account?: FakeAccount;
  catalog?: FakeCatalog;
  prefs?: MemoryPreferences;
  locate?: () => Promise<LocateResult>;
  contributions?: FakeContributions;
}

/** Providers for pages and stores: fake API, in-memory preferences, no debounce, fake location. */
export function catalogTesting(options: CatalogTestingOptions = {}): Provider[] {
  const catalog = options.catalog ?? fakeCatalog();
  const prefs = options.prefs ?? new MemoryPreferences();
  const session = options.session ?? new FakeSession();
  const account = options.account ?? fakeAccount(session);
  return [
    { provide: CatalogApi, useValue: catalog },
    { provide: PACK_STORAGE, useValue: options.packs ?? new MemoryPackStorage() },
    { provide: NETWORK_SOURCE, useValue: options.network ?? new FakeNetwork() },
    { provide: MAP_WARMUP, useValue: options.warmup ?? (async () => undefined) },
    {
      provide: MAP_WARMUP_RUNTIME,
      useValue: {
        controlled: () => true,
        version: () => 'test-app',
        marker: () => null,
        saveMarker: () => undefined,
        subscribe: () => () => undefined,
      } satisfies WarmupRuntime,
    },
    { provide: SessionStore, useValue: session },
    { provide: AccountApi, useValue: account },
    { provide: ContributionApi, useValue: options.contributions ?? fakeContributions() },
    { provide: PREFERENCE_STORE, useValue: prefs },
    { provide: SEARCH_DEBOUNCE_MS, useValue: 0 },
    { provide: TILES_BASE_URL, useValue: 'https://tiles.test' },
    {
      provide: LOCATION_SOURCE,
      useValue: {
        locate: options.locate ?? (async () => ({ kind: 'ok', lat: 42.51, lng: 34.09 })),
      },
    },
  ];
}

/** Lets resource loaders, effects and change detection settle. */
export async function settle(fixture?: { whenStable(): Promise<unknown> }): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture?.whenStable();
  }
}
