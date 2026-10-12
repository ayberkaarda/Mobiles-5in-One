import type {
  City,
  LineDetail,
  LineListItem,
  StopDetail,
  StopSummary,
} from '@inecekvar/data-access';
import { distanceMeters, fold } from '../shared/format';

/** The only dataset format this app reads (`format` in the pack, ADR-0024). */
export const PACK_FORMAT = 1;
export const MAX_PACK_LINES = 10_000;
export const MAX_PACK_STOPS = 100_000;
export const MAX_ROUTE_POINTS = 20_000;
export const MAX_LINE_STOPS = 2_000;
export const MAX_PAYMENT_METHODS = 32;

export interface PackCity {
  name: string;
  slug: string;
  is_sample: boolean;
  bbox: number[];
  centroid: number[];
  timezone: string;
}

export interface PackLine {
  slug: string;
  code: string;
  name: string;
  mode: string;
  version_no: number;
  published_at: string | null;
  geometry: number[][];
  stops: string[];
  fare_minor: number | null;
  fare_updated_at: string | null;
  hours_text: string | null;
  payment_methods: string[];
  hail_notes: string | null;
  last_verified_at: string | null;
  contributor_count: number;
}

export interface PackStop {
  slug: string;
  name: string;
  kind: string;
  location: number[];
}

/** `GET cities/{slug}/pack` body, format 1. */
export interface CityPackData {
  city: PackCity;
  pack_version: number;
  format: number;
  lines: PackLine[];
  stops: PackStop[];
}

export class PackFormatError extends Error {
  constructor(reason: string) {
    super(`invalid pack: ${reason}`);
    this.name = 'PackFormatError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isNullableString = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPoint = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length >= 2 && v.length <= 3 && v.every((n) => isNumber(n));

function checkLine(v: unknown): v is PackLine {
  if (isRecord(v)) {
    checkCollectionSize(v['geometry'], MAX_ROUTE_POINTS, 'too many route points per line');
    checkCollectionSize(v['stops'], MAX_LINE_STOPS, 'too many stops per line');
    checkCollectionSize(v['payment_methods'], MAX_PAYMENT_METHODS, 'too many payment methods');
  }
  return (
    isRecord(v) &&
    isString(v['slug']) &&
    isString(v['code']) &&
    isString(v['name']) &&
    isString(v['mode']) &&
    isNumber(v['version_no']) &&
    isNullableString(v['published_at']) &&
    Array.isArray(v['geometry']) &&
    v['geometry'].every(isPoint) &&
    Array.isArray(v['stops']) &&
    v['stops'].every(isString) &&
    (v['fare_minor'] === null || isNumber(v['fare_minor'])) &&
    isNullableString(v['fare_updated_at']) &&
    isNullableString(v['hours_text']) &&
    Array.isArray(v['payment_methods']) &&
    v['payment_methods'].every(isString) &&
    isNullableString(v['hail_notes']) &&
    isNullableString(v['last_verified_at']) &&
    isNumber(v['contributor_count'])
  );
}

function checkCollectionSize(value: unknown, limit: number, reason: string): void {
  if (Array.isArray(value) && value.length > limit) throw new PackFormatError(reason);
}

function checkStop(v: unknown): v is PackStop {
  return (
    isRecord(v) &&
    isString(v['slug']) &&
    isString(v['name']) &&
    isString(v['kind']) &&
    isPoint(v['location'])
  );
}

/**
 * Parses and checks a downloaded dataset. Anything that does not match format 1 exactly is
 * refused, so a truncated or foreign body never becomes an installed pack.
 */
export function parsePack(bytes: Uint8Array, expectedCity?: string): CityPackData {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new PackFormatError('not JSON');
  }
  if (!isRecord(raw)) throw new PackFormatError('not an object');
  if (raw['format'] !== PACK_FORMAT) throw new PackFormatError('unknown format');
  const city = raw['city'];
  if (
    !isRecord(city) ||
    !isString(city['slug']) ||
    !isString(city['name']) ||
    typeof city['is_sample'] !== 'boolean' ||
    !Array.isArray(city['bbox']) ||
    city['bbox'].length !== 4 ||
    !city['bbox'].every(isNumber) ||
    !isPoint(city['centroid']) ||
    !isString(city['timezone'])
  ) {
    throw new PackFormatError('city');
  }
  if (expectedCity !== undefined && city['slug'] !== expectedCity) {
    throw new PackFormatError('another city');
  }
  if (!isNumber(raw['pack_version'])) throw new PackFormatError('pack_version');
  const lines = raw['lines'];
  const stops = raw['stops'];
  if (Array.isArray(lines) && lines.length > MAX_PACK_LINES) {
    throw new PackFormatError('too many lines');
  }
  if (Array.isArray(stops) && stops.length > MAX_PACK_STOPS) {
    throw new PackFormatError('too many stops');
  }
  if (!Array.isArray(lines) || !lines.every(checkLine)) throw new PackFormatError('lines');
  if (!Array.isArray(stops) || !stops.every(checkStop)) throw new PackFormatError('stops');
  return raw as unknown as CityPackData;
}

/**
 * Read-side view of an installed pack, answering the same questions as the catalog API with
 * the same response shapes. Pack entries carry no database ids: `id` is the slug prefixed with
 * `pack:`, which the favourites store treats as unknown and resolves online when it syncs.
 */
export class PackIndex {
  private readonly linesBySlug = new Map<string, PackLine>();
  private readonly stopsBySlug = new Map<string, PackStop>();
  private readonly linesByStop = new Map<string, PackLine[]>();
  private readonly foldedLines: { line: PackLine; code: string; name: string }[];
  private readonly foldedStops: { stop: PackStop; name: string }[];

