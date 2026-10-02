import { randomUUID } from 'node:crypto';

import { generateOpaqueToken, hashToken } from '@kadro/auth';
import { RATE_LIMIT_GROUPS } from '@kadro/contracts';
import { rateLimitBuckets, refreshTokens, users } from '@kadro/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { groupLimitKeys } from '../lib/server/group-limits';
import { json, route } from '../lib/server/http';
import { noParams, noQuery } from '../lib/server/validate';
import { createMigratedDatabase, type TestDatabase } from './support/db';
import { TEST_EDGE_PROXY } from './support/env';
import { call, expectProblem, MOBILE } from './support/http';
import { installTestRuntime, type TestRuntime } from './support/runtime';

/**
 * Endpoint-group rate limits applied by `route()` from the registry's `rateLimit` field
 * (authorization matrix §8, handoff teams-to-web-001 §1): one counter per user and group across
 * endpoints, keyed-hash bucket keys per user and address, anonymous callers counted by address for
 * `user+ip` groups, charged after validation.
 */

let database: TestDatabase;
let harness: TestRuntime;

beforeAll(async () => {
  database = await createMigratedDatabase('web_group_limits');
  harness = await installTestRuntime({ db: database.client.db });
});

afterAll(async () => {
  await database.dispose();
});

beforeEach(async () => {
  harness.setNow(new Date());
  await database.client.db.delete(rateLimitBuckets);
});

