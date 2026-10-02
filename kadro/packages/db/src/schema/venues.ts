import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryId, timestamps } from './columns.js';
import { districts } from './districts.js';
import { geographyPoint } from './geography.js';
import { users } from './users.js';

/**
 * Venue feature flags. The API validates `features` against a closed key set defined in
 * `packages/contracts`; the database only guarantees a JSON object.
 */
export type VenueFeatures = Readonly<Record<string, boolean>>;

/**
 * Pitch directory (Saha Rehberi). Prices are integer minor units (kuruş). Seeded demo rows carry
 * `is_sample = true` and a `[ÖRNEK]` name prefix; real venues arrive through the admin import.
 */
export const venues = pgTable(
  'venues',
  {
    id: primaryId(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    /**
     * `foldTr(name)` from `@kadro/contracts`, written by the application on every name change
     * (ADR-0039). Search matches folded queries as substrings through a trigram index.
     */
    searchName: text('search_name').notNull(),
    districtId: uuid('district_id')
      .notNull()
      .references(() => districts.id, { onDelete: 'restrict' }),
    point: geographyPoint('point').notNull(),
    address: text('address'),
    phone: text('phone'),
    indoor: boolean('indoor').notNull().default(false),
    features: jsonb('features').$type<VenueFeatures>().notNull().default({}),
    priceMinMinor: integer('price_min_minor'),
    priceMaxMinor: integer('price_max_minor'),
    verified: boolean('verified').notNull().default(false),
    isSample: boolean('is_sample').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('venues_slug_key').on(t.slug),
    index('venues_district_id_idx').on(t.districtId),
    index('venues_created_by_idx').on(t.createdBy),
    index('venues_point_gist').using('gist', t.point),
    index('venues_search_name_trgm').using('gin', t.searchName.op('gin_trgm_ops')),
    // Keyset order of `GET venues` (ADR-0039) and the same-district duplicate check (ADR-0038).
    index('venues_search_name_id_idx').on(t.searchName, t.id),
    index('venues_district_id_search_name_idx').on(t.districtId, t.searchName),
    check('venues_name_length', sql`char_length(${t.name}) between 2 and 120`),
    check('venues_slug_format', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check('venues_features_object', sql`jsonb_typeof(${t.features}) = 'object'`),
    check(
      'venues_price_range',
      sql`(${t.priceMinMinor} is null or ${t.priceMinMinor} >= 0) and (${t.priceMaxMinor} is null or ${t.priceMaxMinor} >= 0) and (${t.priceMinMinor} is null or ${t.priceMaxMinor} is null or ${t.priceMinMinor} <= ${t.priceMaxMinor})`,
    ),
    check('venues_sample_name_prefix', sql`not ${t.isSample} or ${t.name} like '[ÖRNEK] %'`),
  ],
);

export const venueReviews = pgTable(
  'venue_reviews',
  {
    id: primaryId(),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rating: smallint('rating').notNull(),
    text: text('text'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('venue_reviews_venue_id_user_id_key').on(t.venueId, t.userId),
    index('venue_reviews_user_id_idx').on(t.userId),
    check('venue_reviews_rating_range', sql`${t.rating} between 1 and 5`),
    check('venue_reviews_text_length', sql`char_length(${t.text}) <= 500`),
  ],
);
