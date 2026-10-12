import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { ContributionApi, isApiError, SessionStore, TraceCreated } from '@inecekvar/data-access';
import { LicenceGate } from '../auth/licence-gate';
import { CityStore } from '../city/city.store';
import { TranslationKey } from '../i18n/translation';
import { APP_NOW } from '../shared/countdown';
import { distanceMeters, inBbox } from '../shared/format';
import { Fix, POSITION_SOURCE, PositionWatch, WAKE_LOCK } from './position-source';
import { douglasPeucker, LngLat, MAX_TRACE_POINTS, simplifyToCap } from './simplify';
import {
  MAX_DRAFT_POINTS,
  MAX_MARKED_STOPS,
  MAX_STOP_NAME,
  MarkedStop,
  roundPoint,
  TraceDraft,
  TraceDraftStore,
} from './trace-draft';

/** Fixes less precise than this are ignored (a bus stop is about 30 m long). */
export const MAX_ACCURACY_M = 50;
/** A new point is kept once the rider moved at least this far from the last one. */
export const MIN_SPACING_M = 5;
/**
 * New points are written at most this often while riding (a killed app loses at most this much),
 * and at once on pause, stop marks, review and when the app is hidden.
 */
export const SAVE_EVERY_MS = 15_000;
/** API bounds of `TraceInput` (api/app/traces/router.py). */
export const MAX_TRACE_HOURS = 12;
export const MAX_TRACE_METRES = 150_000;

export type RecorderView =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'paused'
  | 'review'
  | 'uploading'
  | 'uploaded'
  | 'discarding'
  | 'cleanup';

export type RecorderProblem = 'denied' | 'unavailable' | 'storage';

export type ReviewIssue = 'too-few' | 'outside-city' | 'too-long-time' | 'too-long-distance';

export function pathLength(points: readonly LngLat[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distanceMeters(points[i - 1] as LngLat, points[i] as LngLat);
  }
  return total;
}