let ipCounter = 0;
function fromIp(ip?: string): Record<string, string> {
  ipCounter += 1;
  const address = ip ?? `198.18.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
  return { 'x-forwarded-for': `${address}, ${TEST_EDGE_PROXY}` };
}

async function signedIn(): Promise<Record<string, string>> {
  const [user] = await database.client.db
    .insert(users)
    .values({
      email: `limit-${randomUUID()}@example.test`,
      displayName: 'Limit Oyuncu',
      emailVerifiedAt: new Date(),
    })
    .returning({ id: users.id });
  const userId = user?.id ?? '';
  const familyId = randomUUID();
  await database.client.db.insert(refreshTokens).values({
    tokenHash: hashToken(generateOpaqueToken()),
    userId,
    client: 'mobile',
    familyId,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  const issued = await harness.runtime.accessTokens.issue(
    { userId, sessionId: familyId },
    harness.runtime.now(),
  );
  return { ...MOBILE, authorization: `Bearer ${issued.token}` };
}

/** Group D: 5 per 15 minutes per user. */
const deleteLike = route({
  path: '/api/v1/test/group-d',
  method: 'POST',
  auth: 'required',
  params: noParams,
  query: noQuery,
  body: z.strictObject({ confirm: z.literal(true) }),
  limitGroup: 'D',
  handler: async ({ ctx }) => {
    await ctx.authorize('me.read');
    return json({ ok: true });
  },
});

/** Group I with optional authentication (invite preview shape). */
const previewLike = route({
  path: '/api/v1/test/group-i',
  method: 'GET',
  auth: 'optional',
  params: noParams,
  query: noQuery,
  body: null,
  limitGroup: 'I',
  handler: () => json({ ok: true }),
});

/** A read without a group (`rateLimit: null` in the registry). */
const unlimited = route({
  path: '/api/v1/test/no-group',
  method: 'GET',
  auth: 'none',
  params: noParams,
  query: noQuery,
  body: null,
  limitGroup: null,
  handler: () => json({ ok: true }),
});

describe('route() applies the endpoint group', () => {
  it('answers the request after the group maximum with 429 and Retry-After', async () => {
    const headers = { ...(await signedIn()), ...fromIp() };
    const max = RATE_LIMIT_GROUPS.D.max;
    for (let index = 0; index < max; index += 1) {
      const response = await call(deleteLike, { method: 'POST', headers, json: { confirm: true } });
      expect(response.status).toBe(200);
    }
    const blocked = await call(deleteLike, { method: 'POST', headers, json: { confirm: true } });
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    await expectProblem(blocked, 429, 'rate_limited');
  });

  it('counts per user: another user and other addresses do not share the budget', async () => {
    const first = await signedIn();
    for (let index = 0; index < RATE_LIMIT_GROUPS.D.max; index += 1) {
      await call(deleteLike, {
        method: 'POST',
        headers: { ...first, ...fromIp() },
        json: { confirm: true },
      });
    }
    await expectProblem(
      await call(deleteLike, {
        method: 'POST',
        headers: { ...first, ...fromIp() },
        json: { confirm: true },
      }),
      429,
      'rate_limited',
    );
    const second = await signedIn();
    const response = await call(deleteLike, {
      method: 'POST',
      headers: { ...second, ...fromIp() },
      json: { confirm: true },
    });
    expect(response.status).toBe(200);
  });

  it('charges after validation: rejected bodies consume nothing', async () => {
    const headers = { ...(await signedIn()), ...fromIp() };
    for (let index = 0; index < 10; index += 1) {
      await expectProblem(
        await call(deleteLike, { method: 'POST', headers, json: { confirm: false } }),
        400,
        'validation_failed',
      );
    }
    const response = await call(deleteLike, { method: 'POST', headers, json: { confirm: true } });
    expect(response.status).toBe(200);
  });

  it('counts anonymous callers of a user+ip group by address', async () => {
    const ip = '198.51.100.77';
    for (let index = 0; index < RATE_LIMIT_GROUPS.I.max; index += 1) {
      expect((await call(previewLike, { headers: { ...MOBILE, ...fromIp(ip) } })).status).toBe(200);
    }
    await expectProblem(
      await call(previewLike, { headers: { ...MOBILE, ...fromIp(ip) } }),
      429,
      'rate_limited',
    );
    // A signed-in caller from the same address shares the address counter (user + IP).
    await expectProblem(
      await call(previewLike, { headers: { ...(await signedIn()), ...fromIp(ip) } }),
      429,
      'rate_limited',
    );
    expect((await call(previewLike, { headers: { ...MOBILE, ...fromIp() } })).status).toBe(200);
  });

  it('charges nothing for routes without a group', async () => {
    for (let index = 0; index < 3; index += 1) {
      expect((await call(unlimited, { headers: { ...MOBILE, ...fromIp() } })).status).toBe(200);
    }
    expect(await database.client.db.select().from(rateLimitBuckets)).toEqual([]);
  });
});

describe('bucket keys', () => {
  const hash = (value: string) => harness.runtime.keyedHash('rate-limit', value);

  it('keys a user group by the hashed user id only', () => {
    const userId = randomUUID();
    for (const group of ['G', 'O', 'C', 'D'] as const) {
      expect(RATE_LIMIT_GROUPS[group].key).toBe('user');
      expect(groupLimitKeys(harness.runtime, group, { userId, ipSubject: '203.0.113.9' })).toEqual([
        `group:${group}:user:${hash(userId)}`,
      ]);
    }
  });

  it('keys a user+ip group by the hashed user id and the hashed address', () => {
    const userId = randomUUID();
    expect(RATE_LIMIT_GROUPS.I.key).toBe('user+ip');
    expect(groupLimitKeys(harness.runtime, 'I', { userId, ipSubject: '203.0.113.9' })).toEqual([
      `group:I:user:${hash(userId)}`,
      `group:I:ip:${hash('203.0.113.9')}`,
    ]);
  });

  it('counts an anonymous caller by address, and only where the group allows it', () => {
    expect(groupLimitKeys(harness.runtime, 'I', { userId: null, ipSubject: 'unknown' })).toEqual([
      `group:I:ip:${hash('unknown')}`,
    ]);
    expect(() =>
      groupLimitKeys(harness.runtime, 'G', { userId: null, ipSubject: 'unknown' }),
    ).toThrow(TypeError);
  });

  it('never puts a raw user id or address into a key', () => {
    const userId = randomUUID();
    const keys = groupLimitKeys(harness.runtime, 'I', { userId, ipSubject: '203.0.113.9' });
    expect(keys.join(' ')).not.toContain(userId);
    expect(keys.join(' ')).not.toContain('203.0.113.9');
  });
});

describe('construction guards', () => {
  const base = {
    path: '/api/v1/test/guard',
    method: 'POST',
    params: noParams,
    query: noQuery,
    body: z.strictObject({}),
    handler: () => json({}),
  } as const;

  it('refuses the auth-owned groups A and R', () => {
    expect(() => route({ ...base, auth: 'required', limitGroup: 'A' })).toThrow(TypeError);
    expect(() => route({ ...base, auth: 'none', limitGroup: 'R' })).toThrow(TypeError);
  });

  it('refuses a user-keyed group on a route without required authentication', () => {
    expect(() => route({ ...base, auth: 'none', limitGroup: 'D' })).toThrow(TypeError);
    expect(() => route({ ...base, auth: 'optional', limitGroup: 'G' })).toThrow(TypeError);
    expect(() => route({ ...base, auth: 'optional', limitGroup: 'I' })).not.toThrow();
  });

  it('refuses the auth group and an endpoint group together', () => {
    expect(() =>
      route({ ...base, auth: 'none', rateLimit: { group: 'auth' }, limitGroup: 'I' }),
    ).toThrow(TypeError);
  });
});
