import { SITE_DESCRIPTION, SITE_NAME } from '../../../components/marketing/site';
import type { JsonLdObject, JsonLdValue } from '../../../components/seo/json-ld';
import type { ContentDocument } from '../../content/documents';

/**
 * JSON-LD of the marketing pages, the blog index and the articles (product spec §7, ADR-0080),
 * rendered through the one escaping helper `components/seo/json-ld.tsx`. Absolute URLs are built
 * from the configured web origin. No logo, rating, price or store URL is claimed: none exists.
 */

interface Crumb {
  readonly name: string;
  readonly path: string;
}

function absolute(origin: string, path: string): string {
  return new URL(path, origin).toString();
}

function breadcrumbs(origin: string, crumbs: readonly Crumb[]): JsonLdObject {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: absolute(origin, crumb.path),
    })),
  };
}

function organizationId(origin: string): string {
  return `${absolute(origin, '/')}#organizasyon`;
}

function organization(origin: string): JsonLdObject {
  return {
    '@type': 'Organization',
    '@id': organizationId(origin),
    name: SITE_NAME,
    url: absolute(origin, '/'),
    description: SITE_DESCRIPTION,
  };
}

/**
 * `Organization` and `MobileApplication` of the home page and `/ozellikler`. The application is
 * free to install (Kadro Pro is a store subscription whose price the stores set, ADR-0056, so no
 * Pro offer or price is stated); it has no `downloadUrl` because no store listing exists yet.
 */
export function siteStructuredData(origin: string): JsonLdObject {
  const graph: JsonLdValue[] = [
    organization(origin),
    {
      '@type': 'MobileApplication',
      '@id': `${absolute(origin, '/')}#uygulama`,
      name: SITE_NAME,
      url: absolute(origin, '/'),
      description: SITE_DESCRIPTION,
      applicationCategory: 'SportsApplication',
      operatingSystem: 'iOS, Android',
      inLanguage: 'tr-TR',
      publisher: { '@id': organizationId(origin) },
      offers: {
        '@type': 'Offer',
        name: 'Kadro (ücretsiz)',
        price: 0,
        priceCurrency: 'TRY',
      },
    },
  ];
  return { '@context': 'https://schema.org', '@graph': graph };
}

/** `BreadcrumbList` and `Blog` of the blog index. */
export function blogIndexStructuredData(origin: string, description: string): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      breadcrumbs(origin, [
        { name: SITE_NAME, path: '/' },
        { name: 'Blog', path: '/blog' },
      ]),
      {
        '@type': 'Blog',
        '@id': `${absolute(origin, '/blog')}#blog`,
        name: `${SITE_NAME} Blog`,
        url: absolute(origin, '/blog'),
        description,
        inLanguage: 'tr-TR',
        publisher: { '@id': organizationId(origin) },
      },
      organization(origin),
    ],
  };
}

/** `BreadcrumbList` and `Article` of one blog article. */
export function articleStructuredData(
  origin: string,
  article: ContentDocument,
  path: string,
): JsonLdObject {
  const url = absolute(origin, path);
  const node: Record<string, JsonLdValue> = {
    '@type': 'Article',
    '@id': `${url}#makale`,
    headline: article.title,
    description: article.description,
    url,
    mainEntityOfPage: url,
    inLanguage: 'tr-TR',
    datePublished: article.publishedAt,
    dateModified: article.modifiedAt,
    wordCount: article.wordCount,
    author: { '@id': organizationId(origin) },
    publisher: { '@id': organizationId(origin) },
  };
  if (article.tags.length > 0) {
    node.keywords = article.tags.join(', ');
  }
  return {
    '@context': 'https://schema.org',
    '@graph': [
      breadcrumbs(origin, [
        { name: SITE_NAME, path: '/' },
        { name: 'Blog', path: '/blog' },
        { name: article.title, path },
      ]),
      node,
      organization(origin),
    ],
  };
}
