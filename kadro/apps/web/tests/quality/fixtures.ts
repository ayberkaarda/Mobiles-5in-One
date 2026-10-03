import { randomBytes } from 'node:crypto';

import { foldTr } from '@kadro/contracts';
import { districts, matches, openCalls, teams, users, venues } from '@kadro/db';

import { type TestDatabase } from '../support/db';

/** Data for the quality suites (ADR-0059): one district with a live call and two public venues. */

const DAY_MS = 86_400_000;
export const HOSTILE = '</script><script>alert(1)</script><!--';

const run = randomBytes(4).toString('hex');
export const slugs = {
  il: `il-${run}`,
  district: `ilce-${run}`,
  verified: `ornek-dogrulanmis-${run}`,
  hostile: `ornek-isim-${run}`,
};

export async function seed(db: TestDatabase['client']['db']): Promise<void> {
  const [district] = await db
    .insert(districts)
    .values({
      il: 'Deneme İli',
      ilce: 'Deneme İlçesi',
      ilSlug: slugs.il,
      slug: slugs.district,
      centroid: { lng: 29, lat: 41 },
    })
    .returning({ id: districts.id });
  const districtId = district?.id ?? '';
  const [owner] = await db
    .insert(users)
    .values({
      email: `deneme-${run}@example.test`,
      displayName: `Deneme Kaptan ${run}`,
      emailVerifiedAt: new Date(),
    })
    .returning({ id: users.id });
  const venue = (slug: string, name: string) => ({
    name,
    slug,
    searchName: foldTr(name),
    districtId,
    point: { lng: 29.01, lat: 41.01 },
    indoor: true,
    features: { lighting: true, shower: false },
    priceMinMinor: 250_000,
    priceMaxMinor: 350_000,
    phone: '+90 216 000 00 00',
    address: 'Deneme Mahallesi 1',
    createdBy: owner?.id ?? null,
    verified: true,
    isSample: false,
  });
  const venueRows = await db
    .insert(venues)
    .values([
      venue(slugs.verified, '[ÖRNEK] Deneme Kapalı Saha'),
      venue(slugs.hostile, `[ÖRNEK] Deneme ${HOSTILE}`),
    ])
    .returning({ id: venues.id, slug: venues.slug });
  const [team] = await db
    .insert(teams)
    .values({
      name: `Deneme FK ${run}`,
      slug: `deneme-${run}`,
      districtId,
      ownerId: owner?.id ?? '',
    })
    .returning({ id: teams.id });
  const [match] = await db
    .insert(matches)
    .values({
      teamId: team?.id ?? '',
      startsAt: new Date(Date.now() + 2 * DAY_MS),
      format: '7v7',
      slots: 14,
      status: 'open',
      venueId: venueRows.find((row) => row.slug === slugs.verified)?.id ?? null,
      venueText: null,
    })
    .returning({ id: matches.id });
  await db.insert(openCalls).values({
    matchId: match?.id ?? '',
    missingCount: 2,
    position: 'GK',
    level: 'regular',
    districtId,
    status: 'open',
    expiresAt: new Date(Date.now() + DAY_MS),
  });
}
