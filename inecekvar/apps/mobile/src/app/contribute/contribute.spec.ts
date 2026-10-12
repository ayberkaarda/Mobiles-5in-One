import { TestBed } from '@angular/core/testing';
import { ApiError, TraceUpload } from '@inecekvar/data-access';
import { LicenceGate } from '../auth/licence-gate';
import { CityStore, PREFERENCE_STORE } from '../city/city.store';
import { distanceMeters } from '../shared/format';
import {
  catalogTesting,
  fakeContributions,
  FakeContributions,
  FakeSession,
  MemoryPreferences,
} from '../testing/catalog.fixtures';
import {
  contributeTesting,
  FakeClock,
  FakePositions,
  FakeWakeLock,
  walk,
} from '../testing/contribute.fixtures';
import { RecorderStore } from './recorder.store';
import { deferred } from '../testing/deferred';
import {
  BASE_TOLERANCE_M,
  dedupe,
  douglasPeucker,
  LngLat,
  MAX_TRACE_POINTS,
  simplifyToCap,
} from './simplify';
import {
  MAX_DRAFT_POINTS,
  parseDraft,
  TRACE_DRAFT_KEY,
  TraceDraft,
  TraceDraftStore,
} from './trace-draft';

/** Metres from `p` to the closest point of the polyline (flat approximation, fine at city scale). */
function distanceToLine(p: LngLat, line: readonly LngLat[]): number {
  const kx = 111_320 * Math.cos((p[1] * Math.PI) / 180);
  const ky = 110_540;
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as LngLat;
    const b = line[i] as LngLat;
    const ax = a[0] * kx;
    const ay = a[1] * ky;
    const dx = b[0] * kx - ax;
    const dy = b[1] * ky - ay;
    const px = p[0] * kx - ax;
    const py = p[1] * ky - ay;
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / len));
    best = Math.min(best, Math.hypot(px - t * dx, py - t * dy));
  }
  return best;
}

/** A noisy ride: about 6 m forward per fix with up to 4 m of deterministic sideways jitter. */
function noisyRide(count: number): LngLat[] {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: count }, (_, i) => [
    34.01 + i * 0.0000733,
    42.53 + (random() - 0.5) * 0.00007,
  ]);
}

describe('on-device simplification', () => {
  it('drops consecutive repeats only', () => {
    expect(
      dedupe([
        [1, 1],
        [1, 1],
        [2, 2],
        [1, 1],
      ]),
    ).toEqual([
      [1, 1],
      [2, 2],
      [1, 1],
    ]);
  });

  it('collapses a straight line to its ends and keeps corners beyond the tolerance', () => {
    const straight = walk(50);
    expect(douglasPeucker(straight, 1)).toEqual([straight[0], straight[49]]);
    const corner: LngLat[] = [
      [34.01, 42.53],
      [34.02, 42.53],
      [34.02, 42.54],
    ];
    expect(douglasPeucker(corner, 5)).toHaveLength(3);
  });

  it('keeps the turning point of a ride that doubles back', () => {
    const out: LngLat[] = [
      [34.01, 42.53],
      [34.02, 42.53],
      [34.03, 42.53],
      [34.02, 42.53],
      [34.015, 42.53],
    ];
    expect(douglasPeucker(out, 5)).toContainEqual([34.03, 42.53]);
  });

  it('always applies the 1 m base tolerance, which keeps the shape of a short ride', () => {
    const ride = noisyRide(2000);
    const result = simplifyToCap(ride);
    expect(result.toleranceMetres).toBe(BASE_TOLERANCE_M);
    expect(result.points.length).toBeLessThan(ride.length);
    expect(result.points.length).toBeGreaterThan(500);
    for (const point of ride) {
      expect(distanceToLine(point, result.points)).toBeLessThanOrEqual(BASE_TOLERANCE_M + 0.01);
    }
  });

  it('caps a dense ride at 5000 points, keeps both ends and stays within the tolerance', () => {
    const ride = noisyRide(12_000);
    const { points, toleranceMetres } = simplifyToCap(ride);
    expect(points.length).toBeLessThanOrEqual(MAX_TRACE_POINTS);
    expect(points.length).toBeGreaterThan(100);
    expect(points[0]).toEqual(ride[0]);
    expect(points.at(-1)).toEqual(ride.at(-1));
    expect(toleranceMetres).toBeGreaterThan(BASE_TOLERANCE_M);
    expect(toleranceMetres).toBeLessThan(4);
    for (let i = 0; i < ride.length; i += 97) {
      expect(distanceToLine(ride[i] as LngLat, points)).toBeLessThanOrEqual(toleranceMetres + 0.01);
    }
  });

  it('handles a very long ride without recursion limits', () => {
    const ride = noisyRide(100_000);
    expect(simplifyToCap(ride).points.length).toBeLessThanOrEqual(MAX_TRACE_POINTS);
  });
});

