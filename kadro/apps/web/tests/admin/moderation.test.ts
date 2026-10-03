import { randomBytes } from 'node:crypto';

import {
  adminOpenCallSchema,
  adminReviewSchema,
  adminUserSchema,
  adminVenueSchema,
  auditLogEntrySchema,
  foldTr,
  paginatedResponseSchema,
  type PlatformRole,
  venueImportSchema,
} from '@kadro/contracts';
import {
  auditLogs,
  deletionRequests,
  districts,
  matches,
  openCallApplications,
  openCalls,
  refreshTokens,
  teams,
  users,
  venueImports,
  venueReviews,
  venues,
} from '@kadro/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GET as listAuditLogsRoute } from '../../app/api/v1/admin/audit-logs/route';
import { DELETE as removeCallRoute } from '../../app/api/v1/admin/open-calls/[id]/route';
import { GET as listCallsRoute } from '../../app/api/v1/admin/open-calls/route';
import { DELETE as deleteReviewRoute } from '../../app/api/v1/admin/reviews/[id]/route';
import { GET as listReviewsRoute } from '../../app/api/v1/admin/reviews/route';
import { POST as stepUpRoute } from '../../app/api/v1/admin/step-up/route';
import { PATCH as deactivateRoute } from '../../app/api/v1/admin/users/[id]/deactivate/route';
import { PATCH as roleRoute } from '../../app/api/v1/admin/users/[id]/role/route';
import { GET as listUsersRoute } from '../../app/api/v1/admin/users/route';
import { PATCH as updateVenueRoute } from '../../app/api/v1/admin/venues/[id]/route';
import { GET as getImportRoute } from '../../app/api/v1/admin/venues/import/[importId]/route';
import { POST as importRoute } from '../../app/api/v1/admin/venues/import/route';
import { GET as listVenuesRoute } from '../../app/api/v1/admin/venues/route';
import { POST as loginRoute } from '../../app/api/v1/auth/login/route';
import { GET as meRoute } from '../../app/api/v1/me/route';
import {
  encryptTotpSecret,
  generateTotpSecret,
  hotp,
  timeStep,
  TOTP_PERIOD_SECONDS,
} from '../../lib/server/admin/totp';
import { type RouteHandler } from '../../lib/server/http';
import {
  type AuthHarness,
  createUser,
  mobile,
  mobileLogin,
  setupAuthHarness,
} from '../auth/support';
import { call, expectProblem } from '../support/http';
import { storedJobs } from '../support/jobs';

/**
 * Admin moderation and venue import API (security checklist item 18, authorization matrix §3.8
 * footnote 27, ADR-0064, ADR-0067): the role / step-up / tier order on every route, venue
 * verification and corrections, review and open-call removal, user roles and deactivation with a
 * fresh TOTP code, the import request, the audit log, and one audit row per allowed mutation.
 */

let auth: AuthHarness;
const db = () => auth.database.client.db;
const STEP_MS = TOTP_PERIOD_SECONDS * 1_000;
const WINDOW_MS = 15 * 60 * 1_000;

beforeAll(async () => {
  auth = await setupAuthHarness('web_admin_moderation', {
    RATE_LIMIT_AUTH_MAX: '100',
    TOTP_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
  });
});

afterAll(async () => {
  await auth.database.dispose();
});

/** Puts the clock 5 s into a fresh time step. */
function alignClock(): void {
  const now = Date.now();
  auth.harness.setNow(new Date(Math.floor(now / STEP_MS) * STEP_MS + STEP_MS + 5_000));
}

/** Moves the clock to the next time step, so a new code is not a replay. */
function nextStep(): void {
  auth.harness.setNow(new Date(auth.harness.runtime.now().getTime() + STEP_MS));
}

function key(): Buffer {
  return Buffer.from(auth.harness.env.TOTP_ENCRYPTION_KEY ?? '', 'base64url');
}

function codeFor(secret: Buffer, offsetSteps = 0): string {
  return hotp(secret, timeStep(auth.harness.runtime.now()) + offsetSteps);
}

/** Any six digits that are not the valid code of this step (or its neighbours). */
function wrongCode(secret: Buffer): string {
  const valid = new Set([-1, 0, 1].map((offset) => codeFor(secret, offset)));
  for (let value = 0; ; value += 1) {
    const candidate = String(value).padStart(6, '0');
    if (!valid.has(candidate)) {
      return candidate;
    }
  }
}

interface Actor {
  readonly id: string;
  readonly email: string;
  readonly password: string;
  readonly headers: Record<string, string>;
  readonly secret: Buffer;
}

/**
 * A signed-in mobile account of `role` with an active TOTP secret; `stepUp` opens the 15-minute
 * window directly on its refresh family (the step-up route itself is covered separately).
 */
