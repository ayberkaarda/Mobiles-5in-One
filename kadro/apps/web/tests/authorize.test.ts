import { randomUUID } from 'node:crypto';

import { generateOpaqueToken, hashToken, type ResourceContext } from '@kadro/auth';
import { idSchema, updateMeRequestSchema } from '@kadro/contracts';
import {
  districts,
  refreshTokens,
  type SubscriptionStatus,
  subscriptions,
  teamMembers,
  teams,
  users,
} from '@kadro/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ApiError } from '../lib/server/errors';
import { json, route } from '../lib/server/http';
import { noParams, noQuery } from '../lib/server/validate';
import { createMigratedDatabase, type TestDatabase } from './support/db';
import { call, expectProblem, MOBILE, WEB } from './support/http';
import { installTestRuntime, type TestRuntime } from './support/runtime';

/**
 * `authorize()` and the authentication step (security checklist items 3, 4, 12; ADR-0012,
 * ADR-0013, ADR-0014), shown on the `me` resource and on a team-scoped demo route.
 */

let database: TestDatabase;
let harness: TestRuntime;
let districtId: string;

// ---------------------------------------------------------------------------
// Demo routes
// ---------------------------------------------------------------------------

/** `GET me`: authenticate, authorize `me.read`, then read the actor's own row. */
const readMe = route({
  path: '/api/v1/test/me',
  method: 'GET',
  auth: 'required',
  params: noParams,
  query: noQuery,
  body: null,
  handler: async ({ ctx, runtime }) => {
    await ctx.authorize('me.read');
    const userId = ctx.principal?.userId ?? '';
    const [row] = await runtime.db
      .select({ id: users.id, displayName: users.displayName, role: users.role })
      .from(users)
      .where(eq(users.id, userId));
    return json(row);
  },
});

/** `PATCH me`: a mutation with a strict body. */
const updateMe = route({
  path: '/api/v1/test/me',
  method: 'PATCH',
  auth: 'required',
  params: noParams,
  query: noQuery,
  body: updateMeRequestSchema,
  handler: async ({ ctx, body, runtime }) => {
    await ctx.authorize('me.update');
    if (body.displayName !== undefined) {
      await runtime.db
        .update(users)
        .set({ displayName: body.displayName })
        .where(eq(users.id, ctx.principal?.userId ?? ''));
    }
    return json({ ok: true });
  },
});

/** `GET admin/**`: staff role and step-up come from the database on every request. */
const adminRead = route({
  path: '/api/v1/test/admin',
  method: 'GET',
  auth: 'required',
  params: noParams,
  query: noQuery,
  body: null,
  handler: async ({ ctx }) => {
    await ctx.authorize('admin.read');
    return json({ ok: true });
  },
});

/**
 * `PATCH teams/:id` (matrix §2 steps 4–5): load the team through a read-scoped query that also
 * yields the actor's membership, then `can()`. Non-members get the same 404 as a missing id.
 */
const updateTeam = route({
  path: '/api/v1/test/teams/[id]',
  method: 'PATCH',
  auth: 'required',
  params: z.strictObject({ id: idSchema }),
  query: noQuery,
  body: z.strictObject({ name: z.string().min(2).max(60) }),
  handler: async ({ ctx, params, body, runtime }) => {
    const actorId = ctx.principal?.userId ?? '';
    const [team] = await runtime.db
      .select({ id: teams.id, proLocked: teams.isProLocked, role: teamMembers.role })
      .from(teams)
      .leftJoin(teamMembers, and(eq(teamMembers.teamId, teams.id), eq(teamMembers.userId, actorId)))
      .where(eq(teams.id, params.id));
    if (team === undefined) {
      throw new ApiError('not_found');
    }
    const resource: ResourceContext = { teamRole: team.role, teamProLocked: team.proLocked };
    await ctx.authorize('team.update', resource);
    await runtime.db.update(teams).set({ name: body.name }).where(eq(teams.id, team.id));
    return json({ ok: true });
  },
});

/**
 * `POST teams` (matrix §7): the actor's entitlement decides the owned-team limit. Answers the
 * principal's `isPro` so the tests see the value the gate used.
 */
const createSecondTeam = route({
  path: '/api/v1/test/teams',
  method: 'POST',
  auth: 'required',
  params: noParams,
  query: noQuery,
  body: z.strictObject({}),
  handler: async ({ ctx }) => {
    await ctx.authorize('team.create', { actorOwnedTeams: 1 });
    return json({ isPro: ctx.principal?.isPro ?? null });
  },
});

