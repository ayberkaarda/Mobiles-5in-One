import { randomBytes } from 'node:crypto';

import { districts, refreshTokens, teams, users } from '@kadro/db';
import { and, eq, isNull } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as logoutRoute } from '../../app/api/v1/auth/logout/route';
import { POST as loginRoute } from '../../app/api/v1/auth/login/route';
import { POST as refreshRoute } from '../../app/api/v1/auth/refresh/route';
import { DELETE as deleteMe, GET as meRoute, PATCH as updateMe } from '../../app/api/v1/me/route';
import { POST as createTeamRoute } from '../../app/api/v1/teams/route';
import { type RouteHandler } from '../../lib/server/http';
import { handleProxyRequest } from '../../lib/server/proxy-handler';
import {
  type AuthHarness,
  createUser,
  parseSetCookies,
  post,
  setupAuthHarness,
  uniqueIp,
  web,
} from '../auth/support';
import { TEST_EDGE_PROXY, TEST_WEB_ORIGIN, testEnv } from '../support/env';
import { call, expectProblem } from '../support/http';
import { concretePath, dynamicSegments, loadRoutes } from './support';

/**
 * CSRF against the cookie-authenticated web client (threat model T-AUTH-09, security checklist
 * item 7, ADR-0014). The attacker is a cross-site page that can make the victim's browser send
 * the session cookie but can neither read the double-submit CSRF cookie nor add custom headers
 * without a CORS preflight. Every cookie-authenticated mutation must therefore fail without the
 * matching `x-csrf-token`: missing, mismatched, empty, taken from another session (also the
 * attacker's own), sent without the cookie, or hidden behind a method-override header. A browser
 * form (no `x-kadro-client`) and a request posing as the mobile client are refused too. GET
 * routes, which skip the CSRF check by design, must have no side effects: the whole database is
 * fingerprinted before and after a sweep over every GET route of the registry.
 */

let auth: AuthHarness;
const db = () => auth.database.client.db;
const EVIL_ORIGIN = 'https://evil.example';
/** Fetch Metadata and Origin a browser attaches to a cross-site request. */
const CROSS_SITE = {
  origin: EVIL_ORIGIN,
  'sec-fetch-site': 'cross-site',
  'sec-fetch-mode': 'cors',
  'sec-fetch-dest': 'empty',
};

beforeAll(async () => {
  auth = await setupAuthHarness('web_attack_edge_csrf', { RATE_LIMIT_AUTH_MAX: '100' });
});

afterAll(async () => {
  await auth.database.dispose();
});

interface Browser {
  readonly userId: string;
  readonly password: string;
  readonly session: string;
  readonly csrf: string;
}

async function signIn(): Promise<Browser> {
  const user = await createUser(auth, { displayName: 'Kurban Oyuncu' });
  const response = await post(loginRoute, web(), { email: user.email, password: user.password });
  expect(response.status).toBe(200);
  const cookies = parseSetCookies(response);
  return {
    userId: user.id,
    password: user.password,
    session: cookies.get(auth.harness.env.SESSION_COOKIE_NAME)?.value ?? '',
    csrf: cookies.get(auth.harness.env.CSRF_COOKIE_NAME)?.value ?? '',
  };
}

/** Headers of a browser request: the cookies it would attach plus any attacker-chosen headers. */
function headers(
  cookies: { session?: string; csrf?: string },
  extra: Record<string, string> = {},
  client: 'web' | 'mobile' | null = 'web',
): Record<string, string> {
  const parts: string[] = [];
  if (cookies.session !== undefined) {
    parts.push(`${auth.harness.env.SESSION_COOKIE_NAME}=${cookies.session}`);
  }
  if (cookies.csrf !== undefined) {
    parts.push(`${auth.harness.env.CSRF_COOKIE_NAME}=${cookies.csrf}`);
  }
  const base: Record<string, string> = {
    'x-forwarded-for': `${uniqueIp()}, ${TEST_EDGE_PROXY}`,
    ...(client === null ? {} : { 'x-kadro-client': client }),
  };
  return { ...base, ...(parts.length > 0 ? { cookie: parts.join('; ') } : {}), ...extra };
}

const rename = (requestHeaders: Record<string, string>, displayName = 'Ele Gecirildi') =>
  call(updateMe, {
    method: 'PATCH',
    path: '/api/v1/me',
    headers: requestHeaders,
    json: { displayName },
  });

async function displayName(userId: string): Promise<string | undefined> {
  const [row] = await db()
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId));
  return row?.displayName;
}

async function liveSessions(userId: string): Promise<number> {
  const rows = await db()
    .select({ id: refreshTokens.id })
    .from(refreshTokens)
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  return rows.length;
}

