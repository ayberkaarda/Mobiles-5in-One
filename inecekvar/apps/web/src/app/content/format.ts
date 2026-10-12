import { formatFareMinor } from '@inecekvar/domain';
import { clampText } from '../seo/seo';
import { isTimestamp } from './public-types';

const dateFormatter = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Istanbul',
});
const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Europe/Istanbul',
});

export function normalizeText(value: string): string {
  return clampText(value, Math.max(1, Array.from(value).length));
}

export function formatTurkishDate(iso: string): string {
  return isTimestamp(iso) ? dateFormatter.format(new Date(iso)) : '';
}

export function isoDateOnly(iso: string): string {
  if (!isTimestamp(iso)) return '';
  const parts = partsFormatter.formatToParts(new Date(iso));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function formatFare(minor: number | null): string | null {
  if (minor === null) return null;
  try {
    return formatFareMinor(minor);
  } catch {
    return null;
  }
}

export function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function clipWords(text: string, max: number): string {
  if (!Number.isSafeInteger(max) || max < 0) throw new RangeError('Invalid word limit');
  const words = text.trim() ? text.trim().split(/\s+/) : [];
  const prefix = words.slice(0, max).join(' ');
  return words.length > max ? prefix + '…' : prefix;
}