async function actor(role: PlatformRole, options: { stepUp?: boolean } = {}): Promise<Actor> {
  const user = await createUser(auth, {
    role,
    displayName: `Yetkili ${randomBytes(3).toString('hex')}`,
  });
  const session = await mobileLogin(loginRoute, user.email, user.password);
  const secret = generateTotpSecret();
  if (role !== 'user') {
    await db()
      .update(users)
      .set({ totpSecretEnc: encryptTotpSecret(key(), user.id, secret) })
      .where(eq(users.id, user.id));
  }
  if (options.stepUp ?? true) {
    await db()
      .update(refreshTokens)
      .set({ stepUpUntil: new Date(auth.harness.runtime.now().getTime() + WINDOW_MS) })
      .where(eq(refreshTokens.userId, user.id));
  }
  return {
    ...user,
    headers: mobile(undefined, { authorization: `Bearer ${session.tokens.accessToken}` }),
    secret,
  };
}

interface SendOptions {
  readonly params?: Record<string, string>;
  readonly query?: Record<string, string>;
  readonly json?: unknown;
}

function send(
  handler: RouteHandler,
  method: string,
  path: string,
  headers: Record<string, string>,
  options: SendOptions = {},
): Promise<Response> {
  const search = options.query === undefined ? '' : `?${new URLSearchParams(options.query)}`;
  return call(handler, {
    method,
    path: `${path}${search}`,
    headers,
    ...(options.params === undefined ? {} : { params: options.params }),
    ...(options.json === undefined ? {} : { json: options.json }),
  });
}

async function body<T>(response: Response, status: number): Promise<T> {
  const text = await response.text();
  expect(response.status, text).toBe(status);
  return JSON.parse(text) as T;
}

async function auditRows(action: string, targetId: string) {
  return db()
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), eq(auditLogs.targetId, targetId)))
    .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let districtPromise: Promise<{ id: string; slug: string }> | undefined;

function district(): Promise<{ id: string; slug: string }> {
  districtPromise ??= db()
    .insert(districts)
    .values({
      il: 'İzmir',
      ilce: 'Bornova',
      ilSlug: 'izmir',
      slug: 'bornova',
      centroid: { lng: 27.21, lat: 38.46 },
    })
    .returning({ id: districts.id, slug: districts.slug })
    .then((rows) => {
      const row = rows[0];
      if (row === undefined) {
        throw new Error('district insert returned no row');
      }
      return row;
    });
  return districtPromise;
}

interface VenueValues {
  readonly name?: string;
  readonly verified?: boolean;
  readonly isSample?: boolean;
  readonly createdBy?: string | null;
  readonly priceMinMinor?: number | null;
  readonly priceMaxMinor?: number | null;
}

async function insertVenue(values: VenueValues = {}): Promise<{ id: string; slug: string }> {
  const suffix = randomBytes(4).toString('hex');
  const name = values.name ?? `Deneme Sahası ${suffix}`;
  const [row] = await db()
    .insert(venues)
    .values({
      name,
      slug: `deneme-${suffix}`,
      searchName: foldTr(name),
      districtId: (await district()).id,
      point: { lng: 27.2, lat: 38.45 },
      address: 'Kazımdirik Mah. 1',
      phone: '+90 232 000 00 00',
      verified: values.verified ?? false,
      isSample: values.isSample ?? false,
      createdBy: values.createdBy ?? null,
      priceMinMinor: values.priceMinMinor ?? null,
      priceMaxMinor: values.priceMaxMinor ?? null,
    })
    .returning({ id: venues.id, slug: venues.slug });
  if (row === undefined) {
    throw new Error('venue insert returned no row');
  }
  return row;
}

async function insertReview(venueId: string, userId: string): Promise<string> {
  const [row] = await db()
    .insert(venueReviews)
    .values({ venueId, userId, rating: 2, text: 'Zemin kötü' })
    .returning({ id: venueReviews.id });
  if (row === undefined) {
    throw new Error('review insert returned no row');
  }
  return row.id;
}

