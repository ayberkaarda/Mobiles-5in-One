import { openCallPublicSchema, paginatedResponseSchema } from '@kadro/contracts';
import { districts, venueReviews, venues } from '@kadro/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  findDistrictListing,
  findPublicVenue,
  listSitemapDistricts,
  listSitemapVenues,
} from '../../lib/server/seo/queries';
import {
  api,
  type CallsHarness,
  insertCall,
  insertMatch,
  insertVenue,
  label,
  setupCallsHarness,
} from '../calls/support';
import { account, anonymous, DAY_MS, expectJson, insertTeam } from '../teams/support';

/**
 * Public reads of the programmatic SEO pages (ADR-0057) against a migrated database, run as the
 * production web role: the same visibility as the anonymous API, the same call projection as
 * `GET open-calls`, and sitemap rows for indexable pages only.
 */

let t: CallsHarness;
const callPage = paginatedResponseSchema(openCallPublicSchema);

beforeAll(async () => {
  t = await setupCallsHarness('web_seo_pages');
});

afterAll(async () => {
  await t.dispose();
});

beforeEach(() => {
  t.harness.setNow(new Date());
});

function now(): Date {
  return t.harness.runtime.now();
}

async function freshDistrict(): Promise<{ id: string; ilSlug: string; slug: string }> {
  const ilSlug = `il-${label()}`;
  const slug = `ilce-${label()}`;
  const [row] = await t.db
    .insert(districts)
    .values({
      il: `Deneme İli ${label()}`,
      ilce: `Deneme İlçesi ${label()}`,
      ilSlug,
      slug,
      centroid: { lng: 30, lat: 40 },
    })
    .returning({ id: districts.id });
  return { id: row?.id ?? '', ilSlug, slug };
}

