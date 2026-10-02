import { foldTr } from '@kadro/contracts';
import { sql } from 'drizzle-orm';

import type { Database } from '../client.js';
import { districts } from '../schema/districts.js';
import { venues } from '../schema/venues.js';
import { DISTRICT_SEEDS, type DistrictSeed } from './districts.js';
import {
  SAMPLE_VENUE_ADDRESS,
  SAMPLE_VENUE_PREFIX,
  SAMPLE_VENUE_SEEDS,
  type SampleVenueSeed,
} from './sample-venues.js';
import { slugify } from './slug.js';

export { DISTRICT_SEEDS, type DistrictSeed } from './districts.js';
export {
  SAMPLE_VENUE_ADDRESS,
  SAMPLE_VENUE_PREFIX,
  SAMPLE_VENUE_SEEDS,
  type SampleVenueSeed,
} from './sample-venues.js';
export { slugify } from './slug.js';

export interface SeedResult {
  readonly districts: number;
  readonly sampleVenues: number;
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function districtKey(ilSlug: string, slug: string): string {
  return `${ilSlug}/${slug}`;
}

/**
 * Upserts the district list and the `[ÖRNEK]` sample venues in one transaction. Safe to run any
 * number of times: rows are matched on their natural keys (`il_slug` + `slug`, venue `slug`) and
 * keep their ids. A non-sample venue that happens to use a sample slug is never overwritten.
 */
export async function seedDatabase(db: Database): Promise<SeedResult> {
  return db.transaction(async (tx) => {
    const districtRows = DISTRICT_SEEDS.map((seed: DistrictSeed) => ({
      il: seed.il,
      ilce: seed.ilce,
      ilSlug: slugify(seed.il),
      slug: slugify(seed.ilce),
      centroid: { lng: seed.lng, lat: seed.lat },
    }));

    const upsertedDistricts = await tx
      .insert(districts)
      .values(districtRows)
      .onConflictDoUpdate({
        target: [districts.ilSlug, districts.slug],
        set: {
          il: sql`excluded.il`,
          ilce: sql`excluded.ilce`,
          centroid: sql`excluded.centroid`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: districts.id, ilSlug: districts.ilSlug, slug: districts.slug });

    const districtIds = new Map(
      upsertedDistricts.map((row) => [districtKey(row.ilSlug, row.slug), row.id]),
    );
    const districtPoints = new Map(
      districtRows.map((row) => [districtKey(row.ilSlug, row.slug), row.centroid]),
    );

    const venueRows = SAMPLE_VENUE_SEEDS.map((seed: SampleVenueSeed) => {
      const key = districtKey(seed.ilSlug, seed.districtSlug);
      const districtId = districtIds.get(key);
      const base = districtPoints.get(key);
      if (districtId === undefined || base === undefined) {
        throw new Error(`sample venue ${seed.slug} references unknown district ${key}`);
      }
      if (!seed.name.startsWith(SAMPLE_VENUE_PREFIX)) {
        throw new Error(`sample venue ${seed.slug} must be prefixed with ${SAMPLE_VENUE_PREFIX}`);
      }
      return {
        name: seed.name,
        searchName: foldTr(seed.name),
        slug: seed.slug,
        districtId,
        point: {
          lng: roundCoordinate(base.lng + seed.offset.lng),
          lat: roundCoordinate(base.lat + seed.offset.lat),
        },
        address: SAMPLE_VENUE_ADDRESS,
        phone: null,
        indoor: seed.indoor,
        features: seed.features,
        priceMinMinor: seed.priceMinMinor,
        priceMaxMinor: seed.priceMaxMinor,
        verified: false,
        isSample: true,
        createdBy: null,
      };
    });

    const upsertedVenues = await tx
      .insert(venues)
      .values(venueRows)
      .onConflictDoUpdate({
        target: venues.slug,
        set: {
          name: sql`excluded.name`,
          searchName: sql`excluded.search_name`,
          districtId: sql`excluded.district_id`,
          point: sql`excluded.point`,
          address: sql`excluded.address`,
          phone: sql`excluded.phone`,
          indoor: sql`excluded.indoor`,
          features: sql`excluded.features`,
          priceMinMinor: sql`excluded.price_min_minor`,
          priceMaxMinor: sql`excluded.price_max_minor`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`${venues.isSample} = true`,
      })
      .returning({ id: venues.id });

    return { districts: upsertedDistricts.length, sampleVenues: upsertedVenues.length };
  });
}
