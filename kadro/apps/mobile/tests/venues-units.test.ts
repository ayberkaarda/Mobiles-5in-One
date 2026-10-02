import { dehydrate, QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { slugSchema } from '../../../packages/contracts/src/districts';
import { LIMITS } from '../../../packages/contracts/src/limits';
import {
  createReviewRequestSchema,
  createVenueRequestSchema,
  listVenuesQuerySchema,
  VENUE_FEATURES,
  venueDetailSchema,
  venuePhoneSchema,
} from '../../../packages/contracts/src/venues';
import {
  createQueryPersister,
  PERSISTED_QUERY_ROOTS,
  persistOptions,
} from '../src/query/persistence';
import {
  type TeamSummary,
  type VenueDetail,
  type VenueReview,
  type VenueSummary,
} from '../src/venues/contracts';
import { featureList, RATING_MIN_REVIEWS, ratingView, telHref } from '../src/venues/display';
import {
  addressIssue,
  EMPTY_VENUE_DRAFT,
  FEATURES,
  isVenueSlug,
  nameIssue,
  parseLocation,
  phoneIssue,
  reviewBody,
  VENUE_LIMITS,
  venueBody,
  venueSearchIssue,
} from '../src/venues/form';
import { matchAtVenueHref, NEW_VENUE_HREF, venueHref } from '../src/venues/links';
import { matchTeams, otherReviews, reviewerState } from '../src/venues/permissions';
import {
  cachedVenueName,
  VENUE_PRIVATE_ROOT,
  venueDetailQuery,
  venueFacts,
  venueKeys,
} from '../src/venues/queries';
import { createVenuesApi, NO_VENUE_FILTERS } from '../src/venues/venues-api';
import { createTestApi, issueTokens } from './support/api';
import { apiUrl, mswServer } from './support/msw';

const VENUE_ID = '0192a0b0-0000-7000-8000-0000000000e1';
const DISTRICT_ID = '0192a0b0-0000-7000-8000-0000000000d1';
const REVIEW_ID = '0192a0b0-0000-7000-8000-0000000000b1';
const REVIEW_2_ID = '0192a0b0-0000-7000-8000-0000000000b2';
const REVIEW_3_ID = '0192a0b0-0000-7000-8000-0000000000b3';
const TEAM_ID = '0192a0b0-0000-7000-8000-000000000001';
const SLUG = 'moda-sahasi-kadikoy';

function review(id: string, createdAt: string, overrides: Partial<VenueReview> = {}): VenueReview {
  return {
    id,
    authorDisplayName: 'Deniz',
    rating: 4,
    text: 'Zemin iyi, soyunma odası temiz.',
    createdAt,
    ...overrides,
  };
}

function summary(overrides: Partial<VenueSummary> = {}): VenueSummary {
  return {
    id: VENUE_ID,
    name: 'Moda Sahası',
    slug: SLUG,
    districtId: DISTRICT_ID,
    location: { latitude: 40.98, longitude: 29.03 },
    indoor: false,
    priceMinMinor: 120_000,
    priceMaxMinor: 180_000,
    verified: true,
    isSample: false,
    rating: { average: 4.3, count: 3 },
    ...overrides,
  };
}

function detail(overrides: Partial<VenueDetail> = {}): VenueDetail {
  return {
    ...summary(),
    address: 'Moda Cd. 1',
    phone: '0216 000 00 00',
    features: { lighting: true, parking: false },
    recentReviews: [review(REVIEW_ID, '2026-10-01T10:00:00.000Z')],
    myReview: null,
    ...overrides,
  };
}

function team(overrides: Partial<TeamSummary> = {}): TeamSummary {
  return {
    id: TEAM_ID,
    name: 'Yıldızlar FK',
    slug: 'yildizlar-fk',
    badgeUrl: null,
    districtId: DISTRICT_ID,
    myRole: 'captain',
    memberCount: 5,
    isProLocked: false,
    createdAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('venue api', () => {
  it('sends the filters, encodes the slug and keeps the reviewer out of every body', async () => {
    const { api, session } = createTestApi();
    await session.establish(issueTokens());
    const venues = createVenuesApi(api);
    const seen: { method: string; path: string; search: string; body: unknown }[] = [];
    const record = async ({ request }: { request: Request }) => {
      const url = new URL(request.url);
      const text =
        request.method === 'GET' || request.method === 'DELETE' ? '' : await request.text();
      seen.push({
        method: request.method,
        path: url.pathname,
        search: url.search,
        body: text === '' ? null : (JSON.parse(text) as unknown),
      });
    };
    mswServer.use(
      http.get(apiUrl('/api/v1/venues'), async (info) => {
        await record(info);
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
      http.get(apiUrl(`/api/v1/venues/${SLUG}`), async (info) => {
        await record(info);
        return HttpResponse.json(detail());
      }),
      http.post(apiUrl('/api/v1/venues'), async (info) => {
        await record(info);
        return HttpResponse.json(detail(), { status: 201 });
      }),
      http.post(apiUrl(`/api/v1/venues/${SLUG}/reviews`), async (info) => {
        await record(info);
        return HttpResponse.json(review(REVIEW_ID, '2026-10-01T10:00:00.000Z'), { status: 201 });
      }),
      http.delete(apiUrl(`/api/v1/venues/${SLUG}/reviews/mine`), async (info) => {
        await record(info);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await venues.listVenues({ district: DISTRICT_ID, q: 'moda' }, 'c1');
    await venues.listVenues(NO_VENUE_FILTERS, undefined);
    await venues.getVenue(SLUG);
    // A slug that would leave its path segment is encoded, and the client refuses the path.
    await expect(venues.getVenue('../teams')).rejects.toThrow(TypeError);
    const body = venueBody({
      ...EMPTY_VENUE_DRAFT,
      name: 'Moda Sahası',
      districtId: DISTRICT_ID,
      location: '40.98, 29.03',
      indoor: false,
    });
    if (!body.ok) {
      throw new Error('draft rejected');
    }
    await venues.createVenue(body.body);
    await venues.createReview(SLUG, { rating: 5 });
    await expect(venues.deleteMyReview(SLUG)).resolves.toBeUndefined();

    expect(seen.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /api/v1/venues',
      'GET /api/v1/venues',
      `GET /api/v1/venues/${SLUG}`,
      'POST /api/v1/venues',
      `POST /api/v1/venues/${SLUG}/reviews`,
      `DELETE /api/v1/venues/${SLUG}/reviews/mine`,
    ]);
    const first = new URLSearchParams(seen[0]?.search);
    expect(Object.fromEntries(first)).toEqual({
      cursor: 'c1',
      limit: '20',
      district: DISTRICT_ID,
      q: 'moda',
    });
    // The query the app sends is one the server accepts.
    expect(listVenuesQuerySchema.safeParse(Object.fromEntries(first)).success).toBe(true);
    expect(Object.fromEntries(new URLSearchParams(seen[1]?.search))).toEqual({ limit: '20' });
    expect(createVenueRequestSchema.safeParse(seen[3]?.body).success).toBe(true);
    expect(seen[4]?.body).toEqual({ rating: 5 });
  });
});

describe('venue form mirrors the contracts', () => {
  it('uses the contract limits', () => {
    expect(VENUE_LIMITS.nameMin).toBe(LIMITS.venueName.min);
    expect(VENUE_LIMITS.nameMax).toBe(LIMITS.venueName.max);
    expect(VENUE_LIMITS.addressMax).toBe(LIMITS.venueAddress.max);
    expect(VENUE_LIMITS.phoneMin).toBe(LIMITS.venuePhone.min);
    expect(VENUE_LIMITS.phoneMax).toBe(LIMITS.venuePhone.max);
    expect(VENUE_LIMITS.priceMaxMinor).toBe(LIMITS.feeTotalMinor.max);
    expect(VENUE_LIMITS.reviewTextMax).toBe(LIMITS.reviewText.max);
    expect(VENUE_LIMITS.ratingMin).toBe(LIMITS.reviewRating.min);
    expect(VENUE_LIMITS.ratingMax).toBe(LIMITS.reviewRating.max);
    expect([...FEATURES].sort()).toEqual([...VENUE_FEATURES].sort());
  });

  const base = {
    districtId: DISTRICT_ID,
    location: { latitude: 41, longitude: 29 },
    indoor: true,
    features: {},
  };

  it('accepts exactly the names, addresses and phones the server accepts', () => {
    const names = [
      '',
      ' ',
      'A',
      'Ab',
      ' Ab ',
      'x'.repeat(120),
      'x'.repeat(121),
      'Saha\u0007',
      'Saha​',
      'Kadıköy Halı Saha',
    ];
    for (const name of names) {
      const server = createVenueRequestSchema.safeParse({ ...base, name }).success;
      expect(nameIssue(name) === null, JSON.stringify(name)).toBe(server);
    }
    const addresses = [' ', 'Moda Cd. 1', 'x'.repeat(200), 'x'.repeat(201), 'Cd.\u0000'];
    for (const address of addresses) {
      const sent = address.trim() === '' ? {} : { address };
      const server = createVenueRequestSchema.safeParse({ ...base, name: 'Saha', ...sent }).success;
      expect(addressIssue(address) === null, JSON.stringify(address)).toBe(server);
    }
    const phones = [
      '0216 000 00 00',
      '+90 216 000 00 00',
      '123456',
      '1234567',
      '+12345678901234567890',
      '0216-000',
      'tel:0216',
      ' 0216 000 00 00 ',
      '+ 216 000',
    ];
    for (const phone of phones) {
      expect(phoneIssue(phone) === null, phone).toBe(venuePhoneSchema.safeParse(phone).success);
    }
  });

  it('builds bodies the server accepts and refuses what it refuses', () => {
    const ok = venueBody({
      name: '  Moda Sahası ',
      districtId: DISTRICT_ID,
      location: '40.98765, 29.02345',
      address: ' ',
      phone: '0216 000 00 00',
      indoor: false,
      features: { lighting: true, shower: false },
      priceMin: '1.200',
      priceMax: '1800,50',
    });
    expect(ok).toEqual({
      ok: true,
      body: {
        name: 'Moda Sahası',
        districtId: DISTRICT_ID,
        location: { latitude: 40.98765, longitude: 29.02345 },
        phone: '0216 000 00 00',
        indoor: false,
        features: { lighting: true, shower: false },
        priceMinMinor: 120_000,
        priceMaxMinor: 180_050,
      },
    });
    if (ok.ok) {
      expect(createVenueRequestSchema.safeParse(ok.body).success).toBe(true);
    }
    const reversed = venueBody({
      ...EMPTY_VENUE_DRAFT,
      name: 'Saha',
      districtId: DISTRICT_ID,
      location: '41, 29',
      indoor: true,
      priceMin: '2000',
      priceMax: '1000',
    });
    expect(reversed).toEqual({ ok: false, issues: { priceMin: 'validation.priceOrder' } });
    expect(
      createVenueRequestSchema.safeParse({
        ...base,
        name: 'Saha',
        priceMinMinor: 200_000,
        priceMaxMinor: 100_000,
      }).success,
    ).toBe(false);
    const empty = venueBody(EMPTY_VENUE_DRAFT);
    expect(empty).toEqual({
      ok: false,
      issues: {
        name: 'validation.nameTooShort',
        districtId: 'validation.districtRequired',
        location: 'validation.locationInvalid',
        indoor: 'validation.indoorRequired',
      },
    });
    const tooHigh = venueBody({
      ...EMPTY_VENUE_DRAFT,
      name: 'Saha',
      districtId: DISTRICT_ID,
      location: '41, 29',
      indoor: true,
      priceMax: '1.000.000,01',
    });
    expect(tooHigh).toEqual({ ok: false, issues: { priceMax: 'validation.priceTooHigh' } });
  });

  it('reads coordinates as latitude, longitude within range', () => {
    expect(parseLocation('40.98765, 29.02345')).toEqual({
      latitude: 40.98765,
      longitude: 29.02345,
    });
    expect(parseLocation('40.98765 29.02345')).toEqual({ latitude: 40.98765, longitude: 29.02345 });
    expect(parseLocation('-33.9;151.2')).toEqual({ latitude: -33.9, longitude: 151.2 });
    for (const bad of [
      '',
      '40.9',
      '91, 29',
      '40, 181',
      '40,9, 29,1',
      'abc, def',
      '40.9, 29.1, 3',
      '1e2, 3',
    ]) {
      expect(parseLocation(bad), bad).toBeNull();
    }
  });

  it('accepts exactly the reviews the server accepts and drops an empty text', () => {
    const texts = [
      '',
      '   ',
      'İyi saha',
      'a\r\nb',
      'x'.repeat(500),
      'x'.repeat(501),
      'kötü\u0007',
      'satır ',
    ];
    for (const text of texts) {
      const result = reviewBody(4, text);
      const sent = text.trim() === '' ? { rating: 4 } : { rating: 4, text };
      expect(result.ok, JSON.stringify(text)).toBe(
        createReviewRequestSchema.safeParse(sent).success,
      );
      if (result.ok) {
        expect(createReviewRequestSchema.parse(sent)).toEqual(result.body);
      }
    }
    expect(reviewBody(null, 'iyi')).toEqual({
      ok: false,
      rating: 'validation.ratingRequired',
      text: null,
    });
  });

  it('recognizes server slugs only and uses the match form search rule', () => {
    for (const slug of [
      SLUG,
      'ornek-kadikoy-hali-saha-a',
      'a',
      '',
      'Moda',
      'moda--saha',
      '-moda',
      'x'.repeat(81),
      '../x',
    ]) {
      expect(isVenueSlug(slug), slug).toBe(slugSchema.safeParse(slug).success);
    }
    expect(venueSearchIssue('m')).toBe('validation.searchTooShort');
    expect(venueSearchIssue(' mo ')).toBeNull();
    expect(venueSearchIssue('x'.repeat(61))).toBe('validation.searchTooLong');
    expect(listVenuesQuerySchema.safeParse({ q: 'x'.repeat(61) }).success).toBe(false);
    expect(listVenuesQuerySchema.safeParse({ q: 'm' }).success).toBe(false);
  });
});

describe('venue display rules', () => {
  it('shows an average only from the shared review threshold on', () => {
    expect(RATING_MIN_REVIEWS).toBe(3);
    expect(ratingView({ average: null, count: 0 })).toEqual({ kind: 'none' });
    expect(ratingView({ average: 5, count: RATING_MIN_REVIEWS - 1 })).toEqual({
      kind: 'few',
      count: RATING_MIN_REVIEWS - 1,
    });
    expect(ratingView({ average: 4.3, count: RATING_MIN_REVIEWS })).toEqual({
      kind: 'average',
      average: 4.3,
      count: RATING_MIN_REVIEWS,
    });
  });

  it('builds a tel: link only from a plain phone number', () => {
    expect(telHref('0216 000 00 00')).toBe('tel:02160000000');
    expect(telHref('+90 216 000 00 00')).toBe('tel:+902160000000');
    for (const bad of [
      null,
      '',
      'javascript:alert(1)',
      '0216;000',
      '12345',
      '0216 000 00 00 ext 5',
    ]) {
      expect(telHref(bad), String(bad)).toBeNull();
    }
  });

  it('splits features into present, absent and unknown', () => {
    expect(featureList({ lighting: true, parking: false })).toEqual({
      present: ['lighting'],
      absent: ['parking'],
      unknown: ['changingRoom', 'shower'],
    });
  });

  it('builds routes on the app-link venue path', () => {
    expect(venueHref(SLUG)).toBe(`/saha/${SLUG}`);
    expect(NEW_VENUE_HREF).toBe('/saha/yeni');
    // `yeni` is never a server slug: those always carry the district after a dash.
    expect(isVenueSlug('yeni')).toBe(true);
    expect(matchAtVenueHref(TEAM_ID, VENUE_ID)).toBe(
      `/takim/${TEAM_ID}/mac/yeni?venue=${VENUE_ID}`,
    );
  });
});

describe('venue permissions', () => {
  it('offers the review form only with a verified email and the own review otherwise', () => {
    const own = review(REVIEW_ID, '2026-10-01T10:00:00.000Z');
    expect(reviewerState(detail(), { emailVerified: true })).toEqual({ kind: 'write' });
    expect(reviewerState(detail(), { emailVerified: false })).toEqual({ kind: 'unverified' });
    expect(reviewerState(detail({ myReview: own }), { emailVerified: false })).toEqual({
      kind: 'own',
      review: own,
      canRewrite: false,
    });
    expect(reviewerState(detail({ myReview: own }), { emailVerified: true })).toMatchObject({
      canRewrite: true,
    });
  });

  it('lists only staff teams that are not read-only for a match here', () => {
    const teams = [
      team(),
      team({ id: 'co', myRole: 'co_captain' }),
      team({ id: 'player', myRole: 'player' }),
      team({ id: 'locked', isProLocked: true }),
    ];
    expect(matchTeams(teams).map((entry) => entry.id)).toEqual([TEAM_ID, 'co']);
  });

  it('sorts other reviews newest first whatever the server order, without the own one', () => {
    const old = review(REVIEW_ID, '2026-09-01T10:00:00.000Z');
    const mid = review(REVIEW_2_ID, '2026-09-15T10:00:00.000Z');
    const latest = review(REVIEW_3_ID, '2026-10-01T10:00:00.000Z');
    const orders = [
      [old, mid, latest],
      [latest, old, mid],
      [mid, latest, old],
    ];
    for (const recentReviews of orders) {
      expect(otherReviews({ recentReviews, myReview: null }).map((row) => row.id)).toEqual([
        REVIEW_3_ID,
        REVIEW_2_ID,
        REVIEW_ID,
      ]);
      expect(otherReviews({ recentReviews, myReview: mid }).map((row) => row.id)).toEqual([
        REVIEW_3_ID,
        REVIEW_ID,
      ]);
    }
  });
});

describe('venue cache', () => {
  it('keeps the review-free facts on the device and the reviews in memory only', async () => {
    expect([...PERSISTED_QUERY_ROOTS]).toContain('venues');
    expect([...PERSISTED_QUERY_ROOTS]).not.toContain(VENUE_PRIVATE_ROOT);
    const { api, session } = createTestApi();
    await session.establish(issueTokens());
    const venues = createVenuesApi(api);
    const full = detail({
      recentReviews: [
        review(REVIEW_ID, '2026-10-01T10:00:00.000Z', { text: 'Ara: 0555 111 22 33' }),
      ],
      myReview: review(REVIEW_2_ID, '2026-10-02T10:00:00.000Z', { text: 'Benim notum gizli' }),
    });
    expect(venueDetailSchema.safeParse(full).success).toBe(true);
    mswServer.use(http.get(apiUrl(`/api/v1/venues/${SLUG}`), () => HttpResponse.json(full)));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await client.fetchQuery(venueDetailQuery(venues, client, SLUG));
    client.setQueryData(venueKeys.list(NO_VENUE_FILTERS), {
      pages: [{ items: [summary()], nextCursor: null }],
      pageParams: [undefined],
    });

    expect(client.getQueryData(venueKeys.facts(SLUG))).toEqual(venueFacts(full));
    expect(venueFacts(full)).not.toHaveProperty('recentReviews');
    expect(venueFacts(full)).not.toHaveProperty('myReview');

    const storage = {
      getItem: () => Promise.resolve(null),
      setItem: () => Promise.resolve(),
      removeItem: () => Promise.resolve(),
    };
    const options = persistOptions(createQueryPersister(storage), 'v1:test');
    const state = dehydrate(client, options.dehydrateOptions);
    expect(state.queries.map((query) => query.queryKey).sort()).toEqual(
      [venueKeys.facts(SLUG), venueKeys.list(NO_VENUE_FILTERS)].sort(),
    );
    const written = JSON.stringify(state);
    expect(written).toContain('Moda Sahası');
    expect(written).not.toContain('0555');
    expect(written).not.toContain('Benim notum');
  });

  it('finds a venue name only in data read from the API', () => {
    const client = new QueryClient();
    expect(cachedVenueName(client, VENUE_ID)).toBeNull();
    client.setQueryData(venueKeys.list({ district: DISTRICT_ID, q: null }), {
      pages: [{ items: [summary({ name: 'Liste Sahası' })], nextCursor: null }],
      pageParams: [undefined],
    });
    expect(cachedVenueName(client, VENUE_ID)).toBe('Liste Sahası');
    client.setQueryData(venueKeys.facts(SLUG), venueFacts(detail({ name: 'Detay Sahası' })));
    expect(cachedVenueName(client, VENUE_ID)).toBe('Detay Sahası');
    expect(cachedVenueName(client, '0192a0b0-0000-7000-8000-0000000000ff')).toBeNull();
  });
});
