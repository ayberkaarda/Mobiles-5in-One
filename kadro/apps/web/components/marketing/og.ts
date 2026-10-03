import { SITE_TITLE } from './site';

/**
 * Open Graph and Twitter card images (product spec §7, ADR-0083). The images are rendered with
 * `next/og` by the route handlers under `app/og/` at build time; this module holds their paths and
 * sizes so `pageMetadata` and the routes cannot disagree. The paths are fixed, not the hashed
 * names of the `opengraph-image` file convention, because every page states its image in
 * `pageMetadata` explicitly.
 */

export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

export interface OgImage {
  /** Path relative to `metadataBase`. */
  readonly path: `/${string}`;
  readonly alt: string;
}

/** Card of the site: every page that has no image of its own. */
export const SITE_OG_IMAGE: OgImage = {
  path: '/og/kadro.png',
  alt: `${SITE_TITLE}: Kadron eksik kalmasın.`,
};

/** Card of one blog article; the route answers 404 for a slug that is not an article. */
export function articleOgImage(slug: string, title: string): OgImage {
  return { path: `/og/blog/${slug}`, alt: `${title} · Kadro Blog` };
}
