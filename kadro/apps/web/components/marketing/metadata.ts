import type { Metadata } from 'next';

import { SITE_DESCRIPTION, SITE_LOCALE, SITE_NAME, SITE_TITLE } from './site';

/** Product spec §7: titles at most 60 characters, descriptions at most 155. */
export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 155;

/** `%s · Kadro`: a page title plus the brand. */
export const TITLE_TEMPLATE = `%s · ${SITE_NAME}`;

/**
 * Metadata shared by every marketing page (ADR-0056): `metadataBase` from the configured web
 * origin so canonical and Open Graph URLs are absolute, the title template, and Open Graph and
 * Twitter defaults. Pages add their own canonical path through {@link pageMetadata}; the layout
 * sets none, because a canonical inherited from the layout would point every page at `/`.
 */
export function marketingLayoutMetadata(webOrigin: string): Metadata {
  return {
    metadataBase: new URL(webOrigin),
    title: { default: SITE_TITLE, template: TITLE_TEMPLATE },
    description: SITE_DESCRIPTION,
    applicationName: SITE_NAME,
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: SITE_LOCALE,
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
    },
    twitter: { card: 'summary', title: SITE_TITLE, description: SITE_DESCRIPTION },
    formatDetection: { telephone: false, email: false, address: false },
  };
}

export interface PageMetadataInput {
  /** Page title without the brand; `null` uses the site title as it is (home page). */
  readonly title: string | null;
  readonly description: string;
  /** Canonical path of the page, relative to `metadataBase`. */
  readonly path: `/${string}`;
}

/** The title as rendered in `<title>` (after the template). */
export function renderedTitle(title: string | null): string {
  return title === null ? SITE_TITLE : TITLE_TEMPLATE.replace('%s', title);
}

/**
 * Per-page metadata: title, description, canonical URL, `hreflang` (`tr-TR` and `x-default`;
 * the site has no English pages yet) and the page's Open Graph and Twitter fields. Open Graph is
 * repeated in full because Next.js replaces a parent's `openGraph` object instead of merging it.
 */
export function pageMetadata(input: PageMetadataInput): Metadata {
  const fullTitle = renderedTitle(input.title);
  return {
    title: input.title === null ? { absolute: SITE_TITLE } : input.title,
    description: input.description,
    alternates: {
      canonical: input.path,
      languages: { 'tr-TR': input.path, 'x-default': input.path },
    },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: SITE_LOCALE,
      url: input.path,
      title: fullTitle,
      description: input.description,
    },
    twitter: { card: 'summary', title: fullTitle, description: input.description },
  };
}