/** A handler that forgets the policy check. */
const forgetful = route({
  path: '/api/v1/test/forgetful',
  method: 'GET',
  auth: 'required',
  params: noParams,
  query: noQuery,
  body: null,
  handler: () => json({ leaked: true }),
});

/** A handler that omits a resource fact the policy needs. */
const missingFact = route({
  path: '/api/v1/test/missing-fact',
  method: 'GET',
  auth: 'required',
  params: noParams,
  query: noQuery,
  body: null,
  handler: async ({ ctx }) => {
    await ctx.authorize('team.read', {});
    return json({ leaked: true });
  },
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface Account {
  id: string;
  bearer: Record<string, string>;
  familyId: string;
}

async function createUser(overrides: Partial<typeof users.$inferInsert> = {}): Promise<Account> {
  const [row] = await database.client.db
    .insert(users)
    .values({
      email: `user-${randomUUID()}@example.test`,
      displayName: 'Test Oyuncu',
      emailVerifiedAt: new Date(),
      ...overrides,
    })
    .returning({ id: users.id });
  if (row === undefined) {
    throw new Error('user insert returned no row');
  }
  // As at login: the access token's `sid` names a live mobile refresh family of this user.
  const familyId = randomUUID();
  await database.client.db.insert(refreshTokens).values({
    tokenHash: hashToken(generateOpaqueToken()),
    userId: row.id,
    client: 'mobile',
    familyId,
    expiresAt: new Date(harness.runtime.now().getTime() + 30 * 86_400_000),
  });
  const issued = await harness.runtime.accessTokens.issue(
    { userId: row.id, sessionId: familyId },
    harness.runtime.now(),
  );
  return {
    id: row.id,
    familyId,
    bearer: { ...MOBILE, authorization: `Bearer ${issued.token}` },
  };
}

interface WebSession {
  token: string;
  familyId: string;
  csrf: string;
  cookie: string;
}

async function createWebSession(
  userId: string,
  overrides: Partial<typeof refreshTokens.$inferInsert> = {},
): Promise<WebSession> {
  const token = generateOpaqueToken();
  const familyId = randomUUID();
  await database.client.db.insert(refreshTokens).values({
    tokenHash: hashToken(token),
    userId,
    client: 'web',
    familyId,
    expiresAt: new Date(harness.runtime.now().getTime() + 7 * 86_400_000),
    ...overrides,
  });
  const csrf = harness.runtime.csrf.issue(familyId);
  return {
    token,
    familyId,
    csrf,
    cookie: `${harness.env.SESSION_COOKIE_NAME}=${token}; ${harness.env.CSRF_COOKIE_NAME}=${csrf}`,
  };
}

function webHeaders(session: WebSession, withCsrf = true): Record<string, string> {
  return {
    ...WEB,
    cookie: session.cookie,
    ...(withCsrf ? { 'x-csrf-token': session.csrf } : {}),
  };
}

async function createTeam(ownerId: string): Promise<string> {
  const [team] = await database.client.db
    .insert(teams)
    .values({
      name: 'Test Kadro',
      slug: `test-kadro-${randomUUID().slice(0, 8)}`,
      districtId,
      ownerId,
    })
    .returning({ id: teams.id });
  if (team === undefined) {
    throw new Error('team insert returned no row');
  }
  await database.client.db
    .insert(teamMembers)
    .values({ teamId: team.id, userId: ownerId, role: 'captain' });
  return team.id;
}

beforeAll(async () => {
  database = await createMigratedDatabase('web_authorize');
  harness = await installTestRuntime({ db: database.client.db });
  const [district] = await database.client.db
    .insert(districts)
    .values({
      il: 'İstanbul',
      ilce: 'Kadıköy',
      ilSlug: 'istanbul',
      slug: 'kadikoy',
      centroid: { lng: 29.03, lat: 40.99 },
    })
    .returning({ id: districts.id });
  districtId = district?.id ?? '';
});

afterAll(async () => {
  await database.dispose();
});

beforeEach(() => {
  harness.setNow(new Date());
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mobile transport (bearer access JWT)', () => {
  it('authenticates a valid token and reads the own row', async () => {
    const account = await createUser();
    const response = await call(readMe, { headers: account.bearer });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: account.id,
      displayName: 'Test Oyuncu',
      role: 'user',
    });
  });

  it('answers 401 without credentials, with WWW-Authenticate', async () => {
    const response = await call(readMe, { headers: MOBILE });
    expect(response.headers.get('www-authenticate')).toBe('Bearer realm="kadro-api"');
    await expectProblem(response, 401, 'unauthenticated');
  });

  it('rejects malformed, tampered and foreign tokens', async () => {
    const account = await createUser();
    const token = (account.bearer.authorization ?? '').slice('Bearer '.length);
    const [header = '', payload = '', signature = ''] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, 'base64url').toString()),
        sub: randomUUID(),
      }),
    ).toString('base64url');
    for (const authorization of [
      'Bearer',
      'Basic dXNlcjpwYXNz',
      `Bearer ${header}.${payload}`,
      `Bearer ${header}.${forged}.${signature}`,
      `Bearer ${header}.${payload}.${'A'.repeat(signature.length)}`,
      `Bearer ${'A'.repeat(5_000)}`,
    ]) {
      await expectProblem(
        await call(readMe, { headers: { ...MOBILE, authorization } }),
        401,
        'unauthenticated',
      );
    }
  });

  it('rejects an expired token', async () => {
    const account = await createUser();
    harness.advance(16 * 60_000);
    await expectProblem(await call(readMe, { headers: account.bearer }), 401, 'unauthenticated');
  });

  it('ignores a session cookie on a mobile request (ADR-0014)', async () => {
    const account = await createUser();
    const session = await createWebSession(account.id);
    await expectProblem(
      await call(readMe, { headers: { ...MOBILE, cookie: session.cookie } }),
      401,
      'unauthenticated',
    );
  });

  it('answers 401 when the user row no longer exists', async () => {
    const account = await createUser();
    await database.client.db.delete(users).where(eq(users.id, account.id));
    await expectProblem(await call(readMe, { headers: account.bearer }), 401, 'unauthenticated');
  });
});

