import { foldTr } from '@kadro/contracts';
import { asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { districts, venues } from '../src/schema/index.js';
import {
  DISTRICT_SEEDS,
  SAMPLE_VENUE_PREFIX,
  SAMPLE_VENUE_SEEDS,
  seedDatabase,
} from '../src/seed/index.js';
import { type TestDatabase, createMigratedDatabase } from './support.js';

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createMigratedDatabase('kadro_seed');
});

afterAll(async () => {
  await testDb.dispose();
});

async function snapshot() {
  const { db } = testDb.client;
  const districtRows = await db
    .select({ id: districts.id, ilSlug: districts.ilSlug, slug: districts.slug })
    .from(districts)
    .orderBy(asc(districts.ilSlug), asc(districts.slug));
  const venueRows = await db
    .select({ id: venues.id, slug: venues.slug, districtId: venues.districtId })
    .from(venues)
    .orderBy(asc(venues.slug));
  return { districtRows, venueRows };
}

describe('seedDatabase', () => {
  it('is idempotent: a second run keeps row counts and ids', async () => {
    const first = await seedDatabase(testDb.client.db);
    const before = await snapshot();
    const second = await seedDatabase(testDb.client.db);
    const after = await snapshot();

    expect(first).toEqual({
      districts: DISTRICT_SEEDS.length,
      sampleVenues: SAMPLE_VENUE_SEEDS.length,
    });
    expect(second).toEqual(first);
    expect(after).toEqual(before);
    expect(after.districtRows).toHaveLength(DISTRICT_SEEDS.length);
    expect(after.venueRows).toHaveLength(SAMPLE_VENUE_SEEDS.length);
  });

  it('seeds the districts of İstanbul, Ankara and İzmir with Turkish-aware slugs', async () => {
    const { db } = testDb.client;
    const rows = await db.select().from(districts);
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.ilSlug, (counts.get(row.ilSlug) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({ istanbul: 39, ankara: 25, izmir: 30 });

    const kadikoy = rows.find((row) => row.ilSlug === 'istanbul' && row.slug === 'kadikoy');
    expect(kadikoy).toMatchObject({ il: 'İstanbul', ilce: 'Kadıköy' });
    expect(rows.find((row) => row.slug === 'sereflikochisar')?.ilce).toBe('Şereflikoçhisar');
    expect(rows.find((row) => row.slug === 'cigli')?.ilce).toBe('Çiğli');

    for (const row of rows) {
      // Coarse bounding box of Türkiye: every reference point must at least fall inside it.
      expect(row.centroid.lat).toBeGreaterThan(35.8);
      expect(row.centroid.lat).toBeLessThan(42.2);
      expect(row.centroid.lng).toBeGreaterThan(25.6);
      expect(row.centroid.lng).toBeLessThan(44.9);
    }
  });

  it('seeds only clearly labeled, unverified sample venues', async () => {
    const { db } = testDb.client;
    const rows = await db
      .select()
      .from(venues)
      .where(
        inArray(
          venues.slug,
          SAMPLE_VENUE_SEEDS.map((seed) => seed.slug),
        ),
      );
    expect(rows).toHaveLength(SAMPLE_VENUE_SEEDS.length);
    for (const row of rows) {
      expect(row.isSample).toBe(true);
      expect(row.name.startsWith(SAMPLE_VENUE_PREFIX)).toBe(true);
      expect(row.verified).toBe(false);
      expect(row.phone).toBeNull();
      expect(row.createdBy).toBeNull();
      expect(row.searchName).toBe(foldTr(row.name));
    }
  });

  it('never overwrites a real venue that uses a sample slug', async () => {
    const { db } = testDb.client;
    const seed = SAMPLE_VENUE_SEEDS[0];
    if (!seed) throw new Error('no sample venue seeds');
    await db
      .update(venues)
      .set({ isSample: false, name: 'Gerçek Kayıt' })
      .where(eq(venues.slug, seed.slug));

    const result = await seedDatabase(db);
    expect(result.sampleVenues).toBe(SAMPLE_VENUE_SEEDS.length - 1);
    const [row] = await db.select().from(venues).where(eq(venues.slug, seed.slug));
    expect(row).toMatchObject({ isSample: false, name: 'Gerçek Kayıt' });
  });
});
