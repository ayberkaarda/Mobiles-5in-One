import { MAX_FARE_MINOR } from '@inecekvar/domain';

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface CityOut {
  name: string;
  slug: string;
  is_sample: boolean;
  bbox: [number, number, number, number];
  centroid: [number, number];
  timezone: string;
  pack_version: number;
  published_line_count: number;
}

export interface LineSummary {
  slug: string;
  code: string;
  name: string;
  mode: string;
}

export interface RecentLineOut extends LineSummary {
  updated_at: string;
}

export interface CityDetailOut extends CityOut {
  recently_updated_lines: RecentLineOut[];
  popular_lines: LineSummary[];
  lastmod: string | null;
}

export type CityDetail = CityDetailOut;
export type CityList = CityOut[];

export interface StopRef {
  slug: string;
  name: string;
}

export interface StopOut extends StopRef {
  id: string;
  kind: string;
  location: [number, number];
}

export interface StopDetail extends StopOut {
  lines: LineSummary[];
}

export interface StopPairOut {
  from_stop: StopRef;
  to_stop: StopRef;
  shared_line_count: number;
}

export interface StopPairsOut {
  city: string;
  basis: 'shared_published_lines';
  pairs: StopPairOut[];
}

export interface LineListOut extends LineSummary {
  id: string;
}

export type LineList = LineListOut[];

export interface GeoJSONLineString {
  type: 'LineString';
  coordinates: [number, number][];
}

export interface LineOut extends LineListOut {
  status: string;
  version_no: number;
  published_at: string;
  geometry: GeoJSONLineString;
  stops: StopOut[];
  fare_minor: number | null;
  fare_updated_at: string | null;
  hours_text: string | null;
  payment_methods: string[];
  hail_notes: string | null;
  last_verified_at: string | null;
  contributor_count: number;
}

export interface SitemapCityOut {
  slug: string;
  lastmod: string;
  is_sample: boolean;
  published_line_count: number;
}

export interface SitemapIndexOut {
  cities: SitemapCityOut[];
}

export type SitemapIndex = SitemapIndexOut;

export interface SitemapEntry {
  slug: string;
  lastmod: string;
}

export interface CitySitemap {
  city: string;
  lastmod: string;
  lines: SitemapEntry[];
  stops: SitemapEntry[];
}

export function isSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 120 && SLUG_PATTERN.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max * 2 && Array.from(value).length <= max;
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function boundedArray<T>(
  value: unknown,
  max: number,
  guard: (item: unknown) => item is T,
): value is T[] {
  if (!Array.isArray(value) || value.length > max) return false;
  for (const item of value) {
    if (!guard(item)) return false;
  }
  return true;
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
}

