import { inject, Injectable } from '@angular/core';
import { PREFERENCE_STORE } from '../city/city.store';
import { LngLat } from './simplify';

/** Preferences key of the one local ride draft. */
export const TRACE_DRAFT_KEY = 'iv.trace-draft';
/**
 * Raw points kept on the device. A longer ride is compacted in place (Douglas-Peucker at a
 * couple of metres) so the stored draft stays well under a megabyte.
 */
export const MAX_DRAFT_POINTS = 20_000;
export const MAX_MARKED_STOPS = 50;
/** `Name` in the API contract. */
export const MAX_STOP_NAME = 160;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type DraftPhase = 'recording' | 'paused' | 'review';

export interface MarkedStop {
  at: LngLat;
  /** Optional while riding; required before the stop is proposed. */
  name: string | null;
}

/**
 * A ride in progress or waiting for review. It holds positions only: no per-point time, speed
 * or accuracy; the upload needs just the start and end time of the ride.
 */
export interface TraceDraft {
  v: 1;
  city: string;
  startedAt: string;
  endedAt: string | null;
  phase: DraftPhase;
  points: LngLat[];
  stops: MarkedStop[];
}

/** Six decimals is about 10 cm: more than GPS can tell, less to store. */
export function roundPoint(lng: number, lat: number): LngLat {
  return [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
}

function isPoint(value: unknown): value is LngLat {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 90
  );
}

function isIso(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

/** Reads a stored draft; anything malformed, oversized or of another version is refused. */
export function parseDraft(raw: string | null): TraceDraft | null {
  if (raw === null || raw.length > 2_000_000) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const d = value as Record<string, unknown>;
  if (d['v'] !== 1) return null;
  if (typeof d['city'] !== 'string' || !SLUG.test(d['city']) || d['city'].length > 80) return null;
  if (!isIso(d['startedAt'])) return null;
  if (d['endedAt'] !== null && !isIso(d['endedAt'])) return null;
  if (d['phase'] !== 'recording' && d['phase'] !== 'paused' && d['phase'] !== 'review') return null;
  const points = d['points'];
  if (!Array.isArray(points) || points.length > MAX_DRAFT_POINTS || !points.every(isPoint)) {
    return null;
  }
  const stops = d['stops'];
  if (!Array.isArray(stops) || stops.length > MAX_MARKED_STOPS) return null;
  const parsedStops: MarkedStop[] = [];
  for (const stop of stops) {
    if (typeof stop !== 'object' || stop === null) return null;
    const s = stop as Record<string, unknown>;
    const name = s['name'];
    if (!isPoint(s['at'])) return null;
    if (name !== null && (typeof name !== 'string' || name.length > MAX_STOP_NAME)) return null;
    parsedStops.push({ at: [s['at'][0], s['at'][1]], name });
  }
  return {
    v: 1,
    city: d['city'],
    startedAt: d['startedAt'],
    endedAt: d['endedAt'],
    phase: d['phase'],
    points: points.map((p: LngLat) => [p[0], p[1]]),
    stops: parsedStops,
  };
}

/**
 * The ride draft in Capacitor Preferences (app storage natively, localStorage on the web): it
 * survives the app being killed mid-ride. Positions are not secrets but are personal, so the
 * draft is removed as soon as the trace is uploaded or the user discards it.
 */
@Injectable({ providedIn: 'root' })
export class TraceDraftStore {
  private readonly prefs = inject(PREFERENCE_STORE);

  async load(): Promise<TraceDraft | null> {
    let raw: string | null;
    try {
      raw = await this.prefs.get(TRACE_DRAFT_KEY);
    } catch {
      return null;
    }
    const draft = parseDraft(raw);
    if (raw !== null && draft === null) await this.clear();
    return draft;
  }

  /** False when the device refused the write (storage full or blocked). */
  async save(draft: TraceDraft): Promise<boolean> {
    try {
      await this.prefs.set(TRACE_DRAFT_KEY, JSON.stringify(draft));
      return true;
    } catch {
      return false;
    }
  }

  async clear(): Promise<void> {
    try {
      await this.prefs.remove(TRACE_DRAFT_KEY);
    } catch {
      // Nothing more can be done; the next load refuses nothing it cannot read.
    }
  }
}