describe('web transport (session cookie + CSRF)', () => {
  it('authenticates a valid session on a read without CSRF', async () => {
    const account = await createUser();
    const session = await createWebSession(account.id);
    const response = await call(readMe, { headers: webHeaders(session, false) });
    expect(response.status).toBe(200);
  });

  it('ignores a bearer token on a web request', async () => {
    const account = await createUser();
    const response = await call(readMe, {
      headers: { ...WEB, authorization: account.bearer.authorization ?? '' },
    });
    await expectProblem(response, 401, 'unauthenticated');
  });

  it('requires the CSRF header on mutations', async () => {
    const account = await createUser();
    const session = await createWebSession(account.id);
    const patch = (headers: Record<string, string>) =>
      call(updateMe, { method: 'PATCH', headers, json: { displayName: 'Yeni Ad' } });

    await expectProblem(await patch(webHeaders(session, false)), 403, 'csrf_failed');

    const other = await createWebSession(account.id);
    await expectProblem(
      await patch({ ...webHeaders(session, false), 'x-csrf-token': other.csrf }),
      403,
      'csrf_failed',
    );

    expect((await patch(webHeaders(session))).status).toBe(200);
  });

  it('rejects revoked, expired and mobile sessions presented as cookies', async () => {
    const account = await createUser();
    const revoked = await createWebSession(account.id, { revokedAt: new Date() });
    const expired = await createWebSession(account.id, { expiresAt: new Date(Date.now() - 1_000) });
    const mobileRow = await createWebSession(account.id, { client: 'mobile' });
    for (const session of [revoked, expired, mobileRow]) {
      await expectProblem(
        await call(readMe, { headers: webHeaders(session) }),
        401,
        'unauthenticated',
      );
    }
  });

  it('rejects a duplicated session cookie (cookie tossing)', async () => {
    const account = await createUser();
    const session = await createWebSession(account.id);
    const cookie = `${session.cookie}; ${harness.env.SESSION_COOKIE_NAME}=${generateOpaqueToken()}`;
    await expectProblem(
      await call(readMe, { headers: { ...WEB, cookie } }),
      401,
      'unauthenticated',
    );
  });

  it('extends a rolling session at most once per hour and renews the cookies', async () => {
    const account = await createUser();
    const ttlMs = harness.env.SESSION_TTL_SECONDS * 1_000;
    const session = await createWebSession(account.id, {
      expiresAt: new Date(harness.runtime.now().getTime() + ttlMs - 2 * 3_600_000),
    });
    const response = await call(readMe, { headers: webHeaders(session) });
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toBe(
      `${harness.env.SESSION_COOKIE_NAME}=${session.token}; Path=/; Max-Age=604800; Secure; SameSite=Lax; HttpOnly`,
    );
    expect(cookies[1]).toContain(`${harness.env.CSRF_COOKIE_NAME}=${session.csrf}`);
    expect(cookies[1]).not.toContain('HttpOnly');

    const [row] = await database.client.db
      .select({ expiresAt: refreshTokens.expiresAt })
      .from(refreshTokens)
      .where(eq(refreshTokens.familyId, session.familyId));
    expect(row?.expiresAt.getTime()).toBe(harness.runtime.now().getTime() + ttlMs);

    const again = await call(readMe, { headers: webHeaders(session) });
    expect(again.headers.getSetCookie()).toEqual([]);
  });
});

