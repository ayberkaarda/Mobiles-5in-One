import { emailSchema, loginRequestSchema, verifyEmailRequestSchema } from '@kadro/contracts';
import { rateLimitBuckets } from '@kadro/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ApiError } from '../lib/server/errors';
import { json, route } from '../lib/server/http';
import { SlidingWindowLimiter } from '../lib/server/ratelimit';
import { noParams, noQuery } from '../lib/server/validate';
import { createMigratedDatabase, type TestDatabase } from './support/db';
import { TEST_EDGE_PROXY } from './support/env';
import { call, expectProblem, MOBILE } from './support/http';
import { installTestRuntime, type TestRuntime } from './support/runtime';

/**
 * Security checklist item 5 / threat model T-AUTH-01, T-AUTH-02: group A limits of 5 requests per
 * 15 minutes per IP and per email, progressive delay after 3 failures, 429 with Retry-After, and
 * no bypass through forged forwarding headers.
 */

const CORRECT_PASSWORD = `Ok-${'A'.repeat(12)}`;
let database: TestDatabase;
let harness: TestRuntime;

/** A login-shaped endpoint in rate-limit group A. */
const login = route({
  path: '/api/v1/test/auth/login',
  method: 'POST',
  auth: 'none',
  params: noParams,
  query: noQuery,
  body: loginRequestSchema,
  rateLimit: { group: 'auth', email: (body) => body.email },
  handler: async ({ body, ctx }) => {
    if (body.password !== CORRECT_PASSWORD) {
      await ctx.authAttempts?.recordFailure();
      throw new ApiError('invalid_credentials');
    }
    await ctx.authAttempts?.recordSuccess();
    return json({ ok: true });
  },
});

/** A group A endpoint without an email (IP limit only). */
const verify = route({
  path: '/api/v1/test/auth/verify-email',
  method: 'POST',
  auth: 'none',
  params: noParams,
  query: noQuery,
  body: verifyEmailRequestSchema,
  rateLimit: { group: 'auth' },
  handler: () => json({ ok: true }),
});

let counter = 0;
function uniqueEmail(): string {
  counter += 1;
  return `player${counter}-${Date.now()}@example.test`;
}