/** An open future match of a new team with an open call and one pending application. */
async function insertOpenCall(): Promise<{
  callId: string;
  matchId: string;
  applicationId: string;
  applicantId: string;
}> {
  const owner = await createUser(auth);
  const applicant = await createUser(auth);
  const now = auth.harness.runtime.now().getTime();
  const [team] = await db()
    .insert(teams)
    .values({
      name: `Kadro ${randomBytes(3).toString('hex')}`,
      slug: `kadro-${randomBytes(6).toString('hex')}`,
      districtId: (await district()).id,
      ownerId: owner.id,
    })
    .returning({ id: teams.id });
  const [match] = await db()
    .insert(matches)
    .values({
      teamId: team?.id ?? '',
      startsAt: new Date(now + 48 * 3_600_000),
      format: '7v7',
      slots: 14,
      status: 'open',
      venueText: 'Deneme sahası',
    })
    .returning({ id: matches.id });
  const [call] = await db()
    .insert(openCalls)
    .values({
      matchId: match?.id ?? '',
      missingCount: 2,
      level: 'regular',
      districtId: (await district()).id,
      expiresAt: new Date(now + 24 * 3_600_000),
    })
    .returning({ id: openCalls.id });
  const [application] = await db()
    .insert(openCallApplications)
    .values({ openCallId: call?.id ?? '', userId: applicant.id })
    .returning({ id: openCallApplications.id });
  return {
    callId: call?.id ?? '',
    matchId: match?.id ?? '',
    applicationId: application?.id ?? '',
    applicantId: applicant.id,
  };
}

// ---------------------------------------------------------------------------
// Policy order on every route
// ---------------------------------------------------------------------------

interface AdminRoute {
  readonly name: string;
  readonly handler: RouteHandler;
  readonly method: string;
  readonly path: string;
  readonly options: (target: string) => SendOptions;
  /** Moderators with step-up pass the policy (`staff` tier). */
  readonly staffTier: boolean;
}

const ID = '018f2c1e-0000-7000-8000-000000000001';

const ROUTES: readonly AdminRoute[] = [
  {
    name: 'GET admin/venues',
    handler: listVenuesRoute,
    method: 'GET',
    path: '/api/v1/admin/venues',
    options: () => ({}),
    staffTier: true,
  },
  {
    name: 'PATCH admin/venues/:id',
    handler: updateVenueRoute,
    method: 'PATCH',
    path: `/api/v1/admin/venues/${ID}`,
    options: () => ({ params: { id: ID }, json: { verified: true } }),
    staffTier: true,
  },
  {
    name: 'POST admin/venues/import',
    handler: importRoute,
    method: 'POST',
    path: '/api/v1/admin/venues/import',
    options: () => ({ json: { csv: 'name,il,ilce,latitude,longitude,indoor\n' } }),
    staffTier: false,
  },
  {
    name: 'GET admin/venues/import/:importId',
    handler: getImportRoute,
    method: 'GET',
    path: `/api/v1/admin/venues/import/${ID}`,
    options: () => ({ params: { importId: ID } }),
    staffTier: true,
  },
  {
    name: 'GET admin/reviews',
    handler: listReviewsRoute,
    method: 'GET',
    path: '/api/v1/admin/reviews',
    options: () => ({}),
    staffTier: true,
  },
  {
    name: 'DELETE admin/reviews/:id',
    handler: deleteReviewRoute,
    method: 'DELETE',
    path: `/api/v1/admin/reviews/${ID}`,
    options: () => ({ params: { id: ID } }),
    staffTier: true,
  },
  {
    name: 'GET admin/open-calls',
    handler: listCallsRoute,
    method: 'GET',
    path: '/api/v1/admin/open-calls',
    options: () => ({}),
    staffTier: true,
  },
  {
    name: 'DELETE admin/open-calls/:id',
    handler: removeCallRoute,
    method: 'DELETE',
    path: `/api/v1/admin/open-calls/${ID}`,
    options: () => ({ params: { id: ID } }),
    staffTier: true,
  },
  {
    name: 'GET admin/users',
    handler: listUsersRoute,
    method: 'GET',
    path: '/api/v1/admin/users',
    options: () => ({}),
    staffTier: true,
  },
  {
    name: 'PATCH admin/users/:id/role',
    handler: roleRoute,
    method: 'PATCH',
    path: `/api/v1/admin/users/${ID}/role`,
    options: (target) => ({
      params: { id: target },
      json: { role: 'moderator', totpCode: '000000' },
    }),
    staffTier: false,
  },
  {
    name: 'PATCH admin/users/:id/deactivate',
    handler: deactivateRoute,
    method: 'PATCH',
    path: `/api/v1/admin/users/${ID}/deactivate`,
    options: (target) => ({
      params: { id: target },
      json: { deactivated: true, totpCode: '000000' },
    }),
    staffTier: false,
  },
  {
    name: 'GET admin/audit-logs',
    handler: listAuditLogsRoute,
    method: 'GET',
    path: '/api/v1/admin/audit-logs',
    options: () => ({}),
    staffTier: false,
  },
];

