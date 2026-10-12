import { TestBed } from '@angular/core/testing';
import { ApiError } from '@inecekvar/data-access';
import { CityStore } from '../city/city.store';
import { TranslationKey, TranslationParams } from '../i18n/translation';
import { ConnectivityService } from '../shared/connectivity.service';
import { LocateResult } from '../shared/location';
import {
  catalogTesting,
  fakeCatalog,
  FakeCatalog,
  SAMPLE_CITY,
  samplePlan,
  sampleStop,
  settle,
} from '../testing/catalog.fixtures';
import { i18nTesting } from '../testing/i18n.testing';
import {
  estimateMinutes,
  itineraryPath,
  rideStops,
  roundMetres,
  RideLeg,
  steps,
  summarize,
} from './itinerary';
import { Place, toPlanRequest, validatePlanForm } from './plan-form';
import { PLANNER_NOW, PlannerStore } from './planner.store';

const city = { slug: SAMPLE_CITY.slug, bbox: SAMPLE_CITY.bbox };
const at = (lng: number, lat: number, label = 'x'): Place => ({ source: 'stop', label, lng, lat });
const A = at(34.01, 42.51, 'A');
const B = at(34.05, 42.55, 'B');

/** Keys with their parameters, so tests check what is asked for rather than the copy. */
const t = (key: TranslationKey, params?: TranslationParams) =>
  params ? `${key}${JSON.stringify(params)}` : key;

describe('validatePlanForm', () => {
  it('accepts two distinct points inside the city and builds the API body', () => {
    const input = { city, from: A, to: B, maxTransfers: 1 };
    expect(validatePlanForm(input)).toBeNull();
    expect(toPlanRequest(input)).toEqual({
      city: SAMPLE_CITY.slug,
      from: { lat: 42.51, lng: 34.01 },
      to: { lat: 42.55, lng: 34.05 },
      max_transfers: 1,
    });
  });

  it.each([
    [{ city: null, from: A, to: B, maxTransfers: 2 }, 'no-city'],
    [{ city, from: null, to: B, maxTransfers: 2 }, 'missing-from'],
    [{ city, from: A, to: null, maxTransfers: 2 }, 'missing-to'],
    [{ city, from: at(33.99, 42.51), to: B, maxTransfers: 2 }, 'from-outside-city'],
    [{ city, from: at(Number.NaN, 42.51), to: B, maxTransfers: 2 }, 'from-outside-city'],
    [{ city, from: A, to: at(34.05, 42.581), maxTransfers: 2 }, 'to-outside-city'],
    [
      { city, from: A, to: at(Number.POSITIVE_INFINITY, 42.55), maxTransfers: 2 },
      'to-outside-city',
    ],
    [{ city, from: A, to: A, maxTransfers: 2 }, 'same-place'],
    // About 50 m apart: one planner cell.
    [{ city, from: A, to: at(34.0106, 42.51), maxTransfers: 2 }, 'same-place'],
    [{ city, from: A, to: B, maxTransfers: 3 }, 'bad-transfers'],
    [{ city, from: A, to: B, maxTransfers: -1 }, 'bad-transfers'],
    [{ city, from: A, to: B, maxTransfers: 1.5 }, 'bad-transfers'],
  ] as const)('rejects %o with %s', (input, error) => {
    expect(validatePlanForm(input)).toBe(error);
    expect(toPlanRequest(input)).toBeNull();
  });

  it('accepts points on the bbox edge and about 150 m apart', () => {
    const edge = at(34.0, 42.5);
    expect(validatePlanForm({ city, from: edge, to: at(34.1, 42.58), maxTransfers: 0 })).toBeNull();
    expect(validatePlanForm({ city, from: A, to: at(34.0118, 42.51), maxTransfers: 0 })).toBeNull();
  });
});

