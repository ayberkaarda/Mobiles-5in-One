import { users } from '@kadro/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { POST as login } from '../../app/api/v1/auth/login/route';
import { POST as register } from '../../app/api/v1/auth/register/route';
import { GET as listVenues } from '../../app/api/v1/venues/route';
import { GET as listOpenCalls } from '../../app/api/v1/open-calls/route';
import {
  type AuthHarness,
  createUser,
  mobile,
  mobileLogin,
  newPassword,
  post,
  setupAuthHarness,
  uniqueEmail,
} from '../auth/support';
import { call } from '../support/http';

/**
 * Injection and payload-abuse probes against the real routes (threat model T-PLT-06/12/18,
 * T-MATCH-09): SQL metacharacters in credentials, search terms and cursors must be treated as data
 * (Drizzle parameterises every query), oversized and deeply nested bodies must be refused before a
 * handler runs, and no probe may ever surface a 5xx or a database error string. The user table is
 * checked intact after the SQL payloads.
 */

let auth: AuthHarness;

const SQLI_PAYLOADS = [
  "' OR '1'='1",
  "'; DROP TABLE users; --",
  "admin'--",
  "' UNION SELECT NULL,NULL--",
  '\\"; SELECT pg_sleep(5);--',
] as const;

function noSqlLeak(body: string): void {
  const lower = body.toLowerCase();
  expect(lower).not.toContain('syntax error');
  expect(lower).not.toContain('pg_');
  expect(lower).not.toMatch(/\bpostgres\b/);
  expect(body).not.toMatch(/\n\s+at\s+/); // no stack trace
}

async function userCount(): Promise<number> {
  const [row] = await auth.database.client.db
    .select({ count: sql<number>`count(*)::int` })
    .from(users);
  return row?.count ?? -1;
}

beforeAll(async () => {
  auth = await setupAuthHarness('web_attack_injection', { RATE_LIMIT_AUTH_MAX: '100' });
});

afterAll(async () => {
  await auth.database.dispose();
});

beforeEach(() => {
  auth.harness.setNow(new Date());
});

describe('SQL injection is handled as data (T-PLT-06)', () => {
  it('cannot authenticate or break the query through the credential fields', async () => {
    await createUser(auth);
    const before = await userCount();
    for (const payload of SQLI_PAYLOADS) {
      const viaEmail = await post(login, mobile(), { email: payload, password: payload });
      // A payload that is not a valid email is a 400; otherwise invalid credentials (401).
      expect([400, 401]).toContain(viaEmail.status);
      noSqlLeak(await viaEmail.text());

      const viaPassword = await post(login, mobile(), { email: uniqueEmail(), password: payload });
      expect([400, 401]).toContain(viaPassword.status);
      noSqlLeak(await viaPassword.text());
    }
    expect(await userCount()).toBe(before);
    // The table is intact: a fresh account can still be created and used.
    const fresh = await createUser(auth);
    expect((await mobileLogin(login, fresh.email, fresh.password)).tokens.accessToken.length)
      .toBeGreaterThan(0);
  });

  it('treats search terms and cursors on public lists as data', async () => {
    for (const payload of SQLI_PAYLOADS) {
      const search = encodeURIComponent(payload.slice(0, 40));
      const venues = await call(listVenues, {
        headers: mobile(),
        path: `/api/v1/venues?q=${search}`,
      });
      expect(venues.status).toBeLessThan(500);
      noSqlLeak(await venues.text());

      const calls = await call(listOpenCalls, {
        headers: mobile(),
        path: `/api/v1/open-calls?cursor=${search}`,
      });
      expect(calls.status).toBeLessThan(500);
      noSqlLeak(await calls.text());
    }
  });

  it('rejects a malformed pagination cursor with a client error', async () => {
    const response = await call(listVenues, {
      headers: mobile(),
      path: "/api/v1/venues?cursor=%27%20OR%201%3D1",
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
});

describe('CRLF / header injection in free-text fields', () => {
  it('does not fail or split the response on control characters', async () => {
    const response = await post(register, mobile(), {
      email: uniqueEmail(),
      password: newPassword(),
      displayName: 'Oyuncu\r\nSet-Cookie: injected=1',
    });
    expect(response.status).toBeLessThan(500);
    // The newline must not have split the response into an injected header.
    expect(response.headers.get('set-cookie') ?? '').not.toContain('injected');
    expect([...response.headers.keys()]).not.toContain('injected');
  });
});

describe('oversized and deeply nested bodies (T-PLT-12)', () => {
  it('refuses a body larger than the 1 MiB limit before parsing', async () => {
    const huge = 'a'.repeat(1_500_000);
    const response = await post(login, mobile(), { email: 'player@example.test', password: huge });
    expect([400, 413]).toContain(response.status);
  });

  it('refuses a deeply nested JSON body', async () => {
    let nested: unknown = 1;
    for (let depth = 0; depth < 2_000; depth += 1) {
      nested = [nested];
    }
    const response = await post(login, mobile(), {
      email: 'player@example.test',
      password: 'secret-value',
      extra: nested,
    });
    expect([400, 413]).toContain(response.status);
  });
});
