import { setTimeout as delay } from 'node:timers/promises';

import { hashToken } from '@kadro/auth';
import { mobileRefreshResponseSchema, webAuthResponseSchema } from '@kadro/contracts';
import { auditLogs, refreshTokens } from '@kadro/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { POST as login } from '../../app/api/v1/auth/login/route';
import { POST as refresh } from '../../app/api/v1/auth/refresh/route';
import { expectProblem } from '../support/http';
import {
  type AuthHarness,
  createUser,
  mobile,
  mobileLogin,
  parseSetCookies,
  post,
  setupAuthHarness,
  uniqueIp,
  web,
} from './support';

/**
 * Refresh rotation (security checklist item 12, ADR-0014, ADR-0019, matrix §3.1 footnote 1):
 * atomic rotation, reuse detection with family revocation, the concurrent-use race, transport
 * mismatch without revocation, expiry and the per-family rate limit.
 */

let auth: AuthHarness;

beforeAll(async () => {
  auth = await setupAuthHarness('web_auth_refresh', {
    RATE_LIMIT_AUTH_MAX: '100',
    RATE_LIMIT_REFRESH_MAX: '30',
  });
});

afterAll(async () => {
  await auth.database.dispose();
});

beforeEach(() => {
  auth.harness.setNow(new Date());
});

async function familyOf(token: string): Promise<string> {
  const [row] = await auth.database.client.db
    .select({ familyId: refreshTokens.familyId })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashToken(token)));
  if (row === undefined) {
    throw new Error('token not stored');
  }
  return row.familyId;
}

async function liveTokens(familyId: string): Promise<number> {
  const rows = await auth.database.client.db
    .select({ id: refreshTokens.id })
    .from(refreshTokens)
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  return rows.length;
}

async function mobileSession() {
  const user = await createUser(auth);
  const session = await mobileLogin(login, user.email, user.password);
  return { user, refreshToken: session.tokens.refreshToken };
}

function rotate(refreshToken: string, ip = uniqueIp()): Promise<Response> {
  return post(refresh, mobile(ip), { refreshToken });
}

describe('rotation', () => {
  it('issues a new pair, keeps the family and spends the presented token', async () => {
    const { refreshToken } = await mobileSession();
    const familyId = await familyOf(refreshToken);
    const response = await rotate(refreshToken);
    expect(response.status).toBe(200);
    const body = mobileRefreshResponseSchema.parse(await response.json());
    expect(await familyOf(body.tokens.refreshToken)).toBe(familyId);
    expect(await liveTokens(familyId)).toBe(1);

    const [spent] = await auth.database.client.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashToken(refreshToken)));
    expect(spent?.revokedAt).not.toBeNull();
    const [successor] = await auth.database.client.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashToken(body.tokens.refreshToken)));
    expect(successor?.rotatedFrom).toBe(spent?.id);
  });

  it('revokes the whole family when a rotated token is presented again', async () => {
    const { user, refreshToken } = await mobileSession();
    const familyId = await familyOf(refreshToken);
    const first = mobileRefreshResponseSchema.parse(await (await rotate(refreshToken)).json());

    await expectProblem(await rotate(refreshToken), 401, 'unauthenticated');
    expect(await liveTokens(familyId)).toBe(0);
    // The legitimate holder of the newest token is logged out too.
    await expectProblem(await rotate(first.tokens.refreshToken), 401, 'unauthenticated');

    const audit = await auth.database.client.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.actorId, user.id), eq(auditLogs.action, 'auth.refreshReuse')));
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(audit[0]?.targetId).toBe(familyId);
    expect(audit[0]?.metadata).toMatchObject({ client: 'mobile' });
  });

  it('lets exactly one of two concurrent uses win and then revokes the family', async () => {
    for (let round = 0; round < 5; round += 1) {
      const { refreshToken } = await mobileSession();
      const familyId = await familyOf(refreshToken);
      const responses = await Promise.all([rotate(refreshToken), rotate(refreshToken)]);
      const statuses = responses.map((response) => response.status).sort();
      expect(statuses).toEqual([200, 401]);

      const winner = responses.find((response) => response.status === 200);
      const winnerBody = mobileRefreshResponseSchema.parse(await winner?.json());
      // The loser counted as reuse: nothing in the family is usable, the winner's token included.
      expect(await liveTokens(familyId)).toBe(0);
      await expectProblem(await rotate(winnerBody.tokens.refreshToken), 401, 'unauthenticated');
      const rows = await auth.database.client.db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.familyId, familyId));
      // Login row + exactly one successor: the loser inserted nothing.
      expect(rows).toHaveLength(2);
    }
  });

  it('rejects an expired token without revoking the family', async () => {
    const { refreshToken } = await mobileSession();
    const familyId = await familyOf(refreshToken);
    auth.harness.advance(31 * 24 * 3_600_000);
    await expectProblem(await rotate(refreshToken), 401, 'unauthenticated');
    expect(await liveTokens(familyId)).toBe(1);
  });

  it('rejects an unknown token', async () => {
    await expectProblem(await rotate('A'.repeat(43)), 401, 'unauthenticated');
  });
});