/** ISO time without milliseconds: the API needs no more precision than that. */
function isoSeconds(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

export interface SubmitResult {
  ok: boolean;
  /** Seconds to wait, for a 429. */
  retryAfter?: number | null;
}

/**
 * Records a ride (user story 5): foreground positions while the app is open, pause and resume,
 * stop marks, then a review before anything is sent. The draft is written to Preferences so a
 * killed app resumes paused; it is deleted after a successful upload or a discard. Points are
 * simplified on the device to at most 5000 before upload; the start and end are not trimmed
 * here, the API cuts 200 m at both ends when it derives a line (ADR-0022).
 */
@Injectable({ providedIn: 'root' })
export class RecorderStore {
  private readonly positions = inject(POSITION_SOURCE);
  private readonly wakeLock = inject(WAKE_LOCK);
  private readonly drafts = inject(TraceDraftStore);
  private readonly api = inject(ContributionApi);
  private readonly licence = inject(LicenceGate);
  private readonly cities = inject(CityStore);
  private readonly now = inject(APP_NOW);
  private readonly document = inject(DOCUMENT);
  private readonly session = inject(SessionStore);
  private readonly identity = computed(() => this.session.user()?.id ?? null);
  private owner = this.identity();
  private generation = 0;
  private restoreGeneration = 0;
  private uploadController: AbortController | null = null;

  private draft: TraceDraft | null = null;
  private watch: PositionWatch | null = null;
  private releaseWakeLock: (() => Promise<void>) | null = null;
  private lastFix: Fix | null = null;
  private lastSave = 0;
  private distance = 0;
  private initOnce: Promise<void> | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  /** Bumped on every change of the draft so the computed readouts update. */
  private readonly rev = signal(0);
  private readonly clock = signal(0);

  readonly view = signal<RecorderView>('idle');
  readonly problem = signal<RecorderProblem | null>(null);
  /** The last fix was too imprecise to use. */
  readonly weakSignal = signal(false);
  /** The draft was found recording after the app had been closed. */
  readonly interrupted = signal(false);
  readonly wakeLockOn = signal(false);
  readonly wakeLockSupported = this.wakeLock.supported;
  readonly submitError = signal<TranslationKey | null>(null);
  readonly uploaded = signal<TraceCreated | null>(null);
  /** Stops marked on the uploaded ride, kept in memory to propose them after the upload. */
  readonly uploadedStops = signal<readonly MarkedStop[]>([]);
  readonly uploadedCity = signal<string | null>(null);
  readonly uploadedOwnerId = signal<string | null>(null);
  readonly cleanupPending = this.drafts.cleanupPending.asReadonly();

  readonly city = computed(() => {
    this.rev();
    return this.draft?.city ?? null;
  });
  readonly pointCount = computed(() => {
    this.rev();
    return this.draft?.points.length ?? 0;
  });
  readonly distanceMetres = computed(() => {
    this.rev();
    return this.distance;
  });
  readonly stops = computed<readonly MarkedStop[]>(() => {
    this.rev();
    return this.draft ? [...this.draft.stops] : [];
  });
  readonly points = computed<readonly LngLat[]>(() => {
    this.rev();
    // A copy, so readers see a new value on every change (the draft array is mutated in place).
    return this.draft ? [...this.draft.points] : [];
  });
  readonly elapsedSeconds = computed(() => {
    this.rev();
    this.clock();
    const draft = this.draft;
    if (!draft) return 0;
    const end = draft.endedAt ? Date.parse(draft.endedAt) : this.now();
    return Math.max(0, Math.floor((end - Date.parse(draft.startedAt)) / 1000));
  });
  readonly hasFix = computed(() => {
    this.rev();
    return this.lastFix !== null;
  });
  /** What the review screen will send: the simplified line (at most 5000 points). */
  readonly simplified = computed(() => simplifyToCap(this.points()));

  readonly issues = computed<ReviewIssue[]>(() => {
    this.rev();
    const draft = this.draft;
    if (!draft) return [];
    const issues: ReviewIssue[] = [];
    const points = this.simplified().points;
    if (points.length < 2) issues.push('too-few');
    const bbox = this.cities.cities().find((c) => c.slug === draft.city)?.bbox;
    if (bbox && bbox.length === 4 && points.some((p) => !inBbox(p, bbox))) {
      issues.push('outside-city');
    }
    const end = draft.endedAt ? Date.parse(draft.endedAt) : this.now();
    if (end - Date.parse(draft.startedAt) > MAX_TRACE_HOURS * 3600_000)
      issues.push('too-long-time');
    if (pathLength(points) > MAX_TRACE_METRES) issues.push('too-long-distance');
    return issues;
  });

  constructor() {
    effect(() => {
      const owner = this.identity();
      if (owner === this.owner) return;
      this.owner = owner;
      untracked(() => {
        this.initOnce = null;
        void this.discard();
      });
    });
    const onVisibilityChange = () => {
      if (this.document.visibilityState === 'hidden') {
        if (this.draft) void this.persist();
      } else if (this.view() === 'recording' && !this.releaseWakeLock) {
        void this.holdWakeLock();
      }
    };
    this.document.addEventListener('visibilitychange', onVisibilityChange);
    inject(DestroyRef).onDestroy(() => {
      this.generation += 1;
      this.restoreGeneration += 1;
      this.uploadController?.abort();
      void this.endWatch();
      this.document.removeEventListener('visibilitychange', onVisibilityChange);
    });
  }

  /** Restores a draft left by an earlier run; a ride that was recording comes back paused. */
  init(): Promise<void> {
    this.initOnce ??= this.restore();
    return this.initOnce;
  }

  async start(city: string): Promise<void> {
    if (this.view() !== 'idle' || !this.identity()) return;
    const run = ++this.generation;
    const ownerId = this.identity();
    this.view.set('starting');
    await this.init();
    if (run !== this.generation || this.view() !== 'starting' || !ownerId) return;
    this.problem.set(null);
    this.submitError.set(null);
    this.uploaded.set(null);
    const permission = await this.positions.ensurePermission();
    if (run !== this.generation || ownerId !== this.identity()) return;
    if (permission === 'denied') {
      this.problem.set('denied');
      this.view.set('idle');
      return;
    }
    this.draft = {
      v: 1,
      id: crypto.getRandomValues(new Uint32Array(4)).join('-'),
      ownerId,
      city,
      startedAt: isoSeconds(this.now()),
      endedAt: null,
      phase: 'recording',
      points: [],
      stops: [],
    };
    this.distance = 0;
    this.lastFix = null;
    this.interrupted.set(false);
    this.changed();
    await this.persist();
    if (run === this.generation) await this.beginWatch(run);
  }

  async pause(): Promise<void> {
    if (this.view() !== 'recording' || !this.draft) return;
    const run = ++this.generation;
    this.draft.phase = 'paused';
    this.view.set('paused');
    this.changed();
    await this.endWatch();
    if (run === this.generation) await this.persist();
  }

  async resume(): Promise<void> {
    if (this.view() !== 'paused' || !this.draft) return;
    if (this.draft.ownerId !== this.identity()) return;
    const run = ++this.generation;
    const ownerId = this.identity();
    this.view.set('starting');
    this.problem.set(null);
    const permission = await this.positions.ensurePermission();
    if (run !== this.generation || ownerId !== this.identity() || !this.draft) return;
    if (permission === 'denied') {
      this.problem.set('denied');
      this.view.set('paused');
      return;
    }
    this.interrupted.set(false);
    this.draft.phase = 'recording';
    this.changed();
    await this.persist();
    if (run === this.generation) await this.beginWatch(run);
  }

  /** Ends the ride and opens the review; nothing is sent yet. */
  async finish(): Promise<void> {
    const view = this.view();
    if ((view !== 'recording' && view !== 'paused') || !this.draft) return;
    const run = ++this.generation;
    this.draft.phase = 'review';
    this.draft.endedAt = isoSeconds(this.now());
    this.interrupted.set(false);
    this.view.set('review');
    this.changed();
    await this.endWatch();
    if (run === this.generation) await this.persist();
  }

  /** Back from the review to a paused ride (the end time is set again on the next finish). */
  async backToRide(): Promise<void> {
    if (this.view() !== 'review' || !this.draft) return;
    this.generation += 1;
    this.draft.phase = 'paused';
    this.draft.endedAt = null;
    this.submitError.set(null);
    this.view.set('paused');
    this.changed();
    await this.persist();
  }

  /** One tap while riding: the current position becomes a stop, with an optional name. */
  async markStop(name?: string | null): Promise<boolean> {
    const view = this.view();
    const fix = this.lastFix;
    if (!this.draft || !fix || (view !== 'recording' && view !== 'paused')) return false;
    if (this.draft.stops.length >= MAX_MARKED_STOPS) return false;
    this.draft.stops.push({ at: roundPoint(fix.lng, fix.lat), name: cleanName(name) });
    this.changed();
    await this.persist();
    return true;
  }

  async renameStop(index: number, name: string): Promise<void> {
    const stop = this.draft?.stops[index];
    if (!stop) return;
    stop.name = cleanName(name);
    this.changed();
    await this.persist();
  }

  async removeStop(index: number): Promise<void> {
    if (!this.draft || index < 0 || index >= this.draft.stops.length) return;
    this.draft.stops.splice(index, 1);
    this.changed();
    await this.persist();
  }

  /** Throws the ride away: stops recording and deletes the local draft. */
  async discard(): Promise<void> {
    const run = ++this.generation;
    this.restoreGeneration += 1;
    this.uploadController?.abort();
    this.uploadController = null;
    this.view.set('discarding');
    const stopped = this.endWatch();
    this.draft = null;
    this.distance = 0;
    this.lastFix = null;
    this.problem.set(null);
    this.submitError.set(null);
    this.interrupted.set(false);
    this.uploaded.set(null);
    this.uploadedStops.set([]);
    this.uploadedCity.set(null);
    this.uploadedOwnerId.set(null);
    this.lastSave = 0;
    this.clock.set(0);
    this.changed();
    try {
      await this.drafts.clear();
      await stopped;
      if (run === this.generation) this.view.set('idle');
    } catch {
      await stopped;
      if (run !== this.generation) return;
      this.submitError.set('recorder.errors.cleanup');
      this.view.set('cleanup');
    }
  }

  /**
   * Sends the reviewed ride. The licence is asked first; the draft stays until the API has
   * stored the trace, so a failure (offline, 429) can be retried.
   */
  async submit(): Promise<SubmitResult> {
    const draft = this.draft;
    const endedAt = draft?.endedAt;
    if (this.view() !== 'review' || !draft || !endedAt) return { ok: false };
    const ownerId = this.identity();
    if (!ownerId || draft.ownerId !== ownerId) return { ok: false };
    if (this.issues().length > 0) return { ok: false };
    const run = ++this.generation;
    const controller = new AbortController();
    this.uploadController = controller;
    const current = () =>
      run === this.generation &&
      this.identity() === ownerId &&
      this.draft?.id === draft.id &&
      this.draft?.ownerId === ownerId;
    this.view.set('uploading');
    this.submitError.set(null);
    try {
      const accepted = await this.licence.ensure();
      if (!current()) return { ok: false };
      if (!accepted) {
        this.view.set('review');
        return { ok: false };
      }
      const points = simplifyToCap(draft.points).points;
      if (points.length > MAX_TRACE_POINTS) {
        this.view.set('review');
        return { ok: false };
      }
      const body = {
        city: draft.city,
        started_at: draft.startedAt,
        ended_at: endedAt,
        points,
      };
      let created: TraceCreated;
      try {
        created = await this.api.uploadTrace(body, controller.signal);
      } catch (error) {
        // A stale account view: the licence may still be missing on the server.
        if (!current() || !isApiError(error) || error.status !== 403) {
          throw error;
        }
        const accepted = await this.licence.recheck();
        if (!current() || !accepted) return { ok: false };
        created = await this.api.uploadTrace(body, controller.signal);
      }
      if (!current()) return { ok: false };
      await this.drafts.clear();
      if (!current()) return { ok: false };
      this.uploadedStops.set([...draft.stops]);
      this.uploadedCity.set(draft.city);
      this.uploadedOwnerId.set(ownerId);
      this.uploaded.set(created);
      this.draft = null;
      this.distance = 0;
      this.changed();
      this.view.set('uploaded');
      return { ok: true };
    } catch (error) {
      if (!current()) return { ok: false };
      this.view.set('review');
      if (this.cleanupPending()) {
        this.submitError.set('recorder.errors.cleanup');
        this.view.set('cleanup');
        return { ok: false };
      }
      const { key, retryAfter } = traceFailure(error);
      this.submitError.set(key);
      return { ok: false, retryAfter };
    } finally {
      if (this.uploadController === controller) this.uploadController = null;
      if (current() && this.view() === 'uploading') this.view.set('review');
    }
  }

  /** Deletes the uploaded trace on the server (owner only, `DELETE traces/{id}`). */
  async deleteUploaded(): Promise<boolean> {
    const trace = this.uploaded();
    if (!trace) return false;
    this.submitError.set(null);
    try {
      await this.api.deleteTrace(trace.id);
    } catch (error) {
      if (!isApiError(error) || error.status !== 404) {
        this.submitError.set(traceFailure(error).key);
        return false;
      }
    }
    this.reset();
    return true;
  }

  /** Leaves the upload confirmation. */
  reset(): void {
    this.generation += 1;
    this.uploadedOwnerId.set(null);
    this.uploaded.set(null);
    this.uploadedStops.set([]);
    this.uploadedCity.set(null);
    this.submitError.set(null);
    if (this.view() === 'uploaded') this.view.set('idle');
  }

  private async restore(): Promise<void> {
    const run = this.restoreGeneration;
    const ownerId = this.identity();
    let draft: TraceDraft | null;
    try {
      draft = await this.drafts.load(ownerId);
    } catch {
      if (run === this.restoreGeneration) {
        this.submitError.set('recorder.errors.cleanup');
        this.view.set('cleanup');
      }
      return;
    }
    if (run !== this.restoreGeneration || ownerId !== this.identity()) return;
    if (!draft) return;
    if (draft.phase === 'recording') {
      draft.phase = 'paused';
      this.interrupted.set(true);
    }
    this.draft = draft;
    this.distance = pathLength(draft.points);
    const last = draft.points[draft.points.length - 1];
    this.lastFix = last ? { lng: last[0], lat: last[1], accuracy: 0 } : null;
    this.view.set(draft.phase === 'review' ? 'review' : 'paused');
    this.changed();
    if (this.interrupted()) await this.persist();
  }

  private async beginWatch(run: number): Promise<void> {
    try {
      const watch = await this.positions.watch(
        (fix) => {
          if (run === this.generation) this.onFix(fix);
        },
        (failure) => {
          if (run === this.generation) void this.onFailure(failure);
        },
      );
      if (run !== this.generation || this.draft?.ownerId !== this.identity()) {
        await watch.stop();
        return;
      }
      this.watch = watch;
    } catch {
      if (run !== this.generation) return;
      this.problem.set('unavailable');
      if (this.draft) this.draft.phase = 'paused';
      this.view.set('paused');
      this.changed();
      await this.persist();
      return;
    }
    this.view.set('recording');
    this.startTicker();
    await this.holdWakeLock();
  }

  private async endWatch(): Promise<void> {
    const watch = this.watch;
    this.watch = null;
    const release = this.releaseWakeLock;
    this.releaseWakeLock = null;
    this.wakeLockOn.set(false);
    this.stopTicker();
    this.weakSignal.set(false);
    if (watch) await watch.stop().catch(() => undefined);
    if (release) await release().catch(() => undefined);
  }

  private async holdWakeLock(): Promise<void> {
    const run = this.generation;
    const release = await this.wakeLock.acquire();
    if (run !== this.generation || this.view() !== 'recording') {
      if (release) await release();
      return;
    }
    this.releaseWakeLock = release;
    this.wakeLockOn.set(release !== null);
  }

  private onFix(fix: Fix): void {
    const draft = this.draft;
    if (this.view() !== 'recording' || !draft) return;
    if (!Number.isFinite(fix.lng) || !Number.isFinite(fix.lat)) return;
    if (!(fix.accuracy <= MAX_ACCURACY_M)) {
      this.weakSignal.set(true);
      return;
    }
    this.weakSignal.set(false);
    if (this.problem() === 'unavailable') this.problem.set(null);
    this.lastFix = fix;
    const point = roundPoint(fix.lng, fix.lat);
    const last = draft.points[draft.points.length - 1];
    if (last) {
      const step = distanceMeters(last, point);
      if (step < MIN_SPACING_M) {
        this.changed();
        return;
      }
      this.distance += step;
    }
    draft.points.push(point);
    if (draft.points.length > MAX_DRAFT_POINTS) this.compact(draft);
    this.changed();
    if (this.now() - this.lastSave >= SAVE_EVERY_MS) void this.persist();
  }

  private async onFailure(failure: 'denied' | 'unavailable'): Promise<void> {
    if (failure === 'denied') {
      this.problem.set('denied');
      await this.pause();
    } else {
      this.problem.set('unavailable');
    }
  }

  /** Keeps a very long ride within the stored bound by simplifying the oldest detail. */
  private compact(draft: TraceDraft): void {
    let tolerance = 2;
    let points = draft.points;
    while (points.length > MAX_DRAFT_POINTS * 0.75) {
      points = douglasPeucker(points, tolerance);
      tolerance *= 2;
    }
    draft.points = points;
  }

  private async persist(): Promise<void> {
    if (!this.draft) return;
    const run = this.generation;
    this.lastSave = this.now();
    const ok = await this.drafts.save(this.draft);
    if (run !== this.generation) return;
    if (!ok) this.problem.set('storage');
    else if (this.problem() === 'storage') this.problem.set(null);
  }

  private changed(): void {
    this.rev.update((n) => n + 1);
  }

  private startTicker(): void {
    if (this.ticker !== null) return;
    this.ticker = setInterval(() => this.clock.update((n) => n + 1), 1000);
  }

  private stopTicker(): void {
    if (this.ticker !== null) clearInterval(this.ticker);
    this.ticker = null;
  }
}

function cleanName(name: string | null | undefined): string | null {
  const trimmed = (name ?? '').trim().slice(0, MAX_STOP_NAME);
  return trimmed === '' ? null : trimmed;
}

/** Copy for a failed trace upload or deletion. */
export function traceFailure(error: unknown): { key: TranslationKey; retryAfter: number | null } {
  if (!isApiError(error)) return { key: 'recorder.errors.generic', retryAfter: null };
  if (error.status === 429) {
    return { key: 'recorder.errors.rateLimited', retryAfter: error.retryAfterSeconds };
  }
  if (error.kind === 'network' || error.kind === 'timeout') {
    return { key: 'recorder.errors.offline', retryAfter: null };
  }
  switch (error.code) {
    case 'trace.outside_bbox':
      return { key: 'recorder.errors.outsideCity', retryAfter: null };
    case 'trace.future_end':
      return { key: 'recorder.errors.clock', retryAfter: null };
    case 'request.body_too_large':
      return { key: 'recorder.errors.tooLarge', retryAfter: null };
    case 'city.not_found':
      return { key: 'recorder.errors.city', retryAfter: null };
    case 'auth.required':
      return { key: 'recorder.errors.signIn', retryAfter: null };
    case 'auth.forbidden':
      return { key: 'recorder.errors.licence', retryAfter: null };
  }
  if (error.status === 422) return { key: 'recorder.errors.invalid', retryAfter: null };
  return { key: 'recorder.errors.generic', retryAfter: null };
}