/** The forged variants of one victim request; each must be refused with 403 `csrf_failed`. */
function forgeries(victim: Browser, attacker: Browser): Record<string, Record<string, string>> {
  return {
    'no header': headers({ session: victim.session, csrf: victim.csrf }),
    'no header, cross-site metadata': headers(
      { session: victim.session, csrf: victim.csrf },
      CROSS_SITE,
    ),
    'empty header': headers({ session: victim.session, csrf: victim.csrf }, { 'x-csrf-token': '' }),
    'header differs from cookie': headers(
      { session: victim.session, csrf: victim.csrf },
      { 'x-csrf-token': `${victim.csrf}x` },
    ),
    'header without cookie': headers({ session: victim.session }, { 'x-csrf-token': victim.csrf }),
    'cookie and header of the attacker session': headers(
      { session: victim.session, csrf: attacker.csrf },
      { 'x-csrf-token': attacker.csrf },
    ),
    'plain-word pair chosen by the attacker': headers(
      { session: victim.session, csrf: 'not-a-real-csrf-token' },
      { 'x-csrf-token': 'not-a-real-csrf-token' },
    ),
    'method override to GET': headers(
      { session: victim.session, csrf: victim.csrf },
      { 'x-http-method-override': 'GET', 'x-method-override': 'GET' },
    ),
  };
}

describe('double-submit CSRF on cookie-authenticated mutations', () => {
  it('refuses every forged variant of PATCH me and changes nothing', async () => {
    const victim = await signIn();
    const attacker = await signIn();
    for (const [name, forged] of Object.entries(forgeries(victim, attacker))) {
      const response = await rename(forged);
      expect(response.status, name).toBe(403);
      await expectProblem(response, 403, 'csrf_failed');
    }
    expect(await displayName(victim.userId)).toBe('Kurban Oyuncu');
  });

  it('refuses a token from another session of the same account', async () => {
    const victim = await signIn();
    const [row] = await db()
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, victim.userId));
    const response = await post(loginRoute, web(), {
      email: row?.email ?? '',
      password: victim.password,
    });
    const other = parseSetCookies(response).get(auth.harness.env.CSRF_COOKIE_NAME)?.value ?? '';
    expect(other).not.toBe('');
    expect(other).not.toBe(victim.csrf);
    await expectProblem(
      await rename(headers({ session: victim.session, csrf: other }, { 'x-csrf-token': other })),
      403,
      'csrf_failed',
    );
    expect(await displayName(victim.userId)).toBe('Kurban Oyuncu');
  });

  it('refuses forged logout, refresh, account deletion and team creation', async () => {
    const victim = await signIn();
    const attacker = await signIn();
    const [district] = await db()
      .insert(districts)
      .values({
        il: 'Saldiri Ili',
        ilce: 'Saldiri Ilcesi',
        ilSlug: `saldiri-${randomBytes(3).toString('hex')}`,
        slug: `ilce-${randomBytes(3).toString('hex')}`,
        centroid: { lng: 29, lat: 41 },
      })
      .returning({ id: districts.id });
    const targets: {
      name: string;
      handler: RouteHandler;
      method: string;
      path: string;
      json: unknown;
    }[] = [
      {
        name: 'logout',
        handler: logoutRoute,
        method: 'POST',
        path: '/api/v1/auth/logout',
        json: {},
      },
      {
        name: 'refresh',
        handler: refreshRoute,
        method: 'POST',
        path: '/api/v1/auth/refresh',
        json: {},
      },
      {
        name: 'delete me',
        handler: deleteMe,
        method: 'DELETE',
        path: '/api/v1/me',
        json: { password: victim.password },
      },
      {
        name: 'create team',
        handler: createTeamRoute,
        method: 'POST',
        path: '/api/v1/teams',
        json: { name: 'Sahte Takim', districtId: district?.id ?? '' },
      },
    ];
    const sessionsBefore = await liveSessions(victim.userId);
    for (const target of targets) {
      for (const [name, forged] of Object.entries(forgeries(victim, attacker))) {
        const response = await call(target.handler, {
          method: target.method,
          path: target.path,
          headers: forged,
          json: target.json,
        });
        expect(response.status, `${target.name}: ${name}`).toBe(403);
        await expectProblem(response, 403, 'csrf_failed');
        expect(response.headers.getSetCookie(), `${target.name}: ${name}`).toEqual([]);
      }
    }
    expect(await liveSessions(victim.userId)).toBe(sessionsBefore);
    const [account] = await db().select().from(users).where(eq(users.id, victim.userId));
    expect(account?.deactivatedAt).toBeNull();
    expect(await db().select().from(teams).where(eq(teams.ownerId, victim.userId))).toEqual([]);
    // The victim's own session still works for a legitimate request.
    const own = await call(meRoute, {
      method: 'GET',
      path: '/api/v1/me',
      headers: headers({ session: victim.session, csrf: victim.csrf }),
    });
    expect(own.status).toBe(200);
  });

  it('accepts the same request only with the matching pair (control)', async () => {
    const victim = await signIn();
    const response = await rename(
      headers({ session: victim.session, csrf: victim.csrf }, { 'x-csrf-token': victim.csrf }),
      'Gercek Isim',
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await displayName(victim.userId)).toBe('Gercek Isim');
  });

  // Negative control: proves the harness reports a wrong expectation instead of passing
  // silently. The forged request is refused, so asserting 200 must fail.
  it.fails('negative control: a forged request is not accepted', async () => {
    const victim = await signIn();
    const response = await rename(headers({ session: victim.session, csrf: victim.csrf }));
    expect(response.status).toBe(200);
  });
});