describe('venue page data', () => {
  it('shows verified and sample venues, hides unverified ones and unknown slugs', async () => {
    const owner = await account(t);
    const verified = await insertVenue(t, { verified: true });
    const sample = await insertVenue(t, { verified: false, isSample: true, phone: null });
    const pending = await insertVenue(t, { verified: false, createdBy: owner.id });

    const shown = await findPublicVenue(t.app.db, verified.slug);
    expect(shown).toMatchObject({
      slug: verified.slug,
      name: verified.name,
      verified: true,
      isSample: false,
      phone: '+90 216 000 00 00',
      address: 'Deneme Mahallesi 1',
      myReview: null,
      district: { il: 'İstanbul', ilce: 'Kadıköy', ilSlug: 'istanbul', slug: 'kadikoy' },
    });
    expect(shown?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const demo = await findPublicVenue(t.app.db, sample.slug);
    expect(demo).toMatchObject({ isSample: true, phone: null, address: null });

    expect(await findPublicVenue(t.app.db, pending.slug)).toBeNull();
    expect(await findPublicVenue(t.app.db, 'olmayan-saha')).toBeNull();
    expect(await findPublicVenue(t.app.db, 'Not A Slug')).toBeNull();
  });

  it('matches the anonymous API detail of the venue', async () => {
    const venue = await insertVenue(t, { verified: true });
    const reviewer = await account(t, { displayName: 'Deneme Yorumcu' });
    await t.db.insert(venueReviews).values({
      venueId: venue.id,
      userId: reviewer.id,
      rating: 4,
      text: 'Zemin iyi',
    });
    const fromApi = await expectJson<Record<string, unknown>>(
      await api.getVenue(anonymous(), venue.slug),
      200,
    );
    const page = await findPublicVenue(t.app.db, venue.slug);
    const { district, updatedAt, ...detail } = page ?? { district: null, updatedAt: null };
    expect(district).not.toBeNull();
    expect(updatedAt).not.toBeNull();
    expect(detail).toEqual(fromApi);
    expect(page?.rating).toEqual({ average: null, count: 1 });
  });

  it('returns only JSON-safe values (the data cache stores JSON)', async () => {
    const venue = await insertVenue(t, { verified: true });
    const page = await findPublicVenue(t.app.db, venue.slug);
    expect(JSON.parse(JSON.stringify(page))).toEqual(page);
  });
});

describe('district page data', () => {
  it('lists the calls of GET open-calls for the district, with the same projection', async () => {
    const owner = await account(t);
    const team = await insertTeam(t, owner.id, { name: `Deneme FK ${label()}` });
    const district = await freshDistrict();
    const verified = await insertVenue(t, { verified: true, districtId: district.id });
    const pending = await insertVenue(t, { verified: false, createdBy: owner.id });

    const live = await insertCall(t, await insertMatch(t, team, { venueId: verified.id }), {
      districtId: district.id,
      position: 'GK',
    });
    const freeText = await insertCall(t, await insertMatch(t, team, { venueId: pending.id }), {
      districtId: district.id,
    });
    // Not listed: expired, closed, match not open, match in the past, other district.
    await insertCall(t, await insertMatch(t, team), {
      districtId: district.id,
      expiresAt: new Date(now().getTime() - 1_000),
    });
    await insertCall(t, await insertMatch(t, team), {
      districtId: district.id,
      status: 'closed',
    });
    await insertCall(t, await insertMatch(t, team, { status: 'locked' }), {
      districtId: district.id,
    });
    await insertCall(
      t,
      await insertMatch(t, team, { startsAt: new Date(now().getTime() - 60_000) }),
      {
        districtId: district.id,
      },
    );
    await insertCall(t, await insertMatch(t, team), { districtId: t.otherDistrictId });

    const listing = await findDistrictListing(t.app.db, district.ilSlug, district.slug, now());
    expect(listing?.district).toMatchObject({ id: district.id, ilSlug: district.ilSlug });
    expect(listing?.calls.map((call) => call.id).sort()).toEqual([live, freeText].sort());
    for (const call of listing?.calls ?? []) {
      expect(openCallPublicSchema.parse(call)).toEqual(call);
    }
    const withVenue = listing?.calls.find((call) => call.id === live);
    expect(withVenue?.venue).toEqual({ name: verified.name, slug: verified.slug });
    // An unverified venue is never named; the district stands in for it.
    expect(listing?.calls.find((call) => call.id === freeText)?.venue).toBeNull();

    const fromApi = callPage.parse(
      await expectJson(await api.listOpenCalls(anonymous(), { district: district.id }), 200),
    );
    expect(listing?.calls).toEqual(fromApi.items);
  });

  it('lists the public venues of the district and no unverified one', async () => {
    const owner = await account(t);
    const district = await freshDistrict();
    const verified = await insertVenue(t, { verified: true, districtId: district.id });
    const sample = await insertVenue(t, {
      verified: false,
      isSample: true,
      districtId: district.id,
    });
    await insertVenue(t, { verified: false, createdBy: owner.id, districtId: district.id });
    const listing = await findDistrictListing(t.app.db, district.ilSlug, district.slug, now());
    expect(listing?.venues).toEqual([
      { name: verified.name, slug: verified.slug, isSample: false },
      { name: sample.name, slug: sample.slug, isSample: true },
    ]);
    expect(listing?.calls).toEqual([]);
  });

  it('returns null for an unknown district or a malformed segment', async () => {
    expect(await findDistrictListing(t.app.db, 'istanbul', 'olmayan-ilce', now())).toBeNull();
    expect(await findDistrictListing(t.app.db, 'İstanbul', 'kadikoy', now())).toBeNull();
    expect(await findDistrictListing(t.app.db, 'istanbul', '../kadikoy', now())).toBeNull();
  });
});

describe('sitemap rows', () => {
  it('lists verified venues only, never sample or unverified rows', async () => {
    const owner = await account(t);
    const verified = await insertVenue(t, { verified: true });
    const sample = await insertVenue(t, { verified: false, isSample: true });
    const verifiedSample = await insertVenue(t, { verified: true, isSample: true });
    const pending = await insertVenue(t, { verified: false, createdBy: owner.id });
    const slugs = (await listSitemapVenues(t.app.db)).map((row) => row.slug);
    expect(slugs).toContain(verified.slug);
    for (const hidden of [sample, verifiedSample, pending]) {
      expect(slugs).not.toContain(hidden.slug);
    }
    const [row] = await t.db
      .select({ updatedAt: venues.updatedAt })
      .from(venues)
      .where(eq(venues.id, verified.id));
    expect(
      (await listSitemapVenues(t.app.db)).find((entry) => entry.slug === verified.slug),
    ).toEqual({ slug: verified.slug, updatedAt: row?.updatedAt.toISOString() });
  });

  it('lists districts with a live call until the earlier of expiry and match start', async () => {
    const owner = await account(t);
    const team = await insertTeam(t, owner.id);
    const withCall = await freshDistrict();
    const withExpired = await freshDistrict();
    const empty = await freshDistrict();
    const startsAt = new Date(now().getTime() + 2 * DAY_MS);
    const expiresAt = new Date(now().getTime() + DAY_MS);
    await insertCall(t, await insertMatch(t, team, { startsAt }), {
      districtId: withCall.id,
      expiresAt,
    });
    await insertCall(t, await insertMatch(t, team), {
      districtId: withExpired.id,
      expiresAt: new Date(now().getTime() - 1_000),
    });
    const rows = await listSitemapDistricts(t.app.db, now());
    const own = rows.filter((row) =>
      [withCall.slug, withExpired.slug, empty.slug].includes(row.slug),
    );
    expect(own).toEqual([
      { ilSlug: withCall.ilSlug, slug: withCall.slug, listedUntil: expiresAt.toISOString() },
    ]);
  });
});
