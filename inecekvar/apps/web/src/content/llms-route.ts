import type { Express } from 'express';
import { urlSetXml } from '../app/content/sitemap-xml';
import { FACTS } from './facts';
import { llmsFullTxt, llmsTxt } from './llms';
import { GUIDES } from './guides';
import { STATIC_PAGES } from './pages';

/** Paths of the static content pages that may be indexed. */
export function indexablePagePaths(): string[] {
  return [
    ...STATIC_PAGES.filter((page) => page.index !== false).map((page) => page.path),
    ...GUIDES.map((guide) => guide.path),
  ];
}

/** `/sitemap-pages.xml`: the static pages, with the content date as the honest `lastmod`. */
export function pagesSitemapXml(origin: string): string {
  return urlSetXml(
    origin,
    indexablePagePaths().map((path) => ({
      path,
      lastmod: `${FACTS.contentDate}T00:00:00Z`,
    })),
  );
}

/**
 * Registers `/llms.txt`, `/llms-full.txt` (plain text built from the shared facts) and
 * `/sitemap-pages.xml`.
 */
export function registerContentFiles(app: Express, canonicalOrigin: string): void {
  const files = [
    ['/llms.txt', 'text/plain; charset=utf-8', () => llmsTxt(canonicalOrigin)],
    ['/llms-full.txt', 'text/plain; charset=utf-8', () => llmsFullTxt(canonicalOrigin)],
    [
      '/sitemap-pages.xml',
      'application/xml; charset=utf-8',
      () => pagesSitemapXml(canonicalOrigin),
    ],
  ] as const;
  for (const [path, contentType, build] of files) {
    app.get(path, (_req, res) => {
      res.status(200).set('Cache-Control', 'public, max-age=3600').type(contentType).send(build());
    });
  }
}