describe('cross-site requests a browser can actually send', () => {
  it('refuses an HTML form post (no client header) and a request posing as the mobile app', async () => {
    const victim = await signIn();
    const cookies = { session: victim.session, csrf: victim.csrf };
    for (const contentType of [
      'application/x-www-form-urlencoded',
      'text/plain',
      'multipart/form-data; boundary=x',
    ]) {
      const response = await call(updateMe, {
        method: 'PATCH',
        path: '/api/v1/me',
        headers: headers(cookies, { ...CROSS_SITE, 'content-type': contentType }, null),
        body: 'displayName=Ele+Gecirildi',
      });
      await expectProblem(response, 400, 'validation_failed');
    }
    // `mobile` from a browser always carries Origin: refused before authentication.
    await expectProblem(
      await rename(headers(cookies, CROSS_SITE, 'mobile')),
      400,
      'validation_failed',
    );
    // Without Origin the mobile transport ignores the cookie: no credentials at all.
    await expectProblem(await rename(headers(cookies, {}, 'mobile')), 401, 'unauthenticated');
    expect(await displayName(victim.userId)).toBe('Kurban Oyuncu');
  });

  it('never lets a foreign origin preflight the CSRF header or read a credentialed answer', () => {
    const env = testEnv();
    for (const origin of [
      EVIL_ORIGIN,
      'null',
      `${TEST_WEB_ORIGIN}.evil.example`,
      'http://kadro.app',
    ]) {
      const preflight = handleProxyRequest(
        new NextRequest(`${TEST_WEB_ORIGIN}/api/v1/me`, {
          method: 'OPTIONS',
          headers: {
            origin,
            'access-control-request-method': 'PATCH',
            'access-control-request-headers': 'content-type, x-kadro-client, x-csrf-token',
          },
        }),
        env,
      );
      expect(preflight.headers.get('access-control-allow-origin'), origin).toBeNull();
      expect(preflight.headers.get('access-control-allow-headers'), origin).toBeNull();
      expect(preflight.headers.get('access-control-allow-credentials'), origin).toBeNull();
      const actual = handleProxyRequest(
        new NextRequest(`${TEST_WEB_ORIGIN}/api/v1/me`, { headers: { origin } }),
        env,
      );
      expect(actual.headers.get('access-control-allow-origin'), origin).toBeNull();
      expect(actual.headers.get('access-control-allow-credentials'), origin).toBeNull();
    }
  });

  it('decides on the token alone: Origin and Fetch Metadata are not consulted', async () => {
    // Characterization, not a finding: a cross-site page cannot obtain the token (previous test),
    // so the server's answer depends only on the pair. Recorded so a future Origin / Fetch
    // Metadata check shows up here as a deliberate behaviour change.
    const victim = await signIn();
    const response = await rename(
      headers(
        { session: victim.session, csrf: victim.csrf },
        { ...CROSS_SITE, 'x-csrf-token': victim.csrf },
      ),
      'Isim Iki',
    );
    expect(response.status).toBe(200);
  });
});

/** Fingerprint of every application table except the rate-limit counters. */
async function fingerprint(): Promise<Record<string, string>> {
  const client = new pg.Client({ connectionString: auth.database.url });
  await client.connect();
  try {
    const tables = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'rate_limit_buckets'
        order by table_name`,
    );
    const result: Record<string, string> = {};
    for (const { table_name: table } of tables.rows) {
      const name = client.escapeIdentifier(table);
      const row = await client.query<{ digest: string }>(
        `select count(*)::text || ':' || md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as digest from ${name} t`,
      );
      result[table] = row.rows[0]?.digest ?? '';
    }
    return result;
  } finally {
    await client.end();
  }
}

describe('GET routes have no side effects (CSRF-exempt by design)', () => {
  it('leaves every table unchanged after a signed-in sweep over all GET routes', async () => {
    const victim = await signIn();
    const routes = (await loadRoutes()).filter((entry) => entry.spec.method === 'GET');
    expect(routes.length).toBeGreaterThan(15);
    const before = await fingerprint();
    for (const entry of routes) {
      const params = Object.fromEntries(
        dynamicSegments(entry.spec.path).map((name) => [
          name,
          name === 'code'
            ? 'z'.repeat(22)
            : name === 'slug'
              ? 'no-such-venue'
              : '018f2c1e-0000-7000-8000-0000000000ab',
        ]),
      );
      const response = await call(entry.handler, {
        method: 'GET',
        path: concretePath(entry.spec.path, params),
        headers: headers({ session: victim.session, csrf: victim.csrf }, CROSS_SITE),
        params,
      });
      expect(response.status, entry.key).toBeLessThan(500);
    }
    expect(await fingerprint()).toEqual(before);
    // Sensitivity check: one real mutation does change the fingerprint.
    const renamed = await rename(
      headers({ session: victim.session, csrf: victim.csrf }, { 'x-csrf-token': victim.csrf }),
      'Iz Birakan',
    );
    expect(renamed.status).toBe(200);
    expect((await fingerprint()).users).not.toBe(before.users);
  });
});
