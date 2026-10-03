import { randomBytes } from 'node:crypto';

import { type PlatformRole } from '@kadro/contracts';
import { refreshTokens, users } from '@kadro/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PATCH as deactivateRoute } from '../../app/api/v1/admin/users/[id]/deactivate/route';
import { PATCH as roleRoute } from '../../app/api/v1/admin/users/[id]/role/route';
import { GET as listAuditLogsRoute } from '../../app/api/v1/admin/audit-logs/route';
import { GET as listUsersRoute } from '../../app/api/v1/admin/users/route';
import { POST as stepUpRoute } from '../../app/api/v1/admin/step-up/route';
import { POST as loginRoute } from '../../app/api/v1/auth/login/route';
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
  parseSetCookies,
  post,
  setupAuthHarness,
  web,
} from '../auth/support';
import { call, expectProblem } from '../support/http';
import { concretePath, fabricatedParams, loadRoutes, type LoadedRoute } from './support';

/**
 * Admin privilege escalation at the route level (authorization matrix §3.8, footnote 27,
 * ADR-0064, ADR-0066, ADR-0067). The attacker is a signed-in account trying to reach the admin
 * API without the full chain staff role → live step-up window → admin tier → fresh code:
 * a player with a forged window, staff whose window is missing, expired or exactly at its end, a
 * moderator on admin-only routes, staff demoted or deactivated while their window is still open,
 * a window opened on another session, mass-assigned fields, and concurrent cross-demotion races
 * that must always leave an active admin. The admin routes are discovered from the registry, so a
 * new admin route without a classification here fails the coverage test.
 */

let auth: AuthHarness;
let adminRoutes: LoadedRoute[] = [];
const db = () => auth.database.client.db;
const STEP_MS = TOTP_PERIOD_SECONDS * 1_000;
const WINDOW_MS = 15 * 60 * 1_000;
const UNKNOWN_ID = '018f2c1e-0000-7000-8000-0000000000ed';

/** Routes with their own policy (no step-up needed): covered by the TOTP edge suite. */
const TOTP_ROUTES = new Set([
  'POST /api/v1/admin/step-up',
  'POST /api/v1/admin/totp/enroll',
  'POST /api/v1/admin/totp/confirm',
]);

/** Staff tier: a moderator with a live window passes the policy. */
const STAFF_TIER = new Set([
  'GET /api/v1/admin/venues',
  'PATCH /api/v1/admin/venues/[id]',
  'GET /api/v1/admin/venues/import/[importId]',
  'GET /api/v1/admin/reviews',
  'DELETE /api/v1/admin/reviews/[id]',
  'GET /api/v1/admin/open-calls',
  'DELETE /api/v1/admin/open-calls/[id]',
  'GET /api/v1/admin/users',
]);

/** Admin tier only: a moderator with a live window is refused. */
const ADMIN_ONLY = new Set([
  'POST /api/v1/admin/venues/import',
  'PATCH /api/v1/admin/users/[id]/role',
  'PATCH /api/v1/admin/users/[id]/deactivate',
  'GET /api/v1/admin/audit-logs',
]);

/** A schema-valid body per admin mutation, so the policy (not validation) answers. */
const BODIES: Readonly<Record<string, unknown>> = {
  'PATCH /api/v1/admin/venues/[id]': { verified: true },
  'POST /api/v1/admin/venues/import': { csv: 'name,il,ilce,latitude,longitude,indoor\n' },
  'PATCH /api/v1/admin/users/[id]/role': { role: 'admin', totpCode: '000000' },
  'PATCH /api/v1/admin/users/[id]/deactivate': { deactivated: true, totpCode: '000000' },
};

beforeAll(async () => {
  auth = await setupAuthHarness('web_attack_edge_admin', {
    RATE_LIMIT_AUTH_MAX: '100',
    TOTP_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
  });
  adminRoutes = (await loadRoutes()).filter(
    (entry) => entry.spec.path.startsWith('/api/v1/admin/') && !TOTP_ROUTES.has(entry.key),
  );
});

afterAll(async () => {
  await auth.database.dispose();
});

/** Puts the clock 5 s into a fresh time step. */
function alignClock(): void {
  const now = Date.now();
  auth.harness.setNow(new Date(Math.floor(now / STEP_MS) * STEP_MS + STEP_MS + 5_000));
}