describe('client type binding (ADR-0014)', () => {
  it('rejects a mobile refresh token presented as a web cookie, without touching the family', async () => {
    const { refreshToken } = await mobileSession();
    const familyId = await familyOf(refreshToken);
    const response = await post(
      refresh,
      web(uniqueIp(), { cookie: `__Host-kadro_session=${refreshToken}` }),
      {},
    );
    await expectProblem(response, 401, 'unauthenticated');
    expect(await liveTokens(familyId)).toBe(1);
    expect((await rotate(refreshToken)).status).toBe(200);
  });

  it('rejects a web session token presented as a mobile refresh token, without revoking it', async () => {
    const user = await createUser(auth);
    const signedIn = await post(login, web(), { email: user.email, password: user.password });
    const body = webAuthResponseSchema.parse(await signedIn.json());
    const sessionValue = parseSetCookies(signedIn).get('__Host-kadro_session')?.value ?? '';
    const familyId = await familyOf(sessionValue);

    await expectProblem(await rotate(sessionValue), 401, 'unauthenticated');
    expect(await liveTokens(familyId)).toBe(1);

    const cookie = `__Host-kadro_session=${sessionValue}; __Host-kadro_csrf=${body.csrfToken}`;
    const webRotation = await post(
      refresh,
      web(uniqueIp(), { cookie, 'x-csrf-token': body.csrfToken }),
      {},
    );
    expect(webRotation.status).toBe(200);
  });

  it('rejects a web refresh whose CSRF token belongs to another session', async () => {
    const user = await createUser(auth);
    const a = await post(login, web(), { email: user.email, password: user.password });
    const b = await post(login, web(), { email: user.email, password: user.password });
    const sessionA = parseSetCookies(a).get('__Host-kadro_session')?.value ?? '';
    const csrfB = webAuthResponseSchema.parse(await b.json()).csrfToken;
    const cookie = `__Host-kadro_session=${sessionA}; __Host-kadro_csrf=${csrfB}`;
    await expectProblem(
      await post(refresh, web(uniqueIp(), { cookie, 'x-csrf-token': csrfB }), {}),
      403,
      'csrf_failed',
    );
    expect(await liveTokens(await familyOf(sessionA))).toBe(1);
  });

  it('refuses a refresh body on web and a missing token on mobile', async () => {
    await expectProblem(
      await post(refresh, web(), { refreshToken: 'A'.repeat(43) }),
      400,
      'validation_failed',
    );
    await expectProblem(await post(refresh, mobile(), {}), 400, 'validation_failed');
    await expectProblem(await post(refresh, web(), {}), 401, 'unauthenticated');
  });
});

describe('group R rate limit', () => {
  it('limits refreshes per family', async () => {
    let { refreshToken } = await mobileSession();
    for (let index = 0; index < 30; index += 1) {
      const response = await rotate(refreshToken);
      expect(response.status).toBe(200);
      refreshToken = mobileRefreshResponseSchema.parse(await response.json()).tokens.refreshToken;
    }
    const limited = await rotate(refreshToken);
    await expectProblem(limited.clone(), 429, 'rate_limited');
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    // A rate-limited request rotates nothing: the token is still the newest one.
    auth.harness.advance(16 * 60 * 1_000);
    expect((await rotate(refreshToken)).status).toBe(200);
  });
});

describe('family lock (rotation vs. revocation)', () => {
  /**
   * Test-only trigger that holds a rotation inside its transaction (after the predecessor row is
   * locked and revoked, before the successor is committed), so a concurrent revocation of the
   * family deterministically overlaps it.
   */
  async function slowRotations<T>(fn: () => Promise<T>): Promise<T> {
    const db = auth.database.client.db;
    await db.execute(sql`
      create or replace function test_slow_rotation() returns trigger language plpgsql as $$
      begin perform pg_sleep(0.4); return new; end $$`);
    await db.execute(sql`
      create trigger test_slow_rotation before insert on refresh_tokens for each row
      when (new.rotated_from is not null) execute function test_slow_rotation()`);
    try {
      return await fn();
    } finally {
      await db.execute(sql`drop trigger if exists test_slow_rotation on refresh_tokens`);
      await db.execute(sql`drop function if exists test_slow_rotation()`);
    }
  }

  it('reuse of an old token during a rotation revokes the new successor as well', async () => {
    await slowRotations(async () => {
      for (let round = 0; round < 3; round += 1) {
        const { refreshToken: r0 } = await mobileSession();
        const familyId = await familyOf(r0);
        const r1 = mobileRefreshResponseSchema.parse(await (await rotate(r0)).json()).tokens
          .refreshToken;
        const rotation = rotate(r1);
        await delay(150);
        const reuse = rotate(r0);
        const [, reused] = await Promise.all([rotation, reuse]);
        await expectProblem(reused, 401, 'unauthenticated');
        expect(await liveTokens(familyId)).toBe(0);
      }
    });
  });
});

describe('reuse detection under the rate limit', () => {
  it('revokes the family on reuse even when the family is rate limited', async () => {
    const { refreshToken: first } = await mobileSession();
    const familyId = await familyOf(first);
    let current = first;
    for (let index = 0; index < 30; index += 1) {
      const response = await rotate(current);
      expect(response.status).toBe(200);
      current = mobileRefreshResponseSchema.parse(await response.json()).tokens.refreshToken;
    }
    await expectProblem(await rotate(current), 429, 'rate_limited');
    expect(await liveTokens(familyId)).toBe(1);

    await expectProblem(await rotate(first), 401, 'unauthenticated');
    expect(await liveTokens(familyId)).toBe(0);
  });
});