export function isTimestamp(value: unknown): value is string {
  return (
    text(value, 64) &&
    /(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function nullableDate(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

export function isLocation(value: unknown): value is [number, number] {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [lon, lat] = value as unknown[];
  return (
    typeof lon === 'number' &&
    Number.isFinite(lon) &&
    lon >= -180 &&
    lon <= 180 &&
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90
  );
}

function isBounds(value: unknown): value is [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4) return false;
  const lower = value.slice(0, 2);
  const upper = value.slice(2);
  return isLocation(lower) && isLocation(upper) && lower[0] <= upper[0] && lower[1] <= upper[1];
}

function isCity(value: unknown): value is CityOut {
  if (!record(value)) return false;
  return (
    text(value['name'], 200) &&
    isSlug(value['slug']) &&
    typeof value['is_sample'] === 'boolean' &&
    isBounds(value['bbox']) &&
    isLocation(value['centroid']) &&
    text(value['timezone'], 100) &&
    count(value['pack_version']) &&
    count(value['published_line_count'])
  );
}

function isSummary(value: unknown): value is LineSummary {
  return (
    record(value) &&
    isSlug(value['slug']) &&
    text(value['name'], 200) &&
    text(value['code'], 40) &&
    text(value['mode'], 40)
  );
}

function isRecentLine(value: unknown): value is RecentLineOut {
  return isSummary(value) && record(value) && isTimestamp(value['updated_at']);
}

function isListLine(value: unknown): value is LineListOut {
  return isSummary(value) && record(value) && uuid(value['id']);
}

function isStopRef(value: unknown): value is StopRef {
  return record(value) && isSlug(value['slug']) && text(value['name'], 200);
}

function isStop(value: unknown): value is StopOut {
  return (
    isStopRef(value) &&
    record(value) &&
    uuid(value['id']) &&
    text(value['kind'], 40) &&
    isLocation(value['location'])
  );
}

function isPair(value: unknown): value is StopPairOut {
  return (
    record(value) &&
    isStopRef(value['from_stop']) &&
    isStopRef(value['to_stop']) &&
    count(value['shared_line_count'])
  );
}

function isGeometry(value: unknown): value is GeoJSONLineString {
  return (
    record(value) &&
    value['type'] === 'LineString' &&
    boundedArray(value['coordinates'], 20000, isLocation)
  );
}

function isSitemapEntry(value: unknown): value is SitemapEntry {
  return record(value) && isSlug(value['slug']) && isTimestamp(value['lastmod']);
}

function isSitemapCity(value: unknown): value is SitemapCityOut {
  return (
    isSitemapEntry(value) &&
    record(value) &&
    typeof value['is_sample'] === 'boolean' &&
    count(value['published_line_count'])
  );
}

export function isCityList(value: unknown): value is CityList {
  return boundedArray(value, 500, isCity);
}

export function isCityDetail(value: unknown): value is CityDetail {
  return (
    isCity(value) &&
    record(value) &&
    nullableDate(value['lastmod']) &&
    boundedArray(value['recently_updated_lines'], 500, isRecentLine) &&
    boundedArray(value['popular_lines'], 500, isSummary)
  );
}

export function isLineList(value: unknown): value is LineList {
  return boundedArray(value, 500, isListLine);
}

export function isLine(value: unknown): value is LineOut {
  if (!isListLine(value) || !record(value)) return false;
  const fare = value['fare_minor'];
  return (
    text(value['status'], 40) &&
    count(value['version_no']) &&
    isTimestamp(value['published_at']) &&
    isGeometry(value['geometry']) &&
    boundedArray(value['stops'], 2000, isStop) &&
    (fare === null || (count(fare) && fare <= MAX_FARE_MINOR)) &&
    nullableDate(value['fare_updated_at']) &&
    nullableDate(value['last_verified_at']) &&
    (value['hours_text'] === null || text(value['hours_text'], 2000)) &&
    (value['hail_notes'] === null || text(value['hail_notes'], 2000)) &&
    boundedArray(value['payment_methods'], 10, (item): item is string => text(item, 40)) &&
    count(value['contributor_count'])
  );
}

export function isStopDetail(value: unknown): value is StopDetail {
  return isStop(value) && record(value) && boundedArray(value['lines'], 500, isSummary);
}

export function isStopPairs(value: unknown): value is StopPairsOut {
  return (
    record(value) &&
    isSlug(value['city']) &&
    value['basis'] === 'shared_published_lines' &&
    boundedArray(value['pairs'], 500, isPair)
  );
}

export function isSitemapIndex(value: unknown): value is SitemapIndex {
  return record(value) && boundedArray(value['cities'], 500, isSitemapCity);
}

export function isCitySitemap(value: unknown): value is CitySitemap {
  return (
    record(value) &&
    isSlug(value['city']) &&
    isTimestamp(value['lastmod']) &&
    boundedArray(value['lines'], 50000, isSitemapEntry) &&
    boundedArray(value['stops'], 50000, isSitemapEntry)
  );
}

export function modeLabel(mode: string): string {
  switch (mode) {
    case 'dolmus':
      return 'dolmuş';
    case 'minibus':
      return 'minibüs';
    case 'servis':
      return 'servis';
    default:
      return 'hat';
  }
}

export function paymentLabel(method: string): string | null {
  switch (method) {
    case 'nakit':
      return 'nakit';
    case 'kart':
      return 'kart';
    case 'istanbulkart':
      return 'İstanbulkart';
    default:
      return null;
  }
}