function nextStep(): void {
  auth.harness.setNow(new Date(auth.harness.runtime.now().getTime() + STEP_MS));
}

function key(): Buffer {
  return Buffer.from(auth.harness.env.TOTP_ENCRYPTION_KEY ?? '', 'base64url');
}

function codeFor(secret: Buffer, offsetSteps = 0): string {
  return hotp(secret, timeStep(auth.harness.runtime.now()) + offsetSteps);
}

interface Actor {
  readonly id: string;
  readonly email: string;
  readonly password: string;
  readonly headers: Record<string, string>;
  readonly secret: Buffer;
}

/** A signed-in mobile account of `role` with an active TOTP secret and no step-up window. */
async function actor(role: PlatformRole): Promise<Actor> {
  const user = await createUser(auth, {
    role,
    displayName: `Saldirgan ${randomBytes(3).toString('hex')}`,
  });
  const session = await mobileLogin(loginRoute, user.email, user.password);
  const secret = generateTotpSecret();
  await db()
    .update(users)
    .set({ totpSecretEnc: encryptTotpSecret(key(), user.id, secret) })
    .where(eq(users.id, user.id));
  return {
    ...user,
    headers: mobile(undefined, { authorization: `Bearer ${session.tokens.accessToken}` }),
    secret,
  };
}

/** Writes a step-up window ending `untilMs` after the harness clock on every row of the user. */
async function setWindow(userId: string, untilMs: number): Promise<void> {
  await db()
    .update(refreshTokens)
    .set({ stepUpUntil: new Date(auth.harness.runtime.now().getTime() + untilMs) })
    .where(eq(refreshTokens.userId, userId));
}

async function account(userId: string) {
  const [row] = await db().select().from(users).where(eq(users.id, userId));
  return row;
}

function send(
  handler: RouteHandler,
  method: string,
  path: string,
  headers: Record<string, string>,
  options: { params?: Record<string, string>; json?: unknown } = {},
): Promise<Response> {
  return call(handler, {
    method,
    path,
    headers,
    ...(options.params === undefined ? {} : { params: options.params }),
    ...(options.json === undefined ? {} : { json: options.json }),
  });
}

/** Calls a discovered admin route; `users/[id]` routes target `targetId`. */
function hit(entry: LoadedRoute, headers: Record<string, string>, targetId: string) {
  // Ids are UUIDv7 (ADR-0016): a schema-valid id that addresses nothing, or the victim.
  const params = Object.fromEntries(
    Object.keys(fabricatedParams(entry.spec.path)).map((name) => [
      name,
      entry.spec.path.includes('/admin/users/') ? targetId : UNKNOWN_ID,
    ]),
  );
  return call(entry.handler, {
    method: entry.spec.method,
    path: concretePath(entry.spec.path, params),
    headers,
    params,
    ...(entry.key in BODIES ? { json: BODIES[entry.key] } : {}),
  });
}

const roleChange = (admin: Actor, targetId: string, role: PlatformRole, totpCode: string) =>
  send(roleRoute, 'PATCH', `/api/v1/admin/users/${targetId}/role`, admin.headers, {
    params: { id: targetId },
    json: { role, totpCode },
  });

const deactivation = (admin: Actor, targetId: string, totpCode: string) =>
  send(deactivateRoute, 'PATCH', `/api/v1/admin/users/${targetId}/deactivate`, admin.headers, {
    params: { id: targetId },
    json: { deactivated: true, totpCode },
  });

const listUsers = (headers: Record<string, string>) =>
  send(listUsersRoute, 'GET', '/api/v1/admin/users', headers);

const auditLog = (headers: Record<string, string>) =>
  send(listAuditLogsRoute, 'GET', '/api/v1/admin/audit-logs', headers);

/** The victim of the sweeps must come out untouched and the attacker must have spent no step. */
async function expectUntouched(attacker: Actor, victimId: string): Promise<void> {
  expect(await account(victimId)).toMatchObject({ role: 'user', deactivatedAt: null });
  expect((await account(attacker.id))?.totpLastUsedStep).toBeNull();
}