let ipCounter = 0;
function uniqueIp(): string {
  ipCounter += 1;
  return `198.51.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

/** Headers as written by the edge proxy: client address, then the proxy itself. */
function fromClient(ip: string, extra: Record<string, string> = {}): Record<string, string> {
  return { ...MOBILE, 'x-forwarded-for': `${ip}, ${TEST_EDGE_PROXY}`, ...extra };
}

function attempt(headers: Record<string, string>, email: string, password = 'wrong-password') {
  return call(login, { method: 'POST', headers, json: { email, password } });
}

beforeAll(async () => {
  database = await createMigratedDatabase('web_ratelimit');
  harness = await installTestRuntime({ db: database.client.db });
});

afterAll(async () => {
  await database.dispose();
});

beforeEach(async () => {
  harness.sleeps.length = 0;
  harness.setNow(new Date());
  await database.client.db.delete(rateLimitBuckets);
});

describe('per-IP and per-email limits', () => {
  it('answers the 6th request in 15 minutes with 429 and Retry-After', async () => {
    const ip = uniqueIp();
    const email = uniqueEmail();
    for (let index = 0; index < 5; index += 1) {
      await expectProblem(await attempt(fromClient(ip), email), 401, 'invalid_credentials');
    }
    const sixth = await attempt(fromClient(ip), email);
    await expectProblem(sixth.clone(), 429, 'rate_limited');
    const retryAfter = Number(sixth.headers.get('retry-after'));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(15 * 60 + 60);
  });

  it('limits one email across many IPs', async () => {
    const email = uniqueEmail();
    for (let index = 0; index < 5; index += 1) {
      expect((await attempt(fromClient(uniqueIp()), email)).status).toBe(401);
    }
    await expectProblem(await attempt(fromClient(uniqueIp()), email), 429, 'rate_limited');
  });

  it('limits one IP across many emails', async () => {
    const ip = uniqueIp();
    for (let index = 0; index < 5; index += 1) {
      expect((await attempt(fromClient(ip), uniqueEmail())).status).toBe(401);
    }
    await expectProblem(await attempt(fromClient(ip), uniqueEmail()), 429, 'rate_limited');
  });

  it('counts the email case-insensitively', async () => {
    const email = uniqueEmail();
    for (let index = 0; index < 5; index += 1) {
      const variant = index % 2 === 0 ? email.toUpperCase() : ` ${email} `;
      expect((await attempt(fromClient(uniqueIp()), variant)).status).toBe(401);
    }
    const normalized = emailSchema.parse(email);
    await expectProblem(await attempt(fromClient(uniqueIp()), normalized), 429, 'rate_limited');
  });

  it('applies the IP limit to endpoints without an email', async () => {
    const ip = uniqueIp();
    const token = 'A'.repeat(43);
    for (let index = 0; index < 5; index += 1) {
      const response = await call(verify, {
        method: 'POST',
        headers: fromClient(ip),
        json: { token },
      });
      expect(response.status).toBe(200);
    }
    const blocked = await call(verify, {
      method: 'POST',
      headers: fromClient(ip),
      json: { token },
    });
    await expectProblem(blocked, 429, 'rate_limited');
  });

  it('admits requests again once the window has passed', async () => {
    const ip = uniqueIp();
    const email = uniqueEmail();
    for (let index = 0; index < 5; index += 1) {
      await attempt(fromClient(ip), email);
    }
    const blocked = await attempt(fromClient(ip), email);
    expect(blocked.status).toBe(429);
    harness.advance(Number(blocked.headers.get('retry-after')) * 1_000);
    expect((await attempt(fromClient(ip), email, CORRECT_PASSWORD)).status).toBe(200);
  });

  it('still blocks one second before Retry-After elapses', async () => {
    const ip = uniqueIp();
    const email = uniqueEmail();
    for (let index = 0; index < 5; index += 1) {
      await attempt(fromClient(ip), email);
    }
    const blocked = await attempt(fromClient(ip), email);
    harness.advance((Number(blocked.headers.get('retry-after')) - 1) * 1_000);
    expect((await attempt(fromClient(ip), email)).status).toBe(429);
  });

  it('admits exactly five of ten concurrent requests', async () => {
    const ip = uniqueIp();
    const email = uniqueEmail();
    const statuses = await Promise.all(
      Array.from({ length: 10 }, async () => (await attempt(fromClient(ip), email)).status),
    );
    expect(statuses.filter((status) => status === 401)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(5);
  });

  it('stores keyed hashes, never the email or address', async () => {
    const ip = uniqueIp();
    const email = uniqueEmail();
    await attempt(fromClient(ip), email);
    const rows = await database.client.db
      .select({ key: rateLimitBuckets.key })
      .from(rateLimitBuckets);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.key).toMatch(/^auth(-fail)?:(ip|email):[0-9a-f]{64}$/);
      expect(row.key).not.toContain(email);
      expect(row.key).not.toContain(ip);
    }
  });
});

describe('a rejected attempt consumes no quota (all-or-nothing)', () => {
  it('does not charge the email quota once the IP is exhausted', async () => {
    const attackerIp = uniqueIp();
    for (let index = 0; index < 5; index += 1) {
      await attempt(fromClient(attackerIp), uniqueEmail());
    }
    const victim = uniqueEmail();
    for (let index = 0; index < 5; index += 1) {
      await expectProblem(await attempt(fromClient(attackerIp), victim), 429, 'rate_limited');
    }
    // The victim's own quota is untouched: a sign-in from another address is still evaluated.
    expect((await attempt(fromClient(uniqueIp()), victim, CORRECT_PASSWORD)).status).toBe(200);
  });

  it('does not charge the IP quota once the email is exhausted', async () => {
    const victim = uniqueEmail();
    for (let index = 0; index < 5; index += 1) {
      await attempt(fromClient(uniqueIp()), victim);
    }
    const ip = uniqueIp();
    for (let index = 0; index < 5; index += 1) {
      await expectProblem(await attempt(fromClient(ip), victim), 429, 'rate_limited');
    }
    for (let index = 0; index < 5; index += 1) {
      expect((await attempt(fromClient(ip), uniqueEmail())).status).toBe(401);
    }
  });
});

describe('forged forwarding headers do not bypass the limit (T-AUTH-02)', () => {
  it('ignores addresses prepended to x-forwarded-for', async () => {
    const realIp = uniqueIp();
    for (let index = 0; index < 5; index += 1) {
      const forged = { 'x-forwarded-for': `${uniqueIp()}, ${realIp}, ${TEST_EDGE_PROXY}` };
      expect((await attempt({ ...MOBILE, ...forged }, uniqueEmail())).status).toBe(401);
    }
    const forged = { 'x-forwarded-for': `9.9.9.9, ${realIp}, ${TEST_EDGE_PROXY}` };
    await expectProblem(
      await attempt({ ...MOBILE, ...forged }, uniqueEmail()),
      429,
      'rate_limited',
    );
  });

  it('ignores x-real-ip, cf-connecting-ip, forwarded and true-client-ip', async () => {
    const realIp = uniqueIp();
    for (let index = 0; index < 6; index += 1) {
      const spoof = uniqueIp();
      const response = await attempt(
        fromClient(realIp, {
          'x-real-ip': spoof,
          'cf-connecting-ip': spoof,
          'true-client-ip': spoof,
          forwarded: `for=${spoof}`,
        }),
        uniqueEmail(),
      );
      expect(response.status).toBe(index < 5 ? 401 : 429);
    }
  });

  it('puts requests without a usable address into one shared bucket', async () => {
    for (let index = 0; index < 6; index += 1) {
      const response = await attempt({ ...MOBILE, 'x-real-ip': uniqueIp() }, uniqueEmail());
      expect(response.status).toBe(index < 5 ? 401 : 429);
    }
  });

  it('cannot spread IPv6 attempts over one /64', async () => {
    for (let index = 0; index < 6; index += 1) {
      const response = await attempt(
        fromClient(`2001:db8:77:1::${(index + 1).toString(16)}`),
        uniqueEmail(),
      );
      expect(response.status).toBe(index < 5 ? 401 : 429);
    }
  });
});

describe('missing client IP (ADR-0022)', () => {
  function warnings(): Record<string, unknown>[] {
    return harness.logLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((record) => record.msg === 'client ip missing');
  }

  it('counts client_ip_missing and logs a warning with the request id only', async () => {
    harness.logLines.length = 0;
    const before = harness.runtime.metrics.value('client_ip_missing');
    const spoof = uniqueIp();
    const response = await attempt({ ...MOBILE, 'x-real-ip': spoof }, uniqueEmail());
    expect(harness.runtime.metrics.value('client_ip_missing')).toBe(before + 1);
    const [warning] = warnings();
    expect(warning).toMatchObject({
      level: 40,
      metric: 'client_ip_missing',
      requestId: response.headers.get('x-request-id'),
      route: '/api/v1/test/auth/login',
    });
    const text = JSON.stringify(warning);
    expect(text).not.toContain(spoof);
    expect(text).not.toContain('example.test');
  });

  it('stays silent when the trusted header is present', async () => {
    harness.logLines.length = 0;
    const before = harness.runtime.metrics.value('client_ip_missing');
    await attempt(fromClient(uniqueIp()), uniqueEmail());
    expect(harness.runtime.metrics.value('client_ip_missing')).toBe(before);
    expect(warnings()).toEqual([]);
  });

  it('also fires for a malformed header', async () => {
    const before = harness.runtime.metrics.value('client_ip_missing');
    await attempt({ ...MOBILE, 'x-forwarded-for': 'not-an-address' }, uniqueEmail());
    expect(harness.runtime.metrics.value('client_ip_missing')).toBe(before + 1);
  });
});

describe('progressive delay after failures', () => {
  it('starts after 3 failures and grows by the configured step', async () => {
    const email = uniqueEmail();
    for (let index = 0; index < 5; index += 1) {
      await attempt(fromClient(uniqueIp()), email);
    }
    // Before attempts 1-3 there were 0, 1 and 2 failures; before 4 and 5 there were 3 and 4.
    expect(harness.sleeps).toEqual([500, 1_000]);
  });

  it('applies to the IP as well as to the email', async () => {
    const ip = uniqueIp();
    for (let index = 0; index < 4; index += 1) {
      await attempt(fromClient(ip), uniqueEmail());
    }
    expect(harness.sleeps).toEqual([500]);
  });

  it('clears the email failure history after a successful sign-in', async () => {
    const email = uniqueEmail();
    for (let index = 0; index < 3; index += 1) {
      await attempt(fromClient(uniqueIp()), email);
    }
    expect((await attempt(fromClient(uniqueIp()), email, CORRECT_PASSWORD)).status).toBe(200);
    harness.sleeps.length = 0;
    await attempt(fromClient(uniqueIp()), email);
    expect(harness.sleeps).toEqual([]);
  });
});

describe('SlidingWindowLimiter', () => {
  it('slides: buckets leave the window one by one', async () => {
    let now = new Date('2026-10-01T10:00:00Z');
    const limiter = new SlidingWindowLimiter(database.client.db, () => now);
    const rule = { max: 3, windowSeconds: 150 };
    const key = `test:${uniqueEmail()}`;
    expect((await limiter.hit(key, rule)).allowed).toBe(true);
    now = new Date(now.getTime() + 60_000);
    expect((await limiter.hit(key, rule)).allowed).toBe(true);
    expect((await limiter.hit(key, rule)).allowed).toBe(true);
    const blocked = await limiter.hit(key, rule);
    expect(blocked).toMatchObject({ allowed: false, count: 3 });
    // The first hit leaves the window first; Retry-After points at that moment.
    const retry = blocked.allowed ? 0 : blocked.retryAfterSeconds;
    expect(retry).toBeGreaterThan(60);
    expect(retry).toBeLessThanOrEqual(160);
    now = new Date(now.getTime() + retry * 1_000);
    expect(await limiter.hit(key, rule)).toMatchObject({ allowed: true, count: 3 });
  });

  it('deletes buckets that left the window', async () => {
    let now = new Date('2026-10-01T12:00:00Z');
    const limiter = new SlidingWindowLimiter(database.client.db, () => now);
    const key = `test:${uniqueEmail()}`;
    await limiter.hit(key, { max: 5, windowSeconds: 60 });
    now = new Date(now.getTime() + 10 * 60_000);
    await limiter.hit(key, { max: 5, windowSeconds: 60 });
    const rows = await database.client.db
      .select({ key: rateLimitBuckets.key })
      .from(rateLimitBuckets);
    expect(rows.filter((row) => row.key === key)).toHaveLength(1);
  });

  it('rejects rate-limit specs on authenticated routes', () => {
    expect(() =>
      route({
        path: '/api/v1/test/protected',
        method: 'POST',
        auth: 'required',
        params: noParams,
        query: noQuery,
        body: z.strictObject({}),
        rateLimit: { group: 'auth' },
        handler: () => json({}),
      }),
    ).toThrow(TypeError);
  });
});