describe('admin routes: staff role → step-up → admin tier (matrix §3.8)', () => {
  it('answers 403 forbidden to a player, even with a step-up window', async () => {
    alignClock();
    const player = await actor('user');
    const victim = await createUser(auth);
    for (const adminRoute of ROUTES) {
      const response = await send(
        adminRoute.handler,
        adminRoute.method,
        adminRoute.path,
        player.headers,
        adminRoute.options(victim.id),
      );
      await expectProblem(response, 403, 'forbidden');
    }
  });

  it('answers 401 step_up_required to staff without a valid window', async () => {
    alignClock();
    const victim = await createUser(auth);
    for (const role of ['moderator', 'admin'] as const) {
      const staff = await actor(role, { stepUp: false });
      for (const adminRoute of ROUTES) {
        const response = await send(
          adminRoute.handler,
          adminRoute.method,
          adminRoute.path,
          staff.headers,
          adminRoute.options(victim.id),
        );
        await expectProblem(response, 401, 'step_up_required');
      }
    }
  });

  it('answers 403 to a moderator on admin-only routes and lets staff routes through', async () => {
    alignClock();
    const moderator = await actor('moderator');
    const victim = await createUser(auth);
    for (const adminRoute of ROUTES) {
      const response = await send(
        adminRoute.handler,
        adminRoute.method,
        adminRoute.path,
        moderator.headers,
        adminRoute.options(victim.id),
      );
      if (adminRoute.staffTier) {
        expect(response.status, adminRoute.name).not.toBe(403);
        expect(response.status, adminRoute.name).not.toBe(401);
      } else {
        await expectProblem(response, 403, 'forbidden');
      }
    }
    // The refused role and deactivation requests spent no TOTP step.
    const [row] = await db().select().from(users).where(eq(users.id, moderator.id));
    expect(row?.totpLastUsedStep).toBeNull();
    const [target] = await db().select().from(users).where(eq(users.id, victim.id));
    expect(target).toMatchObject({ role: 'user', deactivatedAt: null });
  });

  it('opens the window through POST admin/step-up and then serves a list', async () => {
    alignClock();
    const moderator = await actor('moderator', { stepUp: false });
    const before = await send(listVenuesRoute, 'GET', '/api/v1/admin/venues', moderator.headers);
    await expectProblem(before, 401, 'step_up_required');
    const stepUp = await call(stepUpRoute, {
      method: 'POST',
      path: '/api/v1/admin/step-up',
      headers: moderator.headers,
      json: { totpCode: codeFor(moderator.secret) },
    });
    expect(stepUp.status, await stepUp.clone().text()).toBe(200);
    const after = await send(listVenuesRoute, 'GET', '/api/v1/admin/venues', moderator.headers);
    expect(after.status, await after.clone().text()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Venues
// ---------------------------------------------------------------------------

describe('GET and PATCH admin/venues', () => {
  it('lists unverified venues with contact data, newest first, filtered and paginated', async () => {
    alignClock();
    const moderator = await actor('moderator');
    const creator = await createUser(auth);
    const tag = randomBytes(3).toString('hex');
    const first = await insertVenue({ name: `Filtre ${tag} Bir`, createdBy: creator.id });
    const second = await insertVenue({ name: `Filtre ${tag} İki`, createdBy: creator.id });
    await insertVenue({ name: `Filtre ${tag} Üç`, verified: true });

    const page = await body<unknown>(
      await send(listVenuesRoute, 'GET', '/api/v1/admin/venues', moderator.headers, {
        query: { q: `filtre ${tag}`, verified: 'false', limit: '1' },
      }),
      200,
    );
    const parsed = paginatedResponseSchema(adminVenueSchema).parse(page);
    expect(parsed.items.map((item) => item.id)).toEqual([second.id]);
    expect(parsed.items[0]).toMatchObject({
      verified: false,
      address: 'Kazımdirik Mah. 1',
      phone: '+90 232 000 00 00',
      creatorId: creator.id,
    });
    expect(parsed.nextCursor).not.toBeNull();
    const next = paginatedResponseSchema(adminVenueSchema).parse(
      await body(
        await send(listVenuesRoute, 'GET', '/api/v1/admin/venues', moderator.headers, {
          query: {
            q: `filtre ${tag}`,
            verified: 'false',
            limit: '1',
            cursor: parsed.nextCursor ?? '',
          },
        }),
        200,
      ),
    );
    expect(next.items.map((item) => item.id)).toEqual([first.id]);
    expect(next.nextCursor).toBeNull();

    // The cursor is bound to its filters.
    await expectProblem(
      await send(listVenuesRoute, 'GET', '/api/v1/admin/venues', moderator.headers, {
        query: { verified: 'true', cursor: parsed.nextCursor ?? '' },
      }),
      400,
      'invalid_cursor',
    );
  });

  it('verifies a venue and writes one venue.verified audit row without values', async () => {
    alignClock();
    const moderator = await actor('moderator');
    const venue = await insertVenue();
    const updated = adminVenueSchema.parse(
      await body(
        await send(
          updateVenueRoute,
          'PATCH',
          `/api/v1/admin/venues/${venue.id}`,
          moderator.headers,
          { params: { id: venue.id }, json: { verified: true, phone: null } },
        ),
        200,
      ),
    );
    expect(updated).toMatchObject({ id: venue.id, verified: true, phone: null, slug: venue.slug });
    const rows = await auditRows('venue.verified', venue.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: moderator.id,
      targetType: 'venue',
      metadata: { fields: 'phone,verified', verified: true },
    });
    expect(rows[0]?.ipHash).not.toBeNull();

    // Rejecting it again is audited as venue.unverified.
    await body(
      await send(updateVenueRoute, 'PATCH', `/api/v1/admin/venues/${venue.id}`, moderator.headers, {
        params: { id: venue.id },
        json: { verified: false },
      }),
      200,
    );
    expect(await auditRows('venue.unverified', venue.id)).toHaveLength(1);
  });

  it('refuses a rename onto another venue of the district with its slug', async () => {
    alignClock();
    const moderator = await actor('moderator');
    const tag = randomBytes(3).toString('hex');
    const taken = await insertVenue({ name: `Çakışma ${tag}` });
    const venue = await insertVenue();
    const response = await send(
      updateVenueRoute,
      'PATCH',
      `/api/v1/admin/venues/${venue.id}`,
      moderator.headers,
      { params: { id: venue.id }, json: { name: `ÇAKIŞMA ${tag}` } },
    );
    const problem = await expectProblem(response, 409, 'venue_exists');
    expect(problem.existingSlug).toBe(taken.slug);
    const [row] = await db().select().from(venues).where(eq(venues.id, venue.id));
    expect(row?.name).not.toContain('ÇAKIŞMA');
    expect(await auditRows('venue.corrected', venue.id)).toEqual([]);
  });

  it('checks the price range after merging, keeps sample prefixes and answers 404', async () => {
    alignClock();
    const moderator = await actor('moderator');
    const priced = await insertVenue({ priceMinMinor: 100_000, priceMaxMinor: 200_000 });
    await expectProblem(
      await send(
        updateVenueRoute,
        'PATCH',
        `/api/v1/admin/venues/${priced.id}`,
        moderator.headers,
        {
          params: { id: priced.id },
          json: { priceMinMinor: 300_000 },
        },
      ),
      400,
      'validation_failed',
    );
    const sample = await insertVenue({
      name: `[ÖRNEK] Deneme ${randomBytes(3).toString('hex')}`,
      isSample: true,
    });
    await expectProblem(
      await send(
        updateVenueRoute,
        'PATCH',
        `/api/v1/admin/venues/${sample.id}`,
        moderator.headers,
        {
          params: { id: sample.id },
          json: { name: 'Gerçek Saha' },
        },
      ),
      400,
      'validation_failed',
    );
    await expectProblem(
      await send(
        updateVenueRoute,
        'PATCH',
        `/api/v1/admin/venues/${priced.id}`,
        moderator.headers,
        {
          params: { id: priced.id },
          json: { name: '[ÖRNEK] Sahte' },
        },
      ),
      400,
      'validation_failed',
    );
    const corrected = adminVenueSchema.parse(
      await body(
        await send(
          updateVenueRoute,
          'PATCH',
          `/api/v1/admin/venues/${priced.id}`,
          moderator.headers,
          {
            params: { id: priced.id },
            json: { priceMinMinor: 150_000, features: { shower: true } },
          },
        ),
        200,
      ),
    );
    expect(corrected).toMatchObject({ priceMinMinor: 150_000, features: { shower: true } });
    expect(await auditRows('venue.corrected', priced.id)).toHaveLength(1);
    await expectProblem(
      await send(updateVenueRoute, 'PATCH', `/api/v1/admin/venues/${ID}`, moderator.headers, {
        params: { id: ID },
        json: { verified: true },
      }),
      404,
      'not_found',
    );
  });
});

// ---------------------------------------------------------------------------
// Reviews and open calls
// ---------------------------------------------------------------------------

describe('admin reviews and open calls', () => {
  it('lists and removes a review once, with one review.removed audit row', async () => {
    alignClock();
    const moderator = await actor('moderator');
    const author = await createUser(auth, { displayName: 'Yorumcu Oyuncu' });
    const venue = await insertVenue({ verified: true });
    const reviewId = await insertReview(venue.id, author.id);

    const page = paginatedResponseSchema(adminReviewSchema).parse(
      await body(
        await send(listReviewsRoute, 'GET', '/api/v1/admin/reviews', moderator.headers, {
          query: { venue: venue.id },
        }),
        200,
      ),
    );
    expect(page.items).toEqual([
      expect.objectContaining({
        id: reviewId,
        author: { id: author.id, displayName: 'Yorumcu Oyuncu' },
        venue: expect.objectContaining({ id: venue.id, slug: venue.slug }),
      }),
    ]);

    const removed = await send(
      deleteReviewRoute,
      'DELETE',
      `/api/v1/admin/reviews/${reviewId}`,
      moderator.headers,
      { params: { id: reviewId } },
    );
    expect(removed.status).toBe(204);
    expect(await db().select().from(venueReviews).where(eq(venueReviews.id, reviewId))).toEqual([]);
    const rows = await auditRows('review.removed', reviewId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).toEqual({ venueId: venue.id, authorId: author.id, rating: 2 });

    await expectProblem(
      await send(
        deleteReviewRoute,
        'DELETE',
        `/api/v1/admin/reviews/${reviewId}`,
        moderator.headers,
        {
          params: { id: reviewId },
        },
      ),
      404,
      'not_found',
    );
  });

  it('removes an open call, rejects its pending application and notifies the applicant', async () => {
    alignClock();
    const moderator = await actor('moderator');
    const fixture = await insertOpenCall();

    const listed = paginatedResponseSchema(adminOpenCallSchema).parse(
      await body(
        await send(listCallsRoute, 'GET', '/api/v1/admin/open-calls', moderator.headers, {
          query: { status: 'open', limit: '100' },
        }),
        200,
      ),
    );
    expect(listed.items.map((item) => item.id)).toContain(fixture.callId);

    const path = `/api/v1/admin/open-calls/${fixture.callId}`;
    const first = await send(removeCallRoute, 'DELETE', path, moderator.headers, {
      params: { id: fixture.callId },
    });
    expect(first.status, await first.clone().text()).toBe(204);
    const [call] = await db().select().from(openCalls).where(eq(openCalls.id, fixture.callId));
    expect(call?.status).toBe('removed');
    const [application] = await db()
      .select()
      .from(openCallApplications)
      .where(eq(openCallApplications.id, fixture.applicationId));
    expect(application?.status).toBe('rejected');
    const pushes = await storedJobs(auth.database.url, 'push.send');
    expect(
      pushes.filter(
        (job) =>
          job.data.refId === fixture.applicationId && job.data.type === 'application.decided',
      ),
    ).toHaveLength(1);

    const again = await send(removeCallRoute, 'DELETE', path, moderator.headers, {
      params: { id: fixture.callId },
    });
    expect(again.status).toBe(204);
    const rows = await auditRows('opencall.removed', fixture.callId);
    expect(rows.map((row) => row.metadata)).toEqual([
      { matchId: fixture.matchId, previousStatus: 'open', changed: true, rejected: 1 },
      { matchId: fixture.matchId, previousStatus: 'removed', changed: false, rejected: 0 },
    ]);
    await expectProblem(
      await send(removeCallRoute, 'DELETE', `/api/v1/admin/open-calls/${ID}`, moderator.headers, {
        params: { id: ID },
      }),
      404,
      'not_found',
    );
  });
});

// ---------------------------------------------------------------------------
// Users, roles and deactivation
// ---------------------------------------------------------------------------

describe('admin users', () => {
  it('lists accounts with a masked email and never a tombstone', async () => {
    alignClock();
    const moderator = await actor('moderator');
    const tag = randomBytes(3).toString('hex');
    const listed = await createUser(auth, { displayName: `Liste ${tag}` });
    await createUser(auth, {
      displayName: `Liste ${tag} Silinmiş`,
      isTombstone: true,
      passwordHash: null,
      deactivatedAt: new Date(),
    });
    const page = paginatedResponseSchema(adminUserSchema).parse(
      await body(
        await send(listUsersRoute, 'GET', '/api/v1/admin/users', moderator.headers, {
          query: { q: `liste ${tag}`, role: 'user' },
        }),
        200,
      ),
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: listed.id,
      maskedEmail: `${listed.email.slice(0, 1)}***@e***`,
      role: 'user',
      totpEnrolled: false,
      deactivatedAt: null,
    });
    expect(JSON.stringify(page)).not.toContain(listed.email);
  });

  it('changes a role with a fresh code and audits it', async () => {
    alignClock();
    const admin = await actor('admin');
    const target = await createUser(auth);
    const updated = adminUserSchema.parse(
      await body(
        await send(roleRoute, 'PATCH', `/api/v1/admin/users/${target.id}/role`, admin.headers, {
          params: { id: target.id },
          json: { role: 'moderator', totpCode: codeFor(admin.secret) },
        }),
        200,
      ),
    );
    expect(updated).toMatchObject({ id: target.id, role: 'moderator' });
    const rows = await auditRows('user.roleChanged', target.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: admin.id,
      metadata: { from: 'user', to: 'moderator', changed: true },
    });

    // The same code cannot be used twice.
    await expectProblem(
      await send(roleRoute, 'PATCH', `/api/v1/admin/users/${target.id}/role`, admin.headers, {
        params: { id: target.id },
        json: { role: 'user', totpCode: codeFor(admin.secret) },
      }),
      401,
      'totp_invalid',
    );
    nextStep();
    await body(
      await send(roleRoute, 'PATCH', `/api/v1/admin/users/${target.id}/role`, admin.headers, {
        params: { id: target.id },
        json: { role: 'user', totpCode: codeFor(admin.secret) },
      }),
      200,
    );
  });

  it('refuses a wrong code, the own account and an unknown target without side effects', async () => {
    alignClock();
    const admin = await actor('admin');
    const target = await createUser(auth);
    await expectProblem(
      await send(roleRoute, 'PATCH', `/api/v1/admin/users/${target.id}/role`, admin.headers, {
        params: { id: target.id },
        json: { role: 'admin', totpCode: wrongCode(admin.secret) },
      }),
      401,
      'totp_invalid',
    );
    const [unchanged] = await db().select().from(users).where(eq(users.id, target.id));
    expect(unchanged?.role).toBe('user');
    expect(await auditRows('user.roleChanged', target.id)).toEqual([]);
    expect(await auditRows('admin.freshTotpFailed', admin.id)).toHaveLength(1);

    const accountRoutes = [
      {
        handler: roleRoute,
        suffix: 'role',
        json: { role: 'user', totpCode: codeFor(admin.secret) },
      },
      {
        handler: deactivateRoute,
        suffix: 'deactivate',
        json: { deactivated: true, totpCode: codeFor(admin.secret) },
      },
    ];
    for (const { handler, suffix, json } of accountRoutes) {
      await expectProblem(
        await send(handler, 'PATCH', `/api/v1/admin/users/${admin.id}/${suffix}`, admin.headers, {
          params: { id: admin.id },
          json,
        }),
        403,
        'forbidden',
      );
      await expectProblem(
        await send(handler, 'PATCH', `/api/v1/admin/users/${ID}/${suffix}`, admin.headers, {
          params: { id: ID },
          json,
        }),
        404,
        'not_found',
      );
    }
    const [self] = await db().select().from(users).where(eq(users.id, admin.id));
    expect(self).toMatchObject({ role: 'admin', deactivatedAt: null, totpLastUsedStep: null });
  });

  it('serializes two admins demoting each other: one wins, an active admin remains', async () => {
    alignClock();
    const first = await actor('admin');
    const second = await actor('admin');
    const [a, b] = await Promise.all([
      send(roleRoute, 'PATCH', `/api/v1/admin/users/${second.id}/role`, first.headers, {
        params: { id: second.id },
        json: { role: 'user', totpCode: codeFor(first.secret) },
      }),
      send(roleRoute, 'PATCH', `/api/v1/admin/users/${first.id}/role`, second.headers, {
        params: { id: first.id },
        json: { role: 'user', totpCode: codeFor(second.secret) },
      }),
    ]);
    // The loser lost its role either before authentication or while it waited for the admin
    // row locks; both answer 403 and leave the winner as the remaining admin.
    expect([a.status, b.status].sort()).toEqual([200, 403]);
    const roles = await db()
      .select({ role: users.role })
      .from(users)
      .where(inArray(users.id, [first.id, second.id]));
    expect(roles.map((row) => row.role).sort()).toEqual(['admin', 'user']);
  });

  it('deactivates an account, revokes its sessions and reactivates it', async () => {
    alignClock();
    const admin = await actor('admin');
    const target = await actor('user', { stepUp: false });
    const path = `/api/v1/admin/users/${target.id}/deactivate`;
    const deactivated = adminUserSchema.parse(
      await body(
        await send(deactivateRoute, 'PATCH', path, admin.headers, {
          params: { id: target.id },
          json: { deactivated: true, totpCode: codeFor(admin.secret) },
        }),
        200,
      ),
    );
    expect(deactivated.deactivatedAt).not.toBeNull();
    const live = await db()
      .select({ revokedAt: refreshTokens.revokedAt })
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, target.id));
    expect(live.length).toBeGreaterThan(0);
    expect(live.every((row) => row.revokedAt !== null)).toBe(true);
    await expectProblem(
      await call(meRoute, { method: 'GET', path: '/api/v1/me', headers: target.headers }),
      401,
      'account_deactivated',
    );

    nextStep();
    const reactivated = adminUserSchema.parse(
      await body(
        await send(deactivateRoute, 'PATCH', path, admin.headers, {
          params: { id: target.id },
          json: { deactivated: false, totpCode: codeFor(admin.secret) },
        }),
        200,
      ),
    );
    expect(reactivated.deactivatedAt).toBeNull();
    expect(await auditRows('user.deactivated', target.id)).toHaveLength(1);
    expect(await auditRows('user.reactivated', target.id)).toHaveLength(1);
  });

  it('refuses to lift a deactivation while a self-initiated deletion is pending', async () => {
    alignClock();
    const admin = await actor('admin');
    const now = auth.harness.runtime.now();
    const target = await createUser(auth, { deactivatedAt: now });
    await db()
      .insert(deletionRequests)
      .values({
        userId: target.id,
        requestedAt: now,
        graceUntil: new Date(now.getTime() + 7 * 86_400_000),
      });
    await expectProblem(
      await send(
        deactivateRoute,
        'PATCH',
        `/api/v1/admin/users/${target.id}/deactivate`,
        admin.headers,
        {
          params: { id: target.id },
          json: { deactivated: false, totpCode: codeFor(admin.secret) },
        },
      ),
      409,
      'deletion_pending',
    );
    const [row] = await db().select().from(users).where(eq(users.id, target.id));
    expect(row?.deactivatedAt).not.toBeNull();
    expect(await auditRows('user.reactivated', target.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Venue import request and audit log
// ---------------------------------------------------------------------------

describe('admin venue import and audit log', () => {
  it('stores the CSV, enqueues venue.import and serves the state', async () => {
    alignClock();
    const admin = await actor('admin');
    const csv =
      'name,il,ilce,latitude,longitude,indoor\nYeni Saha,izmir,bornova,38.46,27.21,false\n';
    const created = venueImportSchema.parse(
      await body(
        await send(importRoute, 'POST', '/api/v1/admin/venues/import', admin.headers, {
          json: { csv, dryRun: true },
        }),
        202,
      ),
    );
    expect(created).toMatchObject({
      status: 'queued',
      dryRun: true,
      totalRows: null,
      createdRows: 0,
      issues: [],
      completedAt: null,
    });
    const [stored] = await db().select().from(venueImports).where(eq(venueImports.id, created.id));
    expect(stored).toMatchObject({ csv, createdBy: admin.id, status: 'queued' });
    const jobs = (await storedJobs(auth.database.url, 'venue.import')).filter(
      (job) => job.data.importId === created.id,
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.singletonKey).toBe(`venue-import:${created.id}`);
    const rows = await auditRows('venue.importRequested', created.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).toEqual({ dryRun: true, csvChars: csv.length });

    const moderator = await actor('moderator');
    const state = venueImportSchema.parse(
      await body(
        await send(
          getImportRoute,
          'GET',
          `/api/v1/admin/venues/import/${created.id}`,
          moderator.headers,
          { params: { importId: created.id } },
        ),
        200,
      ),
    );
    expect(state).toEqual(created);
    expect(JSON.stringify(state)).not.toContain('Yeni Saha');
    await expectProblem(
      await send(getImportRoute, 'GET', `/api/v1/admin/venues/import/${ID}`, moderator.headers, {
        params: { importId: ID },
      }),
      404,
      'not_found',
    );
  });

  it('lists audit rows newest first with filters and without ip hashes', async () => {
    alignClock();
    const admin = await actor('admin');
    const moderator = await actor('moderator');
    const venue = await insertVenue();
    await body(
      await send(updateVenueRoute, 'PATCH', `/api/v1/admin/venues/${venue.id}`, moderator.headers, {
        params: { id: venue.id },
        json: { verified: true },
      }),
      200,
    );
    const page = paginatedResponseSchema(auditLogEntrySchema).parse(
      await body(
        await send(listAuditLogsRoute, 'GET', '/api/v1/admin/audit-logs', admin.headers, {
          query: { action: 'venue.verified', target: venue.id, targetType: 'venue' },
        }),
        200,
      ),
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      action: 'venue.verified',
      targetId: venue.id,
      actor: { id: moderator.id },
    });
    expect(JSON.stringify(page)).not.toMatch(/ipHash|ip_hash/);

    const byActor = paginatedResponseSchema(auditLogEntrySchema).parse(
      await body(
        await send(listAuditLogsRoute, 'GET', '/api/v1/admin/audit-logs', admin.headers, {
          query: { actor: moderator.id },
        }),
        200,
      ),
    );
    expect(byActor.items.every((item) => item.actor?.id === moderator.id)).toBe(true);
  });
});