describe('itinerary view', () => {
  const [transfer, direct] = samplePlan().itineraries;
  if (!transfer || !direct) throw new Error('fixture');

  it('summarises legs, transfers, walking, fare and an estimated duration', () => {
    const summary = summarize(transfer, 0, t);
    expect(summary.title).toBe('planner.option{"index":1}');
    expect(summary.legs).toEqual([
      { kind: 'walk', label: 'planner.walkShort{"metres":80}' },
      { kind: 'ride', code: 'ORN-1', name: '[ÖRNEK] Hat ORN-1' },
      { kind: 'walk', label: 'planner.walkShort{"metres":220}' },
      { kind: 'ride', code: 'ORN-2', name: '[ÖRNEK] Hat ORN-2' },
      { kind: 'walk', label: 'planner.walkShort{"metres":40}' },
    ]);
    expect(summary.transfers).toBe('planner.transfers{"count":1}');
    expect(summary.walk).toBe('planner.walkTotal{"metres":340}');
    expect(summary.fare).toBe('planner.fareEstimate{"fare":"₺50,00"}');
    // 343 m / 80 + 3 stops × 2 + 2 boardings × 5 = 20.3 → 20 minutes.
    expect(estimateMinutes(transfer)).toBe(20);
    expect(summary.duration).toBe('planner.duration{"minutes":20}');
  });

  it('words a direct ride and an unknown fare', () => {
    const summary = summarize(direct, 1, t);
    expect(summary.transfers).toBe('planner.direct');
    expect(summary.fare).toBe('fare.unknown');
    expect(summarize({ ...direct, estimated_fare_minor: 0 }, 1, t).fare).toBe('fare.free');
    expect(roundMetres(2)).toBe(10);
  });

  it('leaves out walks of 0 m when a trip end is at the stop', () => {
    const atStop = {
      ...transfer,
      legs: transfer.legs.map((leg) =>
        leg.kind === 'walk' && leg.from_stop === null ? { ...leg, metres: 0 } : leg,
      ),
    };
    expect(summarize(atStop, 0, t).legs[0]).toMatchObject({ kind: 'ride', code: 'ORN-1' });
    expect(steps(atStop, t)).toHaveLength(4);
    expect(steps(atStop, t)[0]?.kind).toBe('ride');
  });

  it('lists the steps with stop names as given', () => {
    expect(steps(transfer, t).map((s) => [s.kind, s.title, s.detail])).toEqual([
      [
        'walk',
        'planner.stepWalkToStop{"metres":80,"stop":"[ÖRNEK] Durak 1-1"}',
        'planner.fromOrigin',
      ],
      [
        'ride',
        'planner.stepRide{"code":"ORN-1","name":"[ÖRNEK] Hat ORN-1"}',
        'planner.stepRideDetail{"board":"[ÖRNEK] Durak 1-1","alight":"[ÖRNEK] Durak 1-3","count":2}',
      ],
      [
        'walk',
        'planner.stepWalkToStop{"metres":220,"stop":"[ÖRNEK] Durak 2-3"}',
        'planner.fromStop{"stop":"[ÖRNEK] Durak 1-3"}',
      ],
      [
        'ride',
        'planner.stepRide{"code":"ORN-2","name":"[ÖRNEK] Hat ORN-2"}',
        'planner.stepRideDetail{"board":"[ÖRNEK] Durak 2-3","alight":"[ÖRNEK] Durak 3-3","count":1}',
      ],
      [
        'walk',
        'planner.stepWalkToDestination{"metres":40}',
        'planner.fromStop{"stop":"[ÖRNEK] Durak 3-3"}',
      ],
    ]);
  });

  it('draws rides along the line stops in travel order and walks as chords', () => {
    const line = [1, 2, 3, 4, 5].map((col) => sampleStop(1, col));
    const ride = transfer.legs[1] as RideLeg;
    expect(rideStops(ride, line)).toEqual([1, 2, 3].map((c) => sampleStop(1, c).location));
    const back = { ...ride, board_stop: ride.alight_stop, alight_stop: ride.board_stop };
    expect(rideStops(back, line)).toEqual([3, 2, 1].map((c) => sampleStop(1, c).location));
    expect(rideStops(ride, undefined)).toBeNull();
    expect(
      rideStops({ ...ride, alight_stop: { ...ride.alight_stop, slug: 'baska' } }, line),
    ).toBeNull();

    const path = itineraryPath(transfer, A, B, (slug) =>
      slug === 'ornek-hat-1' ? line : undefined,
    );
    expect(path.map((s) => s.kind)).toEqual(['walk', 'ride', 'walk', 'ride', 'walk']);
    expect(path[0]?.coordinates).toEqual([[34.01, 42.51], sampleStop(1, 1).location]);
    expect(path[1]?.coordinates).toHaveLength(3);
    // ORN-2 is not known: a straight segment from boarding to alighting.
    expect(path[3]?.coordinates).toEqual([sampleStop(2, 3).location, sampleStop(3, 3).location]);
    expect(path[4]?.coordinates).toEqual([sampleStop(3, 3).location, [34.05, 42.55]]);
  });
});

