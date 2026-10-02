import {
  foldTr,
  paginatedResponseSchema,
  type VenueDetail,
  venueDetailSchema,
  type VenueSummary,
  venueSummarySchema,
} from '@kadro/contracts';
import { auditLogs, districts, venueReviews, venues } from '@kadro/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { expectProblem } from '../support/http';
import { account, anonymous, expectJson, insertTeam } from '../teams/support';
import {
  api,
  type CallsHarness,
  insertMatch,
  insertRsvp,
  insertVenue,
  label,
  setupCallsHarness,
  statuses,
} from '../calls/support';

/**
 * Venue directory (matrix §3.6, footnote 23, ADR-0038, ADR-0039): visibility of unverified
 * venues, Turkish-folded search over the trigram index, keyset pages, creation rules and races.
 */

let t: CallsHarness;
const listPage = paginatedResponseSchema(venueSummarySchema);

beforeAll(async () => {
  t = await setupCallsHarness('web_venues');
});

afterAll(async () => {
  await t.dispose();
});

beforeEach(() => {
  t.harness.setNow(new Date());
});

async function freshDistrict(): Promise<{ id: string; slug: string; province: string }> {
  const slug = `ilce-${label()}`;
  const province = `il-${label()}`;
  const [row] = await t.db
    .insert(districts)
    .values({
      il: `Il ${label()}`,
      ilce: `Ilce ${label()}`,
      ilSlug: province,
      slug,
      centroid: { lng: 30, lat: 40 },
    })
    .returning({ id: districts.id });
  return { id: row?.id ?? '', slug, province };
}

async function list(
  headers: Record<string, string>,
  query: Record<string, string>,
): Promise<{ items: VenueSummary[]; nextCursor: string | null }> {
  return listPage.parse(await expectJson(await api.listVenues(headers, query), 200));
}

function createBody(districtId: string, overrides: Record<string, unknown> = {}) {
  return {
    name: `Deneme Sahası ${label()}`,
    districtId,
    location: { latitude: 40.99, longitude: 29.03 },
    address: 'Deneme Mahallesi 2',
    phone: '+90 216 111 11 11',
    indoor: true,
    features: { lighting: true, parking: false },
    priceMinMinor: 150_000,
    priceMaxMinor: 250_000,
    ...overrides,
  };
}

describe('visibility (matrix §5: verified or sample for everyone, unverified for the creator)', () => {
  it('lists and reads verified and sample venues for everyone, unverified ones for the creator only', async () => {
    const district = await freshDistrict();
    const creator = await account(t);
    const stranger = await account(t);
    const moderator = await account(t, { role: 'moderator' });
    const verified = await insertVenue(t, { districtId: district.id, verified: true });
    const sample = await insertVenue(t, {
      districtId: district.id,
      verified: false,
      isSample: true,
    });
    const hidden = await insertVenue(t, {
      districtId: district.id,
      verified: false,
      createdBy: creator.id,
    });

    for (const headers of [anonymous(), stranger.headers, moderator.headers]) {
      const page = await list(headers, { district: district.id });
      expect(page.items.map((item) => item.id).sort()).toEqual([verified.id, sample.id].sort());
      await expectProblem(await api.getVenue(headers, hidden.slug), 404, 'not_found');
    }
    const own = await list(creator.headers, { district: district.id });
    expect(own.items.map((item) => item.id).sort()).toEqual(
      [verified.id, sample.id, hidden.id].sort(),
    );
    const detail = venueDetailSchema.parse(
      await expectJson(await api.getVenue(creator.headers, hidden.slug), 200),
    );
    expect(detail).toMatchObject({ id: hidden.id, verified: false, isSample: false });
    expect(detail.phone).not.toBeNull();
    await expectProblem(await api.getVenue(anonymous(), `yok-${label()}`), 404, 'not_found');
    await expectProblem(await api.getVenue(anonymous(), 'Not_A_Slug'), 400, 'validation_failed');
  });

  it('shows phone and address of verified venues only (and to the creator)', async () => {
    const creator = await account(t);
    const verified = await insertVenue(t, { verified: true });
    const sample = await insertVenue(t, { verified: false, isSample: true });
    const own = await insertVenue(t, { verified: false, createdBy: creator.id });
    const read = async (headers: Record<string, string>, slug: string) =>
      venueDetailSchema.parse(await expectJson(await api.getVenue(headers, slug), 200));
    expect(await read(anonymous(), verified.slug)).toMatchObject({
      phone: '+90 216 000 00 00',
      address: 'Deneme Mahallesi 1',
    });
    expect(await read(anonymous(), sample.slug)).toMatchObject({ phone: null, address: null });
    expect(await read(creator.headers, own.slug)).toMatchObject({
      phone: '+90 216 000 00 00',
      address: 'Deneme Mahallesi 1',
    });
  });

  it('rating: count always, average only from three reviews; recent reviews by display name only', async () => {
    const venue = await insertVenue(t, { verified: true });
    const owner = await account(t);
    const teamId = await insertTeam(t, owner.id);
    const matchId = await insertMatch(t, teamId, { status: 'played', venueId: venue.id });
    const reviewers = [];
    for (const rating of [5, 4]) {
      const reviewer = await account(t, { displayName: `Yorumcu ${label()}` });
      await insertRsvp(t, matchId, reviewer.id, 'in');
      await t.db.insert(venueReviews).values({ venueId: venue.id, userId: reviewer.id, rating });
      reviewers.push(reviewer);
    }
    let detail = venueDetailSchema.parse(
      await expectJson(await api.getVenue(anonymous(), venue.slug), 200),
    );
    expect(detail.rating).toEqual({ average: null, count: 2 });
    const third = await account(t);
    await t.db
      .insert(venueReviews)
      .values({ venueId: venue.id, userId: third.id, rating: 4, text: 'iyi' });
    detail = venueDetailSchema.parse(
      await expectJson(await api.getVenue(anonymous(), venue.slug), 200),
    );
    expect(detail.rating).toEqual({ average: 4.3, count: 3 });
    expect(detail.recentReviews).toHaveLength(3);
    expect(detail.recentReviews[0]?.text).toBe('iyi');
    const text = JSON.stringify(detail);
    for (const reviewer of [...reviewers, third]) {
      expect(text).not.toContain(reviewer.id);
    }
    expect(text).not.toContain('email');
  });
});