  constructor(readonly data: CityPackData) {
    for (const stop of data.stops) this.stopsBySlug.set(stop.slug, stop);
    const sorted = [...data.lines].sort((a, b) => a.code.localeCompare(b.code, 'tr'));
    for (const line of sorted) {
      this.linesBySlug.set(line.slug, line);
      for (const slug of new Set(line.stops)) {
        const list = this.linesByStop.get(slug) ?? [];
        list.push(line);
        this.linesByStop.set(slug, list);
      }
    }
    this.foldedLines = sorted.map((line) => ({
      line,
      code: fold(line.code),
      name: fold(line.name),
    }));
    this.foldedStops = [...data.stops]
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      .map((stop) => ({ stop, name: fold(stop.name) }));
  }

  get slug(): string {
    return this.data.city.slug;
  }

  /** The city as `GET cities` lists it, for offline use of the city picker. */
  city(): City {
    const c = this.data.city;
    return {
      name: c.name,
      slug: c.slug,
      is_sample: c.is_sample,
      bbox: c.bbox,
      centroid: c.centroid,
      timezone: c.timezone,
      pack_version: this.data.pack_version,
      published_line_count: this.data.lines.length,
    };
  }

  /** `GET lines?city=&q=`: code or name contains the query (case and accent folded). */
  searchLines(q: string | null | undefined, limit = 100): LineListItem[] {
    const needle = q ? fold(q) : '';
    return this.foldedLines
      .filter((l) => !needle || l.code.includes(needle) || l.name.includes(needle))
      .slice(0, limit)
      .map(({ line }) => ({
        id: packId(line.slug),
        slug: line.slug,
        code: line.code,
        name: line.name,
        mode: line.mode,
      }));
  }

  /** `GET lines/{slug}`, or `null` when the pack does not have the line. */
  line(slug: string): LineDetail | null {
    const line = this.linesBySlug.get(slug);
    if (!line) return null;
    return {
      id: packId(line.slug),
      slug: line.slug,
      code: line.code,
      name: line.name,
      mode: line.mode,
      status: 'published',
      version_no: line.version_no,
      published_at: line.published_at ?? '',
      geometry: { type: 'LineString', coordinates: line.geometry },
      stops: line.stops
        .map((s) => this.stopsBySlug.get(s))
        .filter((s): s is PackStop => s !== undefined)
        .map(toSummary),
      fare_minor: line.fare_minor,
      fare_updated_at: line.fare_updated_at,
      hours_text: line.hours_text,
      payment_methods: line.payment_methods,
      hail_notes: line.hail_notes,
      last_verified_at: line.last_verified_at,
      contributor_count: line.contributor_count,
    };
  }

  /** `GET stops/{slug}` with the published lines serving it, or `null`. */
  stop(slug: string): StopDetail | null {
    const stop = this.stopsBySlug.get(slug);
    if (!stop) return null;
    return {
      ...toSummary(stop),
      lines: (this.linesByStop.get(slug) ?? []).map((line) => ({
        slug: line.slug,
        code: line.code,
        name: line.name,
        mode: line.mode,
      })),
    };
  }

  /** `GET stops/near`: haversine on the device, nearest first, at most 50 like the API. */
  stopsNear(lat: number, lng: number, radius: number, limit = 50): StopSummary[] {
    const here = [lng, lat];
    return this.data.stops
      .map((stop) => ({ stop, d: distanceMeters(here, stop.location) }))
      .filter(({ d }) => d <= radius)
      .sort((a, b) => a.d - b.d || a.stop.slug.localeCompare(b.stop.slug))
      .slice(0, limit)
      .map(({ stop }) => toSummary(stop));
  }

  /** Stop names containing the query from 2 characters on. */
  searchStops(q: string, limit = 8): StopSummary[] {
    const needle = fold(q);
    if (needle.length < 2) return [];
    return this.foldedStops
      .filter((s) => s.name.includes(needle))
      .slice(0, limit)
      .map(({ stop }) => toSummary(stop));
  }
}

export const PACK_ID_PREFIX = 'pack:';
const packId = (slug: string) => PACK_ID_PREFIX + slug;

/** The API id of a line, or `undefined` for an entry read from a pack (no database id). */
export function apiLineId(id: string | undefined): string | undefined {
  return id && !id.startsWith(PACK_ID_PREFIX) ? id : undefined;
}

function toSummary(stop: PackStop): StopSummary {
  return {
    id: packId(stop.slug),
    slug: stop.slug,
    name: stop.name,
    kind: stop.kind,
    location: stop.location,
  };
}