describe('admin route registry', () => {
  it('classifies every discovered admin route and has a body for every mutation', () => {
    expect(adminRoutes.length).toBeGreaterThanOrEqual(12);
    for (const entry of adminRoutes) {
      expect(STAFF_TIER.has(entry.key) || ADMIN_ONLY.has(entry.key), entry.key).toBe(true);
      if (entry.spec.bodies.length > 0) {
        expect(entry.key in BODIES, entry.key).toBe(true);
      }
    }
  });
});

describe('policy chain on every admin route', () => {
  it('refuses a player with a forged step-up window (403 before any read)', async () => {
    alignClock();
    const player = await actor('user');
    await setWindow(player.id, WINDOW_MS);
    const victim = await createUser(auth);
    for (const entry of adminRoutes) {
      await expectProblem(await hit(entry, player.headers, victim.id), 403, 'forbidden');
    }
    await expectUntouched(player, victim.id);
  });

  it('refuses staff with no window, an expired window and a window ending exactly now', async () => {
    alignClock();
    const victim = await createUser(auth);
    for (const role of ['moderator', 'admin'] as const) {
      for (const until of [null, -1, -WINDOW_MS, 0]) {
        const staff = await actor(role);
        if (until !== null) {
          await setWindow(staff.id, until);
        }
        for (const entry of adminRoutes) {
          await expectProblem(await hit(entry, staff.headers, victim.id), 401, 'step_up_required');
        }
        await expectUntouched(staff, victim.id);
      }
    }
  });

  it('accepts a window one millisecond before its end and refuses it one millisecond after', async () => {
    alignClock();
    const moderator = await actor('moderator');
    await setWindow(moderator.id, 1);
    expect((await listUsers(moderator.headers)).status).toBe(200);
    auth.harness.advance(1);
    await expectProblem(await listUsers(moderator.headers), 401, 'step_up_required');
  });

  it('refuses a moderator with a live window on every admin-only route', async () => {
    alignClock();
    const moderator = await actor('moderator');
    await setWindow(moderator.id, WINDOW_MS);
    const victim = await createUser(auth);
    for (const entry of adminRoutes.filter((route) => ADMIN_ONLY.has(route.key))) {
      await expectProblem(await hit(entry, moderator.headers, victim.id), 403, 'forbidden');
    }
    // A moderator promoting itself is the same refusal.
    await expectProblem(
      await roleChange(moderator, moderator.id, 'admin', codeFor(moderator.secret)),
      403,
      'forbidden',
    );
    expect(await account(moderator.id)).toMatchObject({
      role: 'moderator',
      totpLastUsedStep: null,
    });
    await expectUntouched(moderator, victim.id);
  });
});