describe('search (ADR-0039: foldTr, literal substring, trigram index)', () => {
  it('matches Turkish case and diacritics in both directions', async () => {
    const district = await freshDistrict();
    const isik = await insertVenue(t, {
      districtId: district.id,
      name: '[ÖRNEK] Işıklı Göğüs Sahası',
    });
    const inonu = await insertVenue(t, {
      districtId: district.id,
      name: '[ÖRNEK] İNÖNÜ Şişli Arena',
    });
    const cayir = await insertVenue(t, { districtId: district.id, name: '[ÖRNEK] Kadıköy Çayır' });
    const ids = async (q: string) =>
      (await list(anonymous(), { district: district.id, q })).items.map((item) => item.id).sort();
    for (const q of ['isikli', 'IŞIKLI', 'ışıklı', 'Işıklı', 'gogus', 'GÖĞÜS']) {
      expect(await ids(q), q).toEqual([isik.id]);
    }
    for (const q of ['inonu', 'İnönü', 'INONU', 'şişli', 'SISLI']) {
      expect(await ids(q), q).toEqual([inonu.id]);
    }
    for (const q of ['kadıköy', 'KADIKÖY', 'kadikoy', 'çayır', 'CAYIR', '  kadikoy  ']) {
      expect(await ids(q), q).toEqual([cayir.id]);
    }
    expect(await ids('ornek')).toEqual([isik.id, inonu.id, cayir.id].sort());
    expect(await ids('saha arena')).toEqual([]);
  });

  it('treats LIKE wildcards and backslashes literally', async () => {
    const district = await freshDistrict();
    const percent = await insertVenue(t, {
      districtId: district.id,
      name: '[ÖRNEK] Yüzde 100% Saha',
    });
    const under = await insertVenue(t, { districtId: district.id, name: '[ÖRNEK] Alt_Çizgi Saha' });
    await insertVenue(t, { districtId: district.id, name: '[ÖRNEK] Düz Saha' });
    const ids = async (q: string) =>
      (await list(anonymous(), { district: district.id, q })).items.map((item) => item.id);
    expect(await ids('0%')).toEqual([percent.id]);
    expect(await ids('%%')).toEqual([]);
    expect(await ids('t_c')).toEqual([under.id]);
    expect(await ids('__')).toEqual([]);
    expect(await ids('\\%')).toEqual([]);
    await expectProblem(await api.listVenues(anonymous(), { q: 'a' }), 400, 'validation_failed');
    await expectProblem(
      await api.listVenues(anonymous(), { q: 'x'.repeat(61) }),
      400,
      'validation_failed',
    );
    await expectProblem(await api.listVenues(anonymous(), { q: '́́' }), 400, 'validation_failed');
  });

  it('the substring query is served by the trigram index', async () => {
    const client = await t.database.client.pool.connect();
    try {
      await client.query('begin');
      // A directory-sized table (rolled back afterwards) so the planner sees realistic statistics.
      await client.query(
        `insert into venues (id, name, slug, search_name, district_id, point)
         select gen_random_uuid(), '[ÖRNEK] Plan Saha ' || i, 'plan-saha-' || i, '[ornek] plan saha ' || i,
                $1::uuid, ST_SetSRID(ST_MakePoint(29, 41), 4326)::geography
         from generate_series(1, 5000) as i`,
        [t.districtId],
      );
      // Move the new entries from the GIN pending list into the index proper, as autovacuum would.
      await client.query("select gin_clean_pending_list('venues_search_name_trgm'::regclass)");
      await client.query('analyze venues');
      const plan = await client.query<{ 'QUERY PLAN': string }>(
        'explain select id from venues where search_name like $1',
        ['%kadikoy%'],
      );
      const indexes = await client.query(
        "select indexdef from pg_indexes where tablename = 'venues'",
      );
      await client.query('rollback');
      expect(
        plan.rows.map((row) => row['QUERY PLAN']).join('\n'),
        JSON.stringify(indexes.rows),
      ).toContain('venues_search_name_trgm');
    } finally {
      client.release();
    }
  });

  it('filters by district or province; unknown ones and both together are 400', async () => {
    const district = await freshDistrict();
    const other = await freshDistrict();
    const here = await insertVenue(t, { districtId: district.id });
    await insertVenue(t, { districtId: other.id });
    expect(
      (await list(anonymous(), { province: district.province })).items.map((v) => v.id),
    ).toEqual([here.id]);
    await expectProblem(
      await api.listVenues(anonymous(), { district: '019a0000-0000-7000-8000-000000000020' }),
      400,
      'validation_failed',
    );
    await expectProblem(
      await api.listVenues(anonymous(), { province: `yok-${label()}` }),
      400,
      'validation_failed',
    );
    await expectProblem(
      await api.listVenues(anonymous(), { district: district.id, province: district.province }),
      400,
      'validation_failed',
    );
  });
});