describe('account state is read from the database on every request (ADR-0012)', () => {
  it('answers 401 account_deactivated on reads and mutations with a still-valid token', async () => {
    const account = await createUser();
    expect((await call(readMe, { headers: account.bearer })).status).toBe(200);
    await database.client.db
      .update(users)
      .set({ deactivatedAt: new Date() })
      .where(eq(users.id, account.id));
    await expectProblem(
      await call(readMe, { headers: account.bearer }),
      401,
      'account_deactivated',
    );
    await expectProblem(
      await call(updateMe, {
        method: 'PATCH',
        headers: account.bearer,
        json: { displayName: 'Yeni Ad' },
      }),
      401,
      'account_deactivated',
    );
  });

  it('applies to web sessions too', async () => {
    const account = await createUser({ deactivatedAt: new Date() });
    const session = await createWebSession(account.id);
    await expectProblem(
      await call(readMe, { headers: webHeaders(session) }),
      401,
      'account_deactivated',
    );
  });

  it('takes a demotion into account on the next request', async () => {
    const admin = await createUser({ role: 'admin' });
    await database.client.db.insert(refreshTokens).values({
      tokenHash: hashToken(generateOpaqueToken()),
      userId: admin.id,
      client: 'mobile',
      familyId: admin.familyId,
      expiresAt: new Date(Date.now() + 86_400_000),
      stepUpUntil: new Date(harness.runtime.now().getTime() + 15 * 60_000),
    });
    expect((await call(adminRead, { headers: admin.bearer })).status).toBe(200);
    await database.client.db.update(users).set({ role: 'user' }).where(eq(users.id, admin.id));
    await expectProblem(await call(adminRead, { headers: admin.bearer }), 403, 'forbidden');
  });

  it('requires a step-up bound to the session family for admin actions', async () => {
    const moderator = await createUser({ role: 'moderator' });
    await expectProblem(
      await call(adminRead, { headers: moderator.bearer }),
      401,
      'step_up_required',
    );
  });
});

describe('handler template order and status mapping (matrix §2, ADR-0013)', () => {
  it('authenticates before validating input', async () => {
    const response = await call(updateMe, {
      method: 'PATCH',
      headers: MOBILE,
      json: { role: 'admin' },
    });
    await expectProblem(response, 401, 'unauthenticated');
  });

  it('validates after authentication', async () => {
    const account = await createUser();
    const response = await call(updateMe, {
      method: 'PATCH',
      headers: account.bearer,
      json: { role: 'admin' },
    });
    await expectProblem(response, 400, 'validation_failed');
  });

  it('answers 404 for non-members, identical to a missing id', async () => {
    const captain = await createUser();
    const outsider = await createUser();
    const teamId = await createTeam(captain.id);
    const patch = (headers: Record<string, string>, id: string) =>
      call(updateTeam, { method: 'PATCH', headers, params: { id }, json: { name: 'Yeni Kadro' } });

    const hidden = await expectProblem(await patch(outsider.bearer, teamId), 404, 'not_found');
    const missing = await expectProblem(
      await patch(outsider.bearer, '01920000-0000-7000-8000-00000000abcd'),
      404,
      'not_found',
    );
    expect({ ...hidden, requestId: '' }).toEqual({ ...missing, requestId: '' });
  });

  it('answers 403 for a member who may read but not act, and 200 for staff', async () => {
    const captain = await createUser();
    const player = await createUser();
    const coCaptain = await createUser();
    const teamId = await createTeam(captain.id);
    await database.client.db.insert(teamMembers).values([
      { teamId, userId: player.id, role: 'player' },
      { teamId, userId: coCaptain.id, role: 'co_captain' },
    ]);
    const patch = (headers: Record<string, string>) =>
      call(updateTeam, {
        method: 'PATCH',
        headers,
        params: { id: teamId },
        json: { name: 'Yeni Kadro' },
      });

    await expectProblem(await patch(player.bearer), 403, 'forbidden');
    expect((await patch(coCaptain.bearer)).status).toBe(200);
    expect((await patch(captain.bearer)).status).toBe(200);
  });

  it('answers 403 entitlement_required on a pro-locked team', async () => {
    const captain = await createUser();
    const teamId = await createTeam(captain.id);
    await database.client.db.update(teams).set({ isProLocked: true }).where(eq(teams.id, teamId));
    const response = await call(updateTeam, {
      method: 'PATCH',
      headers: captain.bearer,
      params: { id: teamId },
      json: { name: 'Yeni Kadro' },
    });
    await expectProblem(response, 403, 'entitlement_required');
  });

  it('fails with 500 when a handler never consults the policy', async () => {
    const account = await createUser();
    const response = await call(forgetful, { headers: account.bearer });
    const text = await response.clone().text();
    await expectProblem(response, 500, 'internal_error');
    expect(text).not.toContain('leaked');
    const requestId = response.headers.get('x-request-id') ?? '';
    const line =
      harness.logLines.find(
        (entry) => entry.includes(requestId) && entry.includes('"msg":"request failed"'),
      ) ?? '';
    expect(line).toContain('AuthorizationNotCheckedError');
  });

  it('fails closed with 500 when a resource fact is missing', async () => {
    const account = await createUser();
    const response = await call(missingFact, { headers: account.bearer });
    await expectProblem(response, 500, 'internal_error');
    expect(
      await call(missingFact, { headers: account.bearer }).then((r) => r.text()),
    ).not.toContain('leaked');
  });
});