interface StoreOptions {
  catalog?: FakeCatalog;
  locate?: () => Promise<LocateResult>;
}

async function plannerStore(options: StoreOptions = {}) {
  const catalog = options.catalog ?? fakeCatalog();
  let now = 1_000_000;
  TestBed.configureTestingModule({
    imports: [i18nTesting()],
    providers: [
      ...catalogTesting({ catalog, locate: options.locate }),
      { provide: PLANNER_NOW, useValue: () => now },
      PlannerStore,
    ],
  });
  await TestBed.inject(CityStore).select(SAMPLE_CITY.slug);
  await TestBed.inject(CityStore).init();
  const store = TestBed.inject(PlannerStore);
  await settle();
  TestBed.tick();
  return {
    store,
    catalog,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

async function plan(store: PlannerStore) {
  store.choose('from', A);
  store.choose('to', B);
  await store.submit();
  await settle();
}

describe('PlannerStore', () => {
  beforeEach(() => localStorage.clear());

  it('sends the plan, lists the itineraries and draws the selected one along its line', async () => {
    const { store, catalog } = await plannerStore();
    expect(store.view()).toBe('idle');
    store.setMaxTransfers(1);
    await plan(store);
    expect(catalog.plan.calls[0]?.[0]).toEqual({
      city: SAMPLE_CITY.slug,
      from: { lat: 42.51, lng: 34.01 },
      to: { lat: 42.55, lng: 34.05 },
      max_transfers: 1,
    });
    expect(store.view()).toBe('results');
    expect(store.itineraries()).toHaveLength(2);
    expect(store.selected()).toBe(0);
    TestBed.tick();
    await settle();
    expect(catalog.line.calls.map(([slug]) => slug)).toContain('ornek-hat-1');
    expect(store.segments()[1]?.coordinates).toHaveLength(3);
    store.select(1);
    expect(store.selectedItinerary()?.legs[0]).toMatchObject({ line_code: 'ORN-3' });
    store.select(5);
    expect(store.selected()).toBe(1);
  });

  it('does not send an invalid form and says why', async () => {
    const { store, catalog } = await plannerStore();
    await store.submit();
    expect(store.formError()).toBe('missing-from');
    store.choose('from', A);
    store.choose('to', A);
    await store.submit();
    expect(store.formError()).toBe('same-place');
    store.choose('to', at(35, 42.55));
    await store.submit();
    expect(store.formError()).toBe('to-outside-city');
    expect(catalog.plan.calls).toHaveLength(0);
    // Changing the form clears the message.
    store.choose('to', B);
    expect(store.formError()).toBeNull();
  });

  it('shows the empty result', async () => {
    const catalog = fakeCatalog();
    catalog.plan.impl = async () => samplePlan({ itineraries: [] });
    const { store } = await plannerStore({ catalog });
    await plan(store);
    expect(store.view()).toBe('empty');
  });

  it('shows degrade mode with and without itineraries', async () => {
    const catalog = fakeCatalog();
    catalog.plan.impl = async () => samplePlan({ degraded: true, itineraries: [] });
    const { store } = await plannerStore({ catalog });
    await plan(store);
    expect(store.view()).toBe('degraded');
    catalog.plan.impl = async () => samplePlan({ degraded: true });
    await store.submit();
    await settle();
    expect(store.view()).toBe('results');
    expect(store.degraded()).toBe(true);
  });

  it('counts down Retry-After after a 429 and refuses to send meanwhile', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const catalog = fakeCatalog();
      catalog.plan.impl = async () => {
        throw new ApiError('rate_limited', 429, 'rate_limited', 'req-test', null, 12);
      };
      const { store, advance } = await plannerStore({ catalog });
      await plan(store);
      expect(store.view()).toBe('rate-limited');
      expect(store.retryIn()).toBe(12);
      expect(store.canSubmit()).toBe(false);
      await store.submit();
      expect(catalog.plan.calls).toHaveLength(1);
      advance(5_000);
      vi.advanceTimersByTime(5_000);
      expect(store.retryIn()).toBe(7);
      // Editing the form keeps the countdown.
      store.setMaxTransfers(0);
      expect(store.view()).toBe('rate-limited');
      expect(store.retryIn()).toBe(7);
      advance(7_000);
      vi.advanceTimersByTime(7_000);
      expect(store.retryIn()).toBe(0);
      catalog.plan.impl = async () => samplePlan();
      await store.submit();
      await settle();
      expect(catalog.plan.calls).toHaveLength(2);
      expect(store.view()).toBe('results');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports offline without calling the API, and network failures as offline', async () => {
    const { store, catalog } = await plannerStore();
    const connectivity = TestBed.inject(ConnectivityService);
    connectivity.online.set(false);
    expect(store.view()).toBe('offline');
    await plan(store);
    expect(catalog.plan.calls).toHaveLength(0);
    expect(store.view()).toBe('offline');
    connectivity.online.set(true);
    catalog.plan.impl = async () => {
      throw new ApiError('timeout', 0, 'timeout', 'req-test');
    };
    await store.submit();
    await settle();
    expect(store.view()).toBe('offline');
  });

  it('maps outside_city and other API errors', async () => {
    const catalog = fakeCatalog();
    catalog.plan.impl = async () => {
      throw new ApiError('problem', 422, 'plan.outside_city', 'req-test');
    };
    const { store } = await plannerStore({ catalog });
    await plan(store);
    expect(store.view()).toBe('outside-city');
    catalog.plan.impl = async () => {
      throw new ApiError('http', 502, 'http.502', 'req-test');
    };
    await store.submit();
    await settle();
    expect(store.view()).toBe('error');
  });

  it('fills ends from the map and the device position, checking the city', async () => {
    let fix: LocateResult = { kind: 'ok', lat: 42.52, lng: 34.02 };
    const { store } = await plannerStore({ locate: async () => fix });
    store.pickOnMap([34.03, 42.53]);
    expect(store.from()).toMatchObject({ source: 'map', lng: 34.03, lat: 42.53 });
    expect(store.fromText()).toBe('Haritada seçilen nokta');
    await store.useMyLocation('to');
    expect(store.to()).toMatchObject({ source: 'gps', lng: 34.02, lat: 42.52 });
    expect(store.toText()).toBe('Konumum');
    store.pickTarget.set('to');
    store.pickOnMap([34.06, 42.56]);
    expect(store.to()).toMatchObject({ source: 'map', lng: 34.06 });
    expect(store.pickTarget()).toBeNull();

    fix = { kind: 'ok', lat: 41, lng: 29 };
    await store.useMyLocation('from');
    expect(store.locateProblem()).toEqual({ end: 'from', problem: 'outside-city' });
    fix = { kind: 'denied' };
    await store.useMyLocation('from');
    expect(store.locateProblem()).toEqual({ end: 'from', problem: 'denied' });
  });

  it('suggests stops for typed text, swaps ends and forgets a place when typing', async () => {
    const { store } = await plannerStore();
    store.setText('from', 'durak 1-2');
    await settle();
    TestBed.tick();
    await settle();
    expect(store.suggestions('from').map((s) => s.name)).toEqual(['[ÖRNEK] Durak 1-2']);
    const stop = store.suggestions('from')[0];
    if (!stop) throw new Error('no suggestion');
    store.chooseStop('from', stop);
    expect(store.from()).toMatchObject({ source: 'stop', label: '[ÖRNEK] Durak 1-2' });
    store.choose('to', B);
    store.swap();
    expect(store.from()?.label).toBe('B');
    expect(store.toText()).toBe('[ÖRNEK] Durak 1-2');
    store.setText('to', '[ÖRNEK] Durak 1-');
    expect(store.to()).toBeNull();
  });
});
