import { assertPublicPath } from '../public-path';

export const BRAND = 'İnecek Var';
export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 155;

export function clampText(value: string, max: number): string {
  if (!Number.isInteger(max) || max < 1) {
    throw new Error('Invalid text limit');
  }
  // Line and paragraph breaks separate words, so they become spaces; other control characters
  // are dropped. Whitespace then collapses.
  const text = value
    .replace(/[\t\n\v\f\r\u0085\u2028\u2029]/g, ' ')
    // eslint-disable-next-line no-control-regex -- matching control characters is the point
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const points = Array.from(text);
  if (points.length <= max) {
    return text;
  }
  const prefix = points.slice(0, max - 1);
  const space = prefix.lastIndexOf(' ');
  const end = space >= max * 0.6 ? space : prefix.length;
  return prefix.slice(0, end).join('').trimEnd() + '…';
}

export function pageTitle(subject: string | null): string {
  if (subject === null) {
    return BRAND;
  }
  const suffix = ' | ' + BRAND;
  const title = clampText(subject, TITLE_MAX - Array.from(suffix).length);
  return title ? title + suffix : BRAND;
}

export function siteUrl(canonicalOrigin: string, path: string): string {
  assertPublicPath(path);
  const origin = new URL(canonicalOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== canonicalOrigin) {
    throw new Error('Invalid canonical origin');
  }
  return canonicalOrigin + path;
}

export interface PageSeo {
  title: string | null;
  description: string;
  path: string;
  index?: boolean;
  follow?: boolean;
  alternates?: { en?: string };
  ogType?: 'website' | 'article';
  ogImagePath?: string;
  appBanner?: boolean;
  page?: number;
  pagination?: { prevPage: number | null; nextPage: number | null };
}

export function pagePath(path: string, page?: number): string {
  assertPublicPath(path);
  if (page !== undefined && (!Number.isInteger(page) || page < 1 || page > 9999)) {
    throw new RangeError('Invalid page number');
  }
  return path + (page !== undefined && page > 1 ? `?sayfa=${page}` : '');
}