describe('role and session changes while a window is open', () => {
  it('drops a demoted admin to the new role on its very next request', async () => {
    alignClock();
    const attacker = await actor('admin');
    const owner = await actor('admin');
    await setWindow(attacker.id, WINDOW_MS);
    await setWindow(owner.id, WINDOW_MS);
    expect((await auditLog(attacker.headers)).status).toBe(200);

    const demoted = await roleChange(owner, attacker.id, 'moderator', codeFor(owner.secret));
    expect(demoted.status, await demoted.clone().text()).toBe(200);
    // Same access token and window: staff tier still opens, admin tier does not.
    expect((await listUsers(attacker.headers)).status).toBe(200);
    await expectProblem(await auditLog(attacker.headers), 403, 'forbidden');
    await expectProblem(
      await roleChange(attacker, owner.id, 'user', codeFor(attacker.secret)),
      403,
      'forbidden',
    );

    nextStep();
    const toUser = await roleChange(owner, attacker.id, 'user', codeFor(owner.secret));
    expect(toUser.status, await toUser.clone().text()).toBe(200);
    await expectProblem(await listUsers(attacker.headers), 403, 'forbidden');
    expect(await account(owner.id)).toMatchObject({ role: 'admin', deactivatedAt: null });
    expect((await account(attacker.id))?.totpLastUsedStep).toBeNull();
  });

  it('locks a deactivated admin out although its window is still open', async () => {
    alignClock();
    const attacker = await actor('admin');
    const owner = await actor('admin');
    await setWindow(attacker.id, WINDOW_MS);
    await setWindow(owner.id, WINDOW_MS);
    const response = await deactivation(owner, attacker.id, codeFor(owner.secret));
    expect(response.status, await response.clone().text()).toBe(200);
    await expectProblem(await listUsers(attacker.headers), 401, 'account_deactivated');
    await expectProblem(
      await deactivation(attacker, owner.id, codeFor(attacker.secret)),
      401,
      'account_deactivated',
    );
    expect((await account(owner.id))?.deactivatedAt).toBeNull();
  });

  it('does not carry a mobile step-up window to a web session of the same account', async () => {
    alignClock();
    const staff = await actor('admin');
    const opened = await post(
      stepUpRoute,
      staff.headers,
      { totpCode: codeFor(staff.secret) },
      '/api/v1/admin/step-up',
    );
    expect(opened.status, await opened.clone().text()).toBe(200);
    expect((await listUsers(staff.headers)).status).toBe(200);

    const login = await post(loginRoute, web(), { email: staff.email, password: staff.password });
    expect(login.status).toBe(200);
    const cookies = parseSetCookies(login);
    const session = cookies.get(auth.harness.env.SESSION_COOKIE_NAME)?.value ?? '';
    const csrf = cookies.get(auth.harness.env.CSRF_COOKIE_NAME)?.value ?? '';
    const browser = web(undefined, {
      cookie: `${auth.harness.env.SESSION_COOKIE_NAME}=${session}; ${auth.harness.env.CSRF_COOKIE_NAME}=${csrf}`,
      'x-csrf-token': csrf,
    });
    await expectProblem(await listUsers(browser), 401, 'step_up_required');
    const webRows = await db()
      .select({ stepUpUntil: refreshTokens.stepUpUntil })
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, staff.id), eq(refreshTokens.client, 'web')));
    expect(webRows.map((row) => row.stepUpUntil)).toEqual([null]);
  });

  it('refuses mass-assigned fields, unknown roles and a malformed target id without spending a step', async () => {
    alignClock();
    const admin = await actor('admin');
    await setWindow(admin.id, WINDOW_MS);
    const victim = await createUser(auth);
    const code = codeFor(admin.secret);
    const hostileBodies: unknown[] = [
      { role: 'admin', totpCode: code, userId: admin.id },
      { role: 'admin', totpCode: code, isSelf: false },
      { role: 'admin', totpCode: code, freshTotp: true },
      { role: 'owner', totpCode: code },
      { role: 'ADMIN', totpCode: code },
      { role: ['admin'], totpCode: code },
      { role: 'admin' },
    ];
    for (const json of hostileBodies) {
      await expectProblem(
        await send(roleRoute, 'PATCH', `/api/v1/admin/users/${victim.id}/role`, admin.headers, {
          params: { id: victim.id },
          json,
        }),
        400,
        'validation_failed',
      );
    }
    await expectProblem(
      await send(roleRoute, 'PATCH', '/api/v1/admin/users/not-a-uuid/role', admin.headers, {
        params: { id: 'not-a-uuid' },
        json: { role: 'admin', totpCode: code },
      }),
      400,
      'validation_failed',
    );
    await expectUntouched(admin, victim.id);
  });
});

describe('concurrent cross-demotion keeps an active admin', () => {
  it('serializes two admins deactivating each other: exactly one wins', async () => {
    alignClock();
    const first = await actor('admin');
    const second = await actor('admin');
    await setWindow(first.id, WINDOW_MS);
    await setWindow(second.id, WINDOW_MS);
    const responses = await Promise.all([
      deactivation(first, second.id, codeFor(first.secret)),
      deactivation(second, first.id, codeFor(second.secret)),
    ]);
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    for (const status of statuses.filter((value) => value !== 200)) {
      expect([401, 403]).toContain(status);
    }
    const rows = await db()
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          inArray(users.id, [first.id, second.id]),
          eq(users.role, 'admin'),
          isNull(users.deactivatedAt),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it('serializes a three-admin demotion cycle: two win, one refused, one admin left', async () => {
    alignClock();
    const ring = [await actor('admin'), await actor('admin'), await actor('admin')] as const;
    for (const member of ring) {
      await setWindow(member.id, WINDOW_MS);
    }
    const responses = await Promise.all(
      ring.map((member, index) => {
        const target = ring[(index + 1) % ring.length] as Actor;
        return roleChange(member, target.id, 'user', codeFor(member.secret));
      }),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 403]);
    const admins = await db()
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          inArray(
            users.id,
            ring.map((member) => member.id),
          ),
          eq(users.role, 'admin'),
        ),
      );
    expect(admins).toHaveLength(1);
  });
});