function draft(overrides: Partial<TraceDraft> = {}): TraceDraft {
  return {
    v: 1,
    id: 'draft-a',
    ownerId: 'user-a',
    city: 'ornek-test-sehri',
    startedAt: '2026-10-12T08:00:00Z',
    endedAt: null,
    phase: 'recording',
    points: walk(3),
    stops: [{ at: [34.01, 42.53], name: null }],
    ...overrides,
  };
}

describe('trace draft', () => {
  it('reads back what it wrote', () => {
    const value = draft();
    expect(parseDraft(JSON.stringify(value))).toEqual(value);
  });

  it.each([
    ['not JSON', '{'],
    ['another version', JSON.stringify({ ...draft(), v: 2 })],
    ['a bad city slug', JSON.stringify(draft({ city: '../x' }))],
    ['a bad phase', JSON.stringify({ ...draft(), phase: 'sent' })],
    ['a point out of range', JSON.stringify(draft({ points: [[200, 1]] }))],
    ['a NaN point', JSON.stringify(draft()).replace('34.01,42.53]', '"x",42.53]')],
    ['a long stop name', JSON.stringify(draft({ stops: [{ at: [1, 1], name: 'x'.repeat(161) }] }))],
    ['too many points', JSON.stringify(draft({ points: walk(MAX_DRAFT_POINTS + 1) }))],
  ])('refuses %s', (_label, raw) => {
    expect(parseDraft(raw)).toBeNull();
  });

  it('removes an unreadable stored draft and survives a refused write', async () => {
    const prefs = new MemoryPreferences();
    TestBed.configureTestingModule({ providers: [{ provide: PREFERENCE_STORE, useValue: prefs }] });
    const store = TestBed.inject(TraceDraftStore);
    prefs.values.set(TRACE_DRAFT_KEY, '{broken');
    expect(await store.load('user-a')).toBeNull();
    expect(prefs.values.has(TRACE_DRAFT_KEY)).toBe(false);
    prefs.set = async () => {
      throw new Error('quota');
    };
    expect(await store.save(draft())).toBe(false);
  });
});

interface Rig {
  rec: RecorderStore;
  positions: FakePositions;
  wake: FakeWakeLock;
  clock: FakeClock;
  prefs: MemoryPreferences;
  session: FakeSession;
  contributions: FakeContributions;
}

async function rig(
  options: { licence?: boolean; prefs?: MemoryPreferences; withCities?: boolean } = {},
): Promise<Rig> {
  const positions = new FakePositions();
  const wake = new FakeWakeLock();
  const clock = new FakeClock();
  const prefs = options.prefs ?? new MemoryPreferences();
  const session = new FakeSession();
  session.signIn('user-a', options.licence ?? true);
  const contributions = fakeContributions();
  TestBed.configureTestingModule({
    providers: [
      ...catalogTesting({ session, prefs, contributions }),
      ...contributeTesting(positions, wake, clock),
    ],
  });
  if (options.withCities !== false) await TestBed.inject(CityStore).init();
  const rec = TestBed.inject(RecorderStore);
  await rec.init();
  return { rec, positions, wake, clock, prefs, session, contributions };
}

