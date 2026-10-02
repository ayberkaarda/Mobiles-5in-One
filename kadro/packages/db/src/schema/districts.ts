import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { primaryId, timestamps } from './columns.js';
import { geographyPoint } from './geography.js';

/**
 * Turkish administrative districts (il / ilçe). `il_slug` + `slug` form the public URL segments
 * (`/sahalar/[il]/[ilce]`). `centroid` is an approximate reference point, not a boundary.
 */
export const districts = pgTable(
  'districts',
  {
    id: primaryId(),
    il: text('il').notNull(),
    ilce: text('ilce').notNull(),
    ilSlug: text('il_slug').notNull(),
    slug: text('slug').notNull(),
    centroid: geographyPoint('centroid').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('districts_il_slug_slug_key').on(t.ilSlug, t.slug),
    uniqueIndex('districts_il_ilce_key').on(t.il, t.ilce),
    index('districts_centroid_gist').using('gist', t.centroid),
    check('districts_il_slug_format', sql`${t.ilSlug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check('districts_slug_format', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);
