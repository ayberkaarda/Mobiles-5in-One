import { clampText, DESCRIPTION_MAX } from '../seo/seo';
import { formatFare, formatTurkishDate, normalizeText } from './format';
import { CityDetail, LineOut, modeLabel } from './public-types';

const SUBJECT_MAX = 46;
const length = (text: string) => Array.from(text).length;
const description = (text: string) => clampText(text, DESCRIPTION_MAX);

function subjectWithSuffix(name: string, suffix: string): string {
  return clampText(normalizeText(name), SUBJECT_MAX - length(suffix)) + suffix;
}

export function lineSubject(name: string, mode: string): string {
  const clean = normalizeText(name);
  const label = modeLabel(mode);
  const candidates = [
    `${clean} ${label} hattı: duraklar, ücret, saatler`,
    `${clean} ${label} hattı: duraklar ve ücret`,
    `${clean} ${label} hattı`,
  ];
  return (
    candidates.find((value) => length(value) <= SUBJECT_MAX) ??
    subjectWithSuffix(clean, ` ${label} hattı`)
  );
}

export function lineDescription(line: LineOut, cityName: string): string {
  const first = line.stops[0];
  const last = line.stops[line.stops.length - 1];
  const ends =
    line.stops.length >= 2 && first && last
      ? `, ${normalizeText(first.name)} – ${normalizeText(last.name)}`
      : '';
  const fare = formatFare(line.fare_minor);
  const date = line.fare_updated_at ? formatTurkishDate(line.fare_updated_at) : '';
  const price = fare ? ` Ücret ${fare}${date ? ` (${date})` : ''}.` : '';
  return description(
    `${normalizeText(line.name)} ${modeLabel(line.mode)} hattı (${normalizeText(cityName)}): ` +
      `${line.stops.length} durak${ends}.${price} Saatler, ödeme ve durdurma notları.`,
  );
}

export function citySubject(cityName: string): string {
  return subjectWithSuffix(cityName, ' dolmuş ve minibüs hatları');
}

export function cityDescription(city: CityDetail): string {
  const opening =
    city.published_line_count === 0
      ? `${normalizeText(city.name)} için henüz yayımlanmış hat yok.`
      : `${normalizeText(city.name)} için ${city.published_line_count} yayımlanmış dolmuş, minibüs ve servis hattı: duraklar, ücretler, saatler.`;
  return description(opening + ' Mahallelinin birlikte güncellediği hat rehberi.');
}

function pageNumber(page: number): number {
  return Number.isSafeInteger(page) && page > 1 ? page : 1;
}

export function lineListSubject(cityName: string, page: number): string {
  const n = pageNumber(page);
  return subjectWithSuffix(cityName, ' hat listesi' + (n > 1 ? ` (sayfa ${n})` : ''));
}

export function lineListDescription(cityName: string, page: number): string {
  const n = pageNumber(page);
  return description(
    `${normalizeText(cityName)} için yayımlanmış dolmuş, minibüs ve servis hatları` +
      (n > 1 ? ` (sayfa ${n})` : '') +
      ': duraklar, ücretler, saatler. Mahallelinin birlikte güncellediği hat rehberi.',
  );
}

export function stopSubject(stopName: string, cityName: string): string {
  const clean = normalizeText(stopName);
  const suffix = ' durağı: geçen hatlar';
  const withCity = `${clean}${suffix} (${normalizeText(cityName)})`;
  if (length(withCity) <= SUBJECT_MAX) return withCity;
  return subjectWithSuffix(clean, suffix);
}

export function stopDescription(stopName: string, cityName: string, lineCount: number): string {
  return description(
    `${normalizeText(stopName)} durağı (${normalizeText(cityName)}): ` +
      `bu duraktan geçen ${lineCount} hat, ücret ve saat bilgisi.`,
  );
}

export function routeSubject(fromName: string, toName: string): string {
  const from = normalizeText(fromName);
  const to = normalizeText(toName);
  const suffix = ' arası hatlar';
  const budget = SUBJECT_MAX - length(suffix) - 1;
  const fromBudget = Math.min(length(from), Math.max(Math.ceil(budget / 2), budget - length(to)));
  const toBudget = budget - fromBudget;
  return `${clampText(from, Math.max(1, fromBudget))}–${clampText(to, Math.max(1, toBudget))}${suffix}`;
}

export function routeDescription(fromName: string, toName: string, lineCount: number): string {
  return description(
    `${normalizeText(fromName)} ile ${normalizeText(toName)} arasında ` +
      `aynı hatla gidilebilen ${lineCount} dolmuş ve minibüs hattı.`,
  );
}