async function ride(r: Rig, points: readonly LngLat[]): Promise<void> {
  for (const [lng, lat] of points) {
    r.clock.advance(1000);
    r.positions.emit(lng, lat);
  }
  await Promise.resolve();
}

const flush = () => new Promise((resolve) => setTimeout(resolve));

function storedDraft(prefs: MemoryPreferences): TraceDraft | null {
  return parseDraft(prefs.values.get(TRACE_DRAFT_KEY) ?? null);
}

describe('RecorderStore', () => {
  it('deletes account A draft instead of loading it for account B', async () => {
    const prefs = new MemoryPreferences();
    TestBed.configureTestingModule({ providers: [{ provide: PREFERENCE_STORE, useValue: prefs }] });
    const store = TestBed.inject(TraceDraftStore);
    expect(await store.save(draft({ ownerId: 'user-a' }))).toBe(true);
    expect(await store.load('user-b')).toBeNull();
    expect(prefs.values.has(TRACE_DRAFT_KEY)).toBe(false);
  });

  it('deletes a legacy draft without an owner', async () => {
    const prefs = new MemoryPreferences();
    const legacy: Record<string, unknown> = { ...draft() };
    delete legacy['ownerId'];
    prefs.values.set(TRACE_DRAFT_KEY, JSON.stringify(legacy));
    TestBed.configureTestingModule({ providers: [{ provide: PREFERENCE_STORE, useValue: prefs }] });
    expect(await TestBed.inject(TraceDraftStore).load('user-a')).toBeNull();
    expect(prefs.values.has(TRACE_DRAFT_KEY)).toBe(false);
  });

  it('refuses to upload a draft owned by another account', async () => {
    const r = await rig();
    await r.rec.start('ornek-test-sehri');
    await ride(r, walk(3));
    await r.rec.finish();
    r.session.signIn('user-b', true);
    expect((await r.rec.submit()).ok).toBe(false);
    expect(r.contributions.uploadTrace.calls).toHaveLength(0);
  });

  it('clears the in-memory ride when the signed-in user changes', async () => {
    const r = await rig();
    await r.rec.start('ornek-test-sehri');
    await ride(r, walk(3));
    r.session.signIn('user-b', true);
    TestBed.tick();
    expect(r.rec.points()).toEqual([]);
    expect(r.rec.stops()).toEqual([]);
    await flush();
    expect(r.positions.watching).toBe(false);
  });

  it('discard resets uploaded marks and every recorder readout', async () => {
    const r = await rig();
    await r.rec.start('ornek-test-sehri');
    await ride(r, walk(3));
    await r.rec.markStop('A stop');
    await r.rec.finish();
    await r.rec.submit();
    expect(r.rec.uploadedStops()).toHaveLength(1);
    r.rec.problem.set('storage');
    r.rec.submitError.set('recorder.errors.generic');
    r.rec.interrupted.set(true);
    r.rec.weakSignal.set(true);
    await r.rec.discard();
    expect(r.rec.view()).toBe('idle');
    expect(r.rec.uploaded()).toBeNull();
    expect(r.rec.uploadedStops()).toEqual([]);
    expect(r.rec.uploadedCity()).toBeNull();
    expect(r.rec.points()).toEqual([]);
    expect(r.rec.stops()).toEqual([]);
    expect(r.rec.city()).toBeNull();
    expect(r.rec.distanceMetres()).toBe(0);
    expect(r.rec.elapsedSeconds()).toBe(0);
    expect(r.rec.hasFix()).toBe(false);
    expect(r.rec.problem()).toBeNull();
    expect(r.rec.submitError()).toBeNull();
    expect(r.rec.interrupted()).toBe(false);
    expect(r.rec.weakSignal()).toBe(false);
    expect(r.rec.wakeLockOn()).toBe(false);
  });

  it('concurrent resumes open only one live position watch', async () => {
    const r = await rig();
    await r.rec.start('ornek-test-sehri');
    await r.rec.pause();
    const permission = deferred<'granted' | 'denied'>();
    const ensure = vi.spyOn(r.positions, 'ensurePermission').mockReturnValue(permission.promise);
    const first = r.rec.resume();
    const second = r.rec.resume();
    permission.resolve('granted');
    await Promise.all([first, second]);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(r.positions.watchCount).toBe(2);
    expect(r.positions.watching).toBe(true);
    await r.rec.finish();
    expect(r.positions.watching).toBe(false);
  });

  it('discard invalidates a start waiting for location permission', async () => {
    const r = await rig();
    const permission = deferred<'granted' | 'denied'>();
    vi.spyOn(r.positions, 'ensurePermission').mockReturnValue(permission.promise);
    const starting = r.rec.start('ornek-test-sehri');
    await flush();
    await r.rec.discard();
    permission.resolve('granted');
    await starting;
    expect(r.rec.view()).toBe('idle');
    expect(r.positions.watchCount).toBe(0);
    expect(r.prefs.values.has(TRACE_DRAFT_KEY)).toBe(false);
  });

  it('closes a late watch handle after discard', async () => {
    const r = await rig();
    const handle = deferred<{ stop: () => Promise<void> }>();
    const stop = vi.fn(async () => undefined);
    vi.spyOn(r.positions, 'watch').mockReturnValue(handle.promise);
    const starting = r.rec.start('ornek-test-sehri');
    await flush();
    await r.rec.discard();
    handle.resolve({ stop });
    await starting;
    expect(stop).toHaveBeenCalledTimes(1);
    expect(r.rec.view()).toBe('idle');
  });

  it('submits a trace only once while the licence check is pending', async () => {
    const r = await rig();
    await r.rec.start('ornek-test-sehri');
    await ride(r, walk(3));
    await r.rec.finish();
    const licence = deferred<boolean>();
    const ensure = vi.spyOn(TestBed.inject(LicenceGate), 'ensure').mockReturnValue(licence.promise);
    const first = r.rec.submit();
    const second = r.rec.submit();
    expect(ensure).toHaveBeenCalledTimes(1);
    licence.resolve(true);
    const results = await Promise.all([first, second]);
    expect(results.map((result) => result.ok)).toEqual([true, false]);
    expect(r.contributions.uploadTrace.calls).toHaveLength(1);
  });

  it('a late trace upload cannot erase the replacement recording', async () => {
    const r = await rig();
    await r.rec.start('ornek-test-sehri');
    await ride(r, walk(3));
    await r.rec.markStop('Old stop');
    await r.rec.finish();
    const response = await fakeContributions().uploadTrace({
      city: 'ornek-test-sehri',
      started_at: '2026-10-12T08:00:00Z',
      ended_at: '2026-10-12T08:00:03Z',
      points: walk(3),
    });
    const upload = deferred<typeof response>();
    r.contributions.uploadTrace.impl = () => upload.promise;
    const submitting = r.rec.submit();
    await flush();
    const signal = r.contributions.uploadTrace.calls[0]?.[1];
    expect(signal?.aborted).toBe(false);
    await r.rec.discard();
    expect(signal?.aborted).toBe(true);
    await r.rec.start('ornek-test-sehri');
    await ride(r, walk(4));
    await r.rec.pause();
    const replacement = storedDraft(r.prefs);
    upload.resolve(response);
    expect((await submitting).ok).toBe(false);
    expect(r.rec.pointCount()).toBe(4);
    expect(storedDraft(r.prefs)).toEqual(replacement);
    expect(r.rec.uploadedStops()).toEqual([]);
    expect(r.rec.uploaded()).toBeNull();
  });

  it('retries a refused draft deletion before reporting discard success', async () => {
    const r = await rig();
    await r.rec.start('ornek-test-sehri');
    let attempts = 0;
    r.prefs.remove = async (key) => {
      if (key === TRACE_DRAFT_KEY && ++attempts === 1) throw new Error('blocked');
      r.prefs.values.delete(key);
    };
    await r.rec.discard();
    expect(attempts).toBe(2);
    expect(r.rec.view()).toBe('idle');
    expect(r.prefs.values.has(TRACE_DRAFT_KEY)).toBe(false);
  });

  it('surfaces failed cleanup and retries it on the next draft load', async () => {
    const r = await rig();
    await r.rec.start('ornek-test-sehri');
    let attempts = 0;
    r.prefs.remove = async () => {
      attempts += 1;
      throw new Error('blocked');
    };
    await r.rec.discard();
    expect(attempts).toBe(3);
    expect(r.rec.view()).toBe('cleanup');
    expect(r.rec.submitError()).toBe('recorder.errors.cleanup');
    expect(r.rec.cleanupPending()).toBe(true);
    expect(r.prefs.values.has(TRACE_DRAFT_KEY)).toBe(true);
    r.prefs.remove = async (key) => {
      attempts += 1;
      r.prefs.values.delete(key);
    };
    TestBed.resetTestingModule();
    const next = await rig({ prefs: r.prefs });
    expect(attempts).toBeGreaterThan(3);
    expect(next.rec.pointCount()).toBe(0);
    expect(next.rec.view()).toBe('idle');
    expect(r.prefs.values.has(TRACE_DRAFT_KEY)).toBe(false);
  });

  it('stays idle and explains when location permission is denied', async () => {
    const r = await rig();
    r.positions.permission = 'denied';
    await r.rec.start('ornek-test-sehri');
    expect(r.rec.view()).toBe('idle');
    expect(r.rec.problem()).toBe('denied');
    expect(r.positions.watching).toBe(false);
    expect(r.prefs.values.has(TRACE_DRAFT_KEY)).toBe(false);
  });

  it('records spaced, precise fixes, measures distance and holds the screen on', async () => {
    const r = await rig();
    await r.rec.start('ornek-test-sehri');
    expect(r.rec.view()).toBe('recording');
    expect(r.wake.held).toBe(1);
    expect(r.rec.wakeLockOn()).toBe(true);
    await ride(r, walk(5));
    // Too close to the last point (about 1 m) and too imprecise: both ignored.
    r.positions.emit(34.01081, 42.53);
    r.positions.emit(34.0112, 42.53, 120);
    expect(r.rec.weakSignal()).toBe(true);
    expect(r.rec.pointCount()).toBe(5);
    const [first, , , , last] = walk(5) as [LngLat, LngLat, LngLat, LngLat, LngLat];
    expect(r.rec.distanceMetres()).toBeCloseTo(distanceMeters(first, last), 0);
    expect(r.rec.elapsedSeconds()).toBe(5);
  });

  it('ignores fixes while paused and continues on resume', async () => {
    const r = await rig();
    await r.rec.start('ornek-test-sehri');
    await ride(r, walk(3));
    await r.rec.pause();
    expect(r.rec.view()).toBe('paused');
    expect(r.positions.watching).toBe(false);
    expect(r.wake.releases).toBe(1);
    expect(storedDraft(r.prefs)?.phase).toBe('paused');
    r.positions.emit(34.05, 42.53);
    expect(r.rec.pointCount()).toBe(3);
    await r.rec.resume();
    expect(r.rec.view()).toBe('recording');
    await ride(r, walk(2, [34.0108, 42.53]));
    expect(r.rec.pointCount()).toBe(5);
  });

  it('pauses when the permission is withdrawn mid-ride', async () => {
    const r = await rig();
    await r.rec.start('ornek-test-sehri');
    await ride(r, walk(2));
    r.positions.fail('denied');
    await flush();
    expect(r.rec.view()).toBe('paused');
    expect(r.rec.problem()).toBe('denied');
  });

  it('marks a stop at the current position with an optional name', async () => {
    const r = await rig();
    await r.rec.start('ornek-test-sehri');
    expect(await r.rec.markStop()).toBe(false);
    await ride(r, walk(3));
    expect(await r.rec.markStop()).toBe(true);
    expect(await r.rec.markStop('  Fırın önü  ')).toBe(true);
    expect(r.rec.stops()).toEqual([
      { at: walk(3)[2], name: null },
      { at: walk(3)[2], name: 'Fırın önü' },
    ]);
    expect(storedDraft(r.prefs)?.stops).toHaveLength(2);
    await r.rec.renameStop(0, 'Köşe');
    expect(r.rec.stops()[0]?.name).toBe('Köşe');
  });

  it('comes back paused with every point after the app was killed mid-ride', async () => {
    const prefs = new MemoryPreferences();
    const first = await rig({ prefs });
    await first.rec.start('ornek-test-sehri');
    await ride(first, walk(25));
    await first.rec.markStop('Durak');
    // Kill: nothing is torn down, a new process starts from storage.
    TestBed.resetTestingModule();
    const second = await rig({ prefs });
    expect(second.rec.view()).toBe('paused');
    expect(second.rec.interrupted()).toBe(true);
    expect(second.rec.pointCount()).toBe(25);
    expect(second.rec.stops()).toHaveLength(1);
    expect(second.rec.distanceMetres()).toBeGreaterThan(300);
    expect(second.positions.watching).toBe(false);
    expect(storedDraft(prefs)?.phase).toBe('paused');
  });

  it('writes the draft when the app is hidden', async () => {
    const r = await rig();
    await r.rec.start('ornek-test-sehri');
    await ride(r, walk(3));
    expect(storedDraft(r.prefs)?.points.length ?? 0).toBeLessThan(3);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    expect(storedDraft(r.prefs)?.points).toHaveLength(3);
  });

  it('sends the reviewed ride: start and end times, two-number points, no trimming', async () => {
    const r = await rig();
    await r.rec.start('ornek-test-sehri');
    await ride(r, walk(40));
    await r.rec.finish();
    expect(r.rec.view()).toBe('review');
    expect(r.rec.issues()).toEqual([]);
    expect((await r.rec.submit()).ok).toBe(true);
    const [body] = r.contributions.uploadTrace.calls[0] as [TraceUpload];
    expect(Object.keys(body).sort()).toEqual(['city', 'ended_at', 'points', 'started_at']);
    expect(body.city).toBe('ornek-test-sehri');
    expect(body.started_at).toBe('2026-10-12T08:00:00Z');
    expect(body.ended_at).toBe('2026-10-12T08:00:40Z');
    expect(body.points.every((p) => p.length === 2)).toBe(true);
    // A straight walk simplifies to its two ends, which are kept (the API trims, not the app).
    expect(body.points).toEqual([walk(40)[0], walk(40)[39]]);
    expect(r.rec.view()).toBe('uploaded');
    expect(r.prefs.values.has(TRACE_DRAFT_KEY)).toBe(false);
  });

  it('never sends more than 5000 points however long the ride', async () => {
    const r = await rig({ withCities: false });
    await r.rec.start('ornek-test-sehri');
    await ride(r, noisyRide(6500));
    expect(r.rec.pointCount()).toBeGreaterThan(MAX_TRACE_POINTS);
    await r.rec.finish();
    expect((await r.rec.submit()).ok).toBe(true);
    const [body] = r.contributions.uploadTrace.calls[0] as [TraceUpload];
    expect(body.points.length).toBeLessThanOrEqual(MAX_TRACE_POINTS);
    expect(body.points.length).toBeGreaterThan(100);
  });

  it('compacts the stored draft of a very long ride', async () => {
    const r = await rig({ withCities: false });
    await r.rec.start('ornek-test-sehri');
    // A burst of fixes within one save window: one write at the pause below.
    for (const [lng, lat] of noisyRide(MAX_DRAFT_POINTS + 5)) r.positions.emit(lng, lat);
    expect(r.rec.pointCount()).toBeLessThanOrEqual(MAX_DRAFT_POINTS);
    await r.rec.pause();
    expect(storedDraft(r.prefs)?.points.length).toBe(r.rec.pointCount());
  }, 20_000);

  it('does not send without the licence and sends once it is accepted', async () => {
    const r = await rig({ licence: false });
    const gate = TestBed.inject(LicenceGate);
    await r.rec.start('ornek-test-sehri');
    await ride(r, walk(10));
    await r.rec.finish();
    const declined = r.rec.submit();
    await flush();
    expect(gate.open()).toBe(true);
    gate.decline();
    expect((await declined).ok).toBe(false);
    expect(r.contributions.uploadTrace.calls).toHaveLength(0);
    expect(r.rec.view()).toBe('review');

    const accepted = r.rec.submit();
    await flush();
    await gate.accept();
    expect((await accepted).ok).toBe(true);
    expect(r.session.acceptLicence.calls).toHaveLength(1);
    expect(r.contributions.uploadTrace.calls).toHaveLength(1);
  });

  it('keeps the draft and reports the wait after a 429', async () => {
    const r = await rig();
    r.contributions.uploadTrace.impl = async () => {
      throw new ApiError('rate_limited', 429, 'rate_limited', 'req', null, 3600);
    };
    await r.rec.start('ornek-test-sehri');
    await ride(r, walk(10));
    await r.rec.finish();
    const result = await r.rec.submit();
    expect(result).toEqual({ ok: false, retryAfter: 3600 });
    expect(r.rec.submitError()).toBe('recorder.errors.rateLimited');
    expect(r.rec.view()).toBe('review');
    expect(storedDraft(r.prefs)?.points).toHaveLength(10);
  });

  it('keeps the draft offline and maps API refusals to copy', async () => {
    const r = await rig();
    await r.rec.start('ornek-test-sehri');
    await ride(r, walk(10));
    await r.rec.finish();
    r.contributions.uploadTrace.impl = async () => {
      throw new ApiError('network', 0, 'network', 'req');
    };
    await r.rec.submit();
    expect(r.rec.submitError()).toBe('recorder.errors.offline');
    r.contributions.uploadTrace.impl = async () => {
      throw new ApiError('problem', 422, 'trace.outside_bbox', 'req');
    };
    await r.rec.submit();
    expect(r.rec.submitError()).toBe('recorder.errors.outsideCity');
    expect(r.prefs.values.has(TRACE_DRAFT_KEY)).toBe(true);
  });

  it('blocks a ride that leaves the city before calling the API', async () => {
    const r = await rig();
    await r.rec.start('ornek-test-sehri');
    await ride(r, walk(5, [34.0995, 42.53]));
    await r.rec.finish();
    expect(r.rec.issues()).toContain('outside-city');
    expect((await r.rec.submit()).ok).toBe(false);
    expect(r.contributions.uploadTrace.calls).toHaveLength(0);
  });

  it('refuses to send a ride with fewer than two points', async () => {
    const r = await rig();
    await r.rec.start('ornek-test-sehri');
    await ride(r, walk(1));
    await r.rec.finish();
    expect(r.rec.issues()).toContain('too-few');
    expect((await r.rec.submit()).ok).toBe(false);
  });

  it('discards the ride and its stored draft', async () => {
    const r = await rig();
    await r.rec.start('ornek-test-sehri');
    await ride(r, walk(12));
    await r.rec.discard();
    expect(r.rec.view()).toBe('idle');
    expect(r.rec.pointCount()).toBe(0);
    expect(r.positions.watching).toBe(false);
    expect(r.prefs.values.has(TRACE_DRAFT_KEY)).toBe(false);
  });

  it('deletes the uploaded trace on the server', async () => {
    const r = await rig();
    await r.rec.start('ornek-test-sehri');
    await ride(r, walk(10));
    await r.rec.finish();
    await r.rec.submit();
    const id = r.rec.uploaded()?.id;
    expect(await r.rec.deleteUploaded()).toBe(true);
    expect(r.contributions.deleteTrace.calls).toEqual([[id]]);
    expect(r.rec.view()).toBe('idle');
  });

  it('pauses with an explanation when the location service cannot start', async () => {
    const r = await rig();
    r.positions.failWatch = true;
    await r.rec.start('ornek-test-sehri');
    expect(r.rec.view()).toBe('paused');
    expect(r.rec.problem()).toBe('unavailable');
  });
});