describe('pagination (search_name, id)', () => {
  it('walks every readable venue once in folded-name order; cursors are bound to filters and actor', async () => {
    const district = await freshDistrict();
    const creator = await account(t);
    const names = [
      '[ÖRNEK] Çam',
      '[ÖRNEK] Ada',
      '[ÖRNEK] Ada',
      '[ÖRNEK] Beş',
      '[ÖRNEK] Zer',
      '[ÖRNEK] İz',
    ];
    const created: { id: string; slug: string; name: string }[] = [];
    for (const name of names) {
      created.push(await insertVenue(t, { districtId: district.id, name }));
    }
    created.push(
      await insertVenue(t, {
        districtId: district.id,
        name: '[ÖRNEK] Kendi',
        verified: false,
        createdBy: creator.id,
      }),
    );
    const rows = await t.db
      .select({ id: venues.id, searchName: venues.searchName })
      .from(venues)
      .where(eq(venues.districtId, district.id));
    const expected = rows
      .sort((a, b) =>
        a.searchName === b.searchName
          ? a.id < b.id
            ? -1
            : 1
          : a.searchName < b.searchName
            ? -1
            : 1,
      )
      .map((row) => row.id);

    const walk = async (headers: Record<string, string>) => {
      const seen: string[] = [];
      let cursor: string | null = null;
      let firstCursor: string | null = null;
      do {
        const page = await list(headers, {
          district: district.id,
          limit: '3',
          ...(cursor === null ? {} : { cursor }),
        });
        seen.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor;
        firstCursor ??= cursor;
      } while (cursor !== null);
      return { seen, firstCursor };
    };
    const mine = await walk(creator.headers);
    expect(mine.seen).toEqual(expected);
    const anon = await walk(anonymous());
    expect(anon.seen).toEqual(expected.filter((id) => id !== created[6]?.id));
    if (anon.firstCursor === null) {
      throw new Error('expected more than one page');
    }
    await expectProblem(
      await api.listVenues(creator.headers, {
        district: district.id,
        limit: '3',
        cursor: anon.firstCursor,
      }),
      400,
      'invalid_cursor',
    );
    await expectProblem(
      await api.listVenues(anonymous(), {
        district: district.id,
        limit: '3',
        q: 'ada',
        cursor: anon.firstCursor,
      }),
      400,
      'invalid_cursor',
    );
  });
});

