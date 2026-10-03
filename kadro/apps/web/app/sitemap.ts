import { loadWebEnv } from '@kadro/config';
import type { MetadataRoute } from 'next';
import { connection } from 'next/server';

import { districtPath, venuePath } from '../components/seo/format';
import { loadCollection } from '../lib/content/documents';
import { sitemapRows } from '../lib/server/seo/data';

/**
 * `/sitemap.xml` (product spec §7). Built per request because it reads the database and the
 * configured origin; the database rows come from the five-minute data cache
 * (`lib/server/seo/data.ts`). Each page group contributes its own block of entries; pages with
 * `noindex` (sample venues, districts without a live call) are never listed.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const origin = loadWebEnv().WEB_ORIGIN;
  const url = (path: string) => new URL(path, origin).toString();
  const seo = await sitemapRows();
  const articles = loadCollection('blog');
  const legalPaths = ['/gizlilik', '/kvkk-aydinlatma', '/iletisim'] as const;
  return [
    // Marketing pages (ADR-0056).
    { url: url('/'), changeFrequency: 'weekly', priority: 1 },
    { url: url('/ozellikler'), changeFrequency: 'monthly', priority: 0.8 },
    // FAQ page (ADR-0083).
    { url: url('/sss'), changeFrequency: 'monthly', priority: 0.6 },
    // Blog and legal pages (ADR-0080): dates come from the content front matter.
    {
      url: url('/blog'),
      lastModified: articles[0]?.modifiedAt,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    ...articles.map((article) => ({
      url: url(`/blog/${article.slug}`),
      lastModified: article.modifiedAt,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
    ...legalPaths.map((path) => ({
      url: url(path),
      changeFrequency: 'yearly' as const,
      priority: 0.3,
    })),
    // Programmatic SEO pages (ADR-0057).
    ...seo.districts.map((row) => ({
      url: url(districtPath(row.ilSlug, row.slug)),
      changeFrequency: 'hourly' as const,
      priority: 0.7,
    })),
    ...seo.venues.map((row) => ({
      url: url(venuePath(row.slug)),
      lastModified: row.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
  ];
}
