import { isLineMode, LineMode } from '@inecekvar/domain';
import { AppLang } from '../i18n/translation';

/** The API types `mode` as a string; anything outside the enum is shown as a dolmuş. */
export function lineMode(value: string): LineMode {
  return isLineMode(value) ? value : 'dolmus';
}

/** Turkish-aware case folding for client-side matching (İ/i and I/ı fold together). */
export function fold(value: string): string {
  return value
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .trim();
}

const LOCALES: Record<AppLang, string> = { tr: 'tr-TR', en: 'en-GB' };

/** A calendar date such as "12 Ekim 2026"; `null` for a missing or unparsable value. */
export function formatDate(iso: string | null | undefined, lang: AppLang): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(LOCALES[lang], { dateStyle: 'long' }).format(date);
}

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres between two `[lng, lat]` points. */
export function distanceMeters(a: readonly number[], b: readonly number[]): number {
  const [lng1 = 0, lat1 = 0] = a;
  const [lng2 = 0, lat2 = 0] = b;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A byte count such as "840 kB" or "1,2 MB" (decimal units, as storage settings show them). */
export function formatBytes(bytes: number, lang: AppLang): string {
  const units = ['B', 'kB', 'MB', 'GB'];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  const text = new Intl.NumberFormat(LOCALES[lang], { maximumFractionDigits: digits }).format(
    value,
  );
  return `${text} ${units[unit]}`;
}

/** True when `[lng, lat]` lies inside `[minLng, minLat, maxLng, maxLat]`. */
export function inBbox(point: readonly number[], bbox: readonly number[]): boolean {
  const [lng = NaN, lat = NaN] = point;
  const [minLng = -180, minLat = -90, maxLng = 180, maxLat = 90] = bbox;
  return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
}