describe('POST venues', () => {
  it('creates an unverified venue owned by the caller with a server slug and folded search name', async () => {
    const creator = await account(t);
    const name = `Deneme Işık Sahası ${label()}`;
    const response = await api.createVenue(creator.headers, createBody(t.districtId, { name }));
    const body: VenueDetail = venueDetailSchema.parse(await expectJson(response, 201));
    expect(body).toMatchObject({
      name,
      districtId: t.districtId,
      verified: false,
      isSample: false,
      phone: '+90 216 111 11 11',
      address: 'Deneme Mahallesi 2',
      features: { lighting: true, parking: false },
      location: { latitude: 40.99, longitude: 29.03 },
      rating: { average: null, count: 0 },
      recentReviews: [],
    });
    expect(body.slug).toMatch(/^deneme-isik-sahasi-[0-9a-f]{8}-kadikoy$/);
    const [row] = await t.db.select().from(venues).where(eq(venues.id, body.id));
    expect(row).toMatchObject({ createdBy: creator.id, verified: false, isSample: false });
    expect(row?.searchName).toBe(foldTr(name));
    expect(row?.searchName.startsWith('deneme isik sahasi ')).toBe(true);
    const audits = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'venue.created'), eq(auditLogs.targetId, body.id)));
    expect(audits.map((audit) => audit.metadata)).toEqual([{ districtId: t.districtId }]);
    const stranger = await account(t);
    await expectProblem(await api.getVenue(stranger.headers, body.slug), 404, 'not_found');
    await expectJson(await api.getVenue(creator.headers, body.slug), 200);
  });

  it('server-only fields and the [ÖRNEK] marker are refused (matrix §4.5)', async () => {
    const creator = await account(t);
    for (const extra of [
      { verified: true },
      { isSample: true },
      { slug: 'kendi-slug' },
      { createdBy: creator.id },
      { searchName: 'x' },
      { features: { pool: true } },
      { priceMinMinor: 300, priceMaxMinor: 200 },
      { name: 'a' },
      { phone: 'call me' },
    ]) {
      await expectProblem(
        await api.createVenue(creator.headers, createBody(t.districtId, extra)),
        400,
        'validation_failed',
      );
    }
    for (const name of [
      '[ÖRNEK] Sahte Saha',
      '[örnek] sahte',
      '[ORNEK] Sahte',
      '  [Örnek]  Saha',
    ]) {
      const response = await api.createVenue(creator.headers, createBody(t.districtId, { name }));
      expect((await expectProblem(response, 400, 'validation_failed')).errors).toEqual([
        { path: 'body.name', issue: 'reserved' },
      ]);
    }
    const unknown = await api.createVenue(
      creator.headers,
      createBody('019a0000-0000-7000-8000-000000000021'),
    );
    expect((await expectProblem(unknown, 400, 'validation_failed')).errors).toEqual([
      { path: 'body.districtId', issue: 'not_found' },
    ]);
    const mine = await t.db.select().from(venues).where(eq(venues.createdBy, creator.id));
    expect(mine).toEqual([]);
  });

  it('the same folded name in the same district is 409 venue_exists; another district is fine', async () => {
    const creator = await account(t);
    const suffix = label();
    await expectJson(
      await api.createVenue(
        creator.headers,
        createBody(t.districtId, { name: `Deneme Işık ${suffix}` }),
      ),
      201,
    );
    const other = await account(t);
    await expectProblem(
      await api.createVenue(
        other.headers,
        createBody(t.districtId, { name: `DENEME IŞIK ${suffix}` }),
      ),
      409,
      'venue_exists',
    );
    const elsewhere = await expectJson<VenueDetail>(
      await api.createVenue(
        other.headers,
        createBody(t.otherDistrictId, { name: `deneme ışık ${suffix}` }),
      ),
      201,
    );
    expect(elsewhere.slug.endsWith('-karsiyaka')).toBe(true);
  });

  it('venue_exists names the existing slug only when the caller can read that venue (ADR-0038)', async () => {
    const district = await freshDistrict();
    const creator = await account(t);
    const stranger = await account(t);
    const suffix = label();
    const own = await expectJson<VenueDetail>(
      await api.createVenue(
        creator.headers,
        createBody(district.id, { name: `Deneme Gizli ${suffix}` }),
      ),
      201,
    );
    // The creator can read the own unverified venue: the slug points there.
    const again = await expectProblem(
      await api.createVenue(
        creator.headers,
        createBody(district.id, { name: `DENEME GİZLİ ${suffix}` }),
      ),
      409,
      'venue_exists',
    );
    expect(again.existingSlug).toBe(own.slug);
    // Anyone else cannot read it: same code, no slug, nothing about the hidden venue.
    const response = await api.createVenue(
      stranger.headers,
      createBody(district.id, { name: `deneme gizli ${suffix}` }),
    );
    const text = await response.clone().text();
    const hidden = await expectProblem(response, 409, 'venue_exists');
    expect(hidden.existingSlug).toBeUndefined();
    expect(text).not.toContain(own.slug);
    // The request line names the problem code like any other failure, without the slug.
    const requestId = response.headers.get('x-request-id');
    const logged = t.harness.logLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((record) => record.requestId === requestId && record.msg === 'request completed');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ status: 409, problemCode: 'venue_exists' });
    expect(JSON.stringify(logged)).not.toContain(own.slug);
    // A public (verified) venue is readable by everyone.
    const verified = await insertVenue(t, {
      districtId: district.id,
      name: `Deneme Açık ${suffix}`,
      verified: true,
    });
    const publicDuplicate = await expectProblem(
      await api.createVenue(
        stranger.headers,
        createBody(district.id, { name: `DENEME AÇIK ${suffix}` }),
      ),
      409,
      'venue_exists',
    );
    expect(publicDuplicate.existingSlug).toBe(verified.slug);
  });

  it('a slug collision gets a random suffix instead of failing', async () => {
    const creator = await account(t);
    const suffix = label();
    const taken = `deneme-${suffix}-kadikoy`;
    await t.db.insert(venues).values({
      name: '[ÖRNEK] Baska Isim',
      slug: taken,
      searchName: `[ornek] baska isim ${suffix}`,
      districtId: t.otherDistrictId,
      point: { lng: 27, lat: 38 },
      verified: true,
    });
    const body = await expectJson<VenueDetail>(
      await api.createVenue(
        creator.headers,
        createBody(t.districtId, { name: `Deneme ${suffix}` }),
      ),
      201,
    );
    expect(body.slug.startsWith(`${taken}-`)).toBe(true);
    expect(body.slug.slice(taken.length)).toMatch(/^-[0-9a-f]{4}$/);
  });

  it('four concurrent creations of one venue store exactly one row', async () => {
    const district = await freshDistrict();
    const name = `Deneme Yarış ${label()}`;
    const creators = await Promise.all(Array.from({ length: 4 }, () => account(t)));
    const responses = await Promise.all(
      creators.map((creator) =>
        api.createVenue(creator.headers, createBody(district.id, { name })),
      ),
    );
    expect(statuses(responses)).toEqual([201, 409, 409, 409]);
    const rows = await t.db.select().from(venues).where(eq(venues.districtId, district.id));
    expect(rows).toHaveLength(1);
  });

  it('401 anonymous, 403 unverified; group V allows five creations a day', async () => {
    await expectProblem(
      await api.createVenue(anonymous(), createBody(t.districtId)),
      401,
      'unauthenticated',
    );
    const unverified = await account(t, { verified: false });
    await expectProblem(
      await api.createVenue(unverified.headers, createBody(t.districtId)),
      403,
      'email_unverified',
    );
    const creator = await account(t);
    for (let index = 0; index < 5; index += 1) {
      await expectJson(await api.createVenue(creator.headers, createBody(t.districtId)), 201);
    }
    const denied = await api.createVenue(creator.headers, createBody(t.districtId));
    await expectProblem(denied.clone(), 429, 'rate_limited');
    expect(denied.headers.get('retry-after')).not.toBeNull();
    const mine = await t.db.select().from(venues).where(eq(venues.createdBy, creator.id));
    expect(mine).toHaveLength(5);
  });
});