describe('Pro entitlement of the actor (matrix §7, ADR-0065)', () => {
  const HOUR = 3_600_000;

  async function subscribe(
    userId: string,
    status: SubscriptionStatus,
    expiresAt: Date | null,
    productId = 'kadro_pro_monthly',
  ): Promise<string> {
    const [row] = await database.client.db
      .insert(subscriptions)
      .values({
        userId,
        rcAppUserId: userId,
        productId,
        status,
        expiresAt,
        environment: 'production',
        store: 'play_store',
      })
      .returning({ id: subscriptions.id });
    return row?.id ?? '';
  }

  const create = (headers: Record<string, string>) =>
    call(createSecondTeam, { method: 'POST', headers, json: {} });

  async function isPro(headers: Record<string, string>): Promise<boolean | null> {
    const response = await create(headers);
    if (response.status === 403) {
      await expectProblem(response, 403, 'entitlement_required');
      return false;
    }
    expect(response.status).toBe(200);
    return ((await response.json()) as { isPro: boolean | null }).isPro;
  }

  it('a user without a subscription row is not Pro', async () => {
    const account = await createUser();
    expect(await isPro(account.bearer)).toBe(false);
  });

  it.each([
    ['active', true],
    ['grace_period', true],
    ['billing_issue', false],
    ['paused', false],
    ['cancelled', false],
    ['expired', false],
  ] as const)('a %s row with a future expiry → Pro %s', async (status, expected) => {
    const account = await createUser();
    await subscribe(account.id, status, new Date(harness.runtime.now().getTime() + HOUR));
    expect(await isPro(account.bearer)).toBe(expected);
  });

  it('an active row whose expiry passed is not Pro, before any EXPIRATION event', async () => {
    const account = await createUser();
    await subscribe(account.id, 'active', new Date(harness.runtime.now().getTime() + 5 * 60_000));
    expect(await isPro(account.bearer)).toBe(true);
    harness.advance(10 * 60_000);
    expect(await isPro(account.bearer)).toBe(false);
  });

  it('a granting row without an end date is Pro', async () => {
    const account = await createUser();
    await subscribe(account.id, 'active', null);
    expect(await isPro(account.bearer)).toBe(true);
  });

  it('one granting row among lapsed ones is enough; other users never count', async () => {
    const account = await createUser();
    const other = await createUser();
    await subscribe(account.id, 'expired', new Date(harness.runtime.now().getTime() - HOUR));
    await subscribe(other.id, 'active', new Date(harness.runtime.now().getTime() + HOUR));
    expect(await isPro(account.bearer)).toBe(false);
    await subscribe(
      account.id,
      'active',
      new Date(harness.runtime.now().getTime() + HOUR),
      'kadro_pro_yearly',
    );
    expect(await isPro(account.bearer)).toBe(true);
  });

  it('is loaded for web sessions too', async () => {
    const account = await createUser();
    await subscribe(account.id, 'active', new Date(harness.runtime.now().getTime() + HOUR));
    const session = await createWebSession(account.id);
    expect(await isPro(webHeaders(session))).toBe(true);
  });

  it('takes a lapse into account on the next request with the same token', async () => {
    const account = await createUser();
    const id = await subscribe(
      account.id,
      'active',
      new Date(harness.runtime.now().getTime() + HOUR),
    );
    expect(await isPro(account.bearer)).toBe(true);
    await database.client.db
      .update(subscriptions)
      .set({ status: 'expired' })
      .where(eq(subscriptions.id, id));
    expect(await isPro(account.bearer)).toBe(false);
  });
});
