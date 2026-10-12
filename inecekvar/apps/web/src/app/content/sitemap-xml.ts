import { escapeXmlText } from '@inecekvar/ui';
import { assertPublicPath } from '../public-path';
import { siteUrl } from '../seo/seo';
import { CitySitemap, isSlug, isTimestamp, SitemapIndex } from './public-types';

export interface SitemapUrl {
  path: string;
  lastmod?: string;
}

const MAX_URLS = 50000;
const declaration = '<?xml version="1.0" encoding="UTF-8"?>';
const namespace = 'http://www.sitemaps.org/schemas/sitemap/0.9';

function lastmodXml(value: string | undefined): string {
  if (!isTimestamp(value)) return '';
  const date = new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `<lastmod>${date}</lastmod>`;
}

function documentXml(origin: string, entries: SitemapUrl[], index: boolean): string {
  siteUrl(origin, '/');
  if (entries.length > MAX_URLS) throw new RangeError('Sitemap URL limit exceeded');
  const root = index ? 'sitemapindex' : 'urlset';
  const item = index ? 'sitemap' : 'url';
  const body = entries
    .map((entry) => {
      assertPublicPath(entry.path);
      return (
        `<${item}><loc>${escapeXmlText(origin + entry.path)}</loc>` +
        lastmodXml(entry.lastmod) +
        `</${item}>`
      );
    })
    .join('');
  return `${declaration}<${root} xmlns="${namespace}">${body}</${root}>`;
}

export function sitemapIndexXml(
  origin: string,
  entries: { path: string; lastmod: string }[],
): string {
  return documentXml(origin, entries, true);
}

export function urlSetXml(origin: string, entries: SitemapUrl[]): string {
  return documentXml(origin, entries, false);
}

export function citySitemapEntries(
  sitemap: CitySitemap,
  city: { lastmod: string | null; isSample: boolean },
): { path: string; lastmod: string }[] {
  if (city.isSample) return [];
  if (!isSlug(sitemap.city)) throw new Error('Invalid city slug');
  const base = '/' + sitemap.city;
  const entries = [
    { path: base, lastmod: sitemap.lastmod },
    { path: base + '/hatlar', lastmod: sitemap.lastmod },
    ...sitemap.lines.map((line) => {
      if (!isSlug(line.slug)) throw new Error('Invalid line slug');
      return { path: `${base}/hat/${line.slug}`, lastmod: line.lastmod };
    }),
    ...sitemap.stops.map((stop) => {
      if (!isSlug(stop.slug)) throw new Error('Invalid stop slug');
      return { path: `${base}/durak/${stop.slug}`, lastmod: stop.lastmod };
    }),
  ];
  if (entries.length > MAX_URLS) throw new RangeError('Sitemap URL limit exceeded');
  return entries;
}

export function sitemapIndexEntries(index: SitemapIndex): { path: string; lastmod: string }[] {
  return index.cities
    .filter((city) => !city.is_sample)
    .map((city) => {
      if (!isSlug(city.slug)) throw new Error('Invalid city slug');
      return { path: `/sitemaps/${city.slug}.xml`, lastmod: city.lastmod };
    });
}
