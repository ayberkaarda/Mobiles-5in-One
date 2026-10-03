import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { type IncomingHttpHeaders, request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { hashToken } from '@kadro/auth';
import { districts, teamInvites, teamMembers, teams, users } from '@kadro/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as loginRoute } from '../../app/api/v1/auth/login/route';
import { POST as createInviteRoute } from '../../app/api/v1/teams/[id]/invites/route';
import { POST as createTeamRoute } from '../../app/api/v1/teams/route';
import {
  type AuthHarness,
  createUser,
  mobile,
  mobileLogin,
  post,
  setupAuthHarness,
} from '../auth/support';
import { BUILD_PRESENT, freePort } from '../security/support/server';
import { createMigratedDatabase, type TestDatabase } from '../support/db';
import { TEST_EDGE_PROXY, TEST_WEB_ORIGIN, testEnvSource } from '../support/env';
import { createRoleLogins, type RoleLogins } from '../support/jobs';
import { prerequisite } from '../support/prerequisite';

/**
 * Host-header, forwarded-header and open-redirect attacks against the production build
 * (`next start`) on a migrated database (threat model T-PLT-15/16, ADR-0027, ADR-0040, ADR-0045,
 * ADR-0055, ADR-0058). The attacker controls the request line and every header: a foreign
 * `Host`, `X-Forwarded-Host` / `-Proto` / `-Port`, `Forwarded` and look-alike headers, and paths
 * shaped like protocol-relative or backslash URLs. No response may carry the attacker's host in a
 * `Location`, any other header, a link, a canonical / Open Graph URL, the robots sitemap line, a
 * sitemap entry or the invite page's app argument: absolute URLs come only from `WEB_ORIGIN`.
 */

const ENABLED = prerequisite(
  BUILD_PRESENT,
  'edge-host-header.test',
  'apps/web/.next/BUILD_ID is missing, run `pnpm build` first',
);

const APP_DIR = fileURLToPath(new URL('../../', import.meta.url));
const NEXT_BIN = fileURLToPath(new URL('../../node_modules/next/dist/bin/next', import.meta.url));
const EVIL = 'evil.example';
const EVIL_PATTERN = /evil\.example/i;
const STORE_ID = '1234567890';
const run = randomBytes(4).toString('hex');
const liveCode = randomBytes(16).toString('base64url');
const unknownCode = randomBytes(16).toString('base64url');
const ilSlug = `saldiri-il-${run}`;
const ilceSlug = `saldiri-ilce-${run}`;

let database: TestDatabase | undefined;
let logins: RoleLogins | undefined;
let child: ChildProcess | undefined;
let base = '';
let output = '';

/** Spoofed header sets: each one alone must not change any absolute URL the server emits. */
const SPOOFS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'foreign Host': { host: EVIL },
  'X-Forwarded-Host + Proto': { 'x-forwarded-host': EVIL, 'x-forwarded-proto': 'https' },
  'X-Forwarded-Host with port, Proto http, Port': {
    'x-forwarded-host': `${EVIL}:8443`,
    'x-forwarded-proto': 'http',
    'x-forwarded-port': '8443',
  },
  'Forwarded and look-alike headers': {
    forwarded: `for=203.0.113.9;host=${EVIL};proto=https`,
    'x-original-host': EVIL,
    'x-host': EVIL,
    'x-forwarded-server': EVIL,
    'x-original-url': `https://${EVIL}/`,
    'x-rewrite-url': `https://${EVIL}/`,
  },
  'everything at once': {
    host: EVIL,
    'x-forwarded-host': EVIL,
    'x-forwarded-proto': 'https',
    forwarded: `host=${EVIL};proto=https`,
  },
};

/** Surfaces that build or link absolute URLs, or redirect. */
function surfaces(): string[] {
  return [
    '/',
    '/ozellikler',
    '/robots.txt',
    '/sitemap.xml',
    `/mac/${liveCode}`,
    `/mac/${unknownCode}`,
    '/mac/',
    '/e-posta-dogrula',
    '/sifre-sifirla',
    '/sifremi-unuttum',
    '/giris',
    '/hesap-silme',
    '/admin',
    '/admin/',
    '/admin/sahalar',
    '/admin/giris',
    `/eksik-var/${ilSlug}/${ilceSlug}`,
    '/saha/no-such-venue',
    '/api/v1/health',
    '/api/v1/teams',
  ];
}

/** Paths shaped to make a naive redirect or path join leave the origin. */
const REDIRECT_PATHS = [
  `//${EVIL}/`,
  `//${EVIL}`,
  `///${EVIL}/`,
  `/\\${EVIL}/`,
  `/%5C${EVIL}/`,
  `/%2F%2F${EVIL}/`,
  `/%09/${EVIL}/`,
  `/admin//${EVIL}/`,
  `/mac//${EVIL}/`,
  `/giris/?next=https://${EVIL}/`,
  `/giris?next=https://${EVIL}/&redirect=//${EVIL}/&returnTo=/%5C${EVIL}`,
  `/sifre-sifirla?next=//${EVIL}/&callbackUrl=https://${EVIL}/`,
  `/e-posta-dogrula?redirect_uri=https://${EVIL}/`,
  `/admin?next=https://${EVIL}/`,
  `/admin/giris?next=//${EVIL}/`,
];

interface RawResponse {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

let clientCounter = 0;

/** A distinct client address per request, so the invite lookups never share a rate-limit bucket. */
function clientAddress(): string {
  clientCounter += 1;
  return `198.51.100.${(clientCounter % 250) + 1}, ${TEST_EDGE_PROXY}`;
}

/** GET with the path and headers exactly as written (no client normalization). */
function rawGet(path: string, extra: Readonly<Record<string, string>> = {}): Promise<RawResponse> {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: hostname,
        port,
        path,
        method: 'GET',
        headers: { 'x-forwarded-for': clientAddress(), ...extra },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Every response header value, flattened. */
function headerValues(response: RawResponse): string[] {
  return Object.values(response.headers).flatMap((value) =>
    value === undefined ? [] : Array.isArray(value) ? value : [String(value)],
  );
}

/** A `Location` must stay on the configured origin, whatever form it is written in. */
function expectSameOriginLocation(response: RawResponse, label: string): void {
  const location = response.headers.location;
  if (location === undefined) {
    return;
  }
  // The attacker host may survive as a path segment of this origin (`/evil.example/`), never as
  // an authority: no scheme-relative or backslash prefix, and the resolved origin is ours.
  expect(location, label).not.toMatch(/^\s*(\/\/|\/\\|\\)/);
  expect(new URL(location, base).origin, `${label} → ${location}`).toBe(base);
}

/** Absolute URLs naming the test host must use exactly the configured origin (port, scheme). */
function expectOnlyConfiguredOrigin(body: string, label: string): void {
  for (const match of body.matchAll(/[a-z]*:?\/\/(?:127\.0\.0\.1|localhost)[:0-9]*/g)) {
    expect(match[0], label).toBe(base);
  }
}

/** The `href` of the page's canonical link, or an empty string. */
function canonicalOf(html: string): string {
  return /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1] ?? '';
}

async function seed(db: TestDatabase['client']['db']): Promise<void> {
  const [district] = await db
    .insert(districts)
    .values({
      il: 'Saldiri Ili',
      ilce: 'Saldiri Ilcesi',
      ilSlug,
      slug: ilceSlug,
      centroid: { lng: 29, lat: 41 },
    })
    .returning({ id: districts.id });
  const [owner] = await db
    .insert(users)
    .values({
      email: `saldiri-${run}@example.test`,
      displayName: `Kaptan ${run}`,
      emailVerifiedAt: new Date(),
    })
    .returning({ id: users.id });
  const [team] = await db
    .insert(teams)
    .values({
      name: `Hedef FK ${run}`,
      slug: `hedef-${run}`,
      districtId: district?.id ?? '',
      ownerId: owner?.id ?? '',
    })
    .returning({ id: teams.id });
  await db
    .insert(teamMembers)
    .values({ teamId: team?.id ?? '', userId: owner?.id ?? '', role: 'captain' });
  await db.insert(teamInvites).values({
    teamId: team?.id ?? '',
    codeHash: hashToken(liveCode),
    expiresAt: new Date(Date.now() + 86_400_000),
    maxUses: 50,
  });
}

describe.skipIf(!ENABLED)('host-header and redirect spoofing (production build)', () => {
  beforeAll(async () => {
    database = await createMigratedDatabase('web_attack_edge_host');
    logins = await createRoleLogins(database.url);
    await seed(database.client.db);
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    child = spawn(
      process.execPath,
      [NEXT_BIN, 'start', '--port', String(port), '-H', '127.0.0.1'],
      {
        cwd: APP_DIR,
        // Only the test configuration: no variable of the calling shell is inherited.
        env: {
          ...testEnvSource({
            WEB_ORIGIN: base,
            CORS_ALLOWED_ORIGINS: base,
            DATABASE_URL: logins.appUrl,
            APPLE_APP_STORE_ID: STORE_ID,
          }),
          NODE_ENV: 'production',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        const response = await fetch(`${base}/api/v1/health`);
        await response.arrayBuffer();
        if (response.ok) {
          break;
        }
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline || child.exitCode !== null) {
        throw new Error(`built server did not become ready\n${output}`);
      }
      await delay(250);
    }
  }, 180_000);

  afterAll(async () => {
    if (child !== undefined && child.exitCode === null) {
      const exited = new Promise((resolve) => child?.once('exit', resolve));
      child.kill();
      await exited;
    }
    await logins?.drop();
    await database?.dispose();
  });

  it('serves the baseline surfaces on the configured origin (control)', async () => {
    const robots = await rawGet('/robots.txt');
    expect(robots.status, output).toBe(200);
    expect(robots.body).toContain(`Sitemap: ${base}/sitemap.xml`);
    const invite = await rawGet(`/mac/${liveCode}`);
    expect(invite.status, output).toBe(200);
    expect(invite.body).toContain(`app-argument=${base}/mac/${liveCode}`);
    const home = await rawGet('/');
    expect(home.status).toBe(200);
    expect(canonicalOf(home.body)).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/?$/);
    expect(new URL(canonicalOf(home.body)).origin).toBe(base);
  });

  it('never reflects a spoofed host into headers, links, canonical, robots, sitemap or invite', async () => {
    for (const [spoofName, spoof] of Object.entries(SPOOFS)) {
      for (const path of surfaces()) {
        const label = `${spoofName} ${path}`;
        const response = await rawGet(path, spoof);
        expect(response.status, `${label}\n${output}`).toBeLessThan(500);
        expectSameOriginLocation(response, label);
        for (const value of headerValues(response)) {
          expect(value, label).not.toMatch(EVIL_PATTERN);
        }
        expect(response.body, label).not.toMatch(EVIL_PATTERN);
        expectOnlyConfiguredOrigin(response.body, label);
      }
      const robots = await rawGet('/robots.txt', spoof);
      expect(robots.body, spoofName).toContain(`Sitemap: ${base}/sitemap.xml`);
      const sitemap = await rawGet('/sitemap.xml', spoof);
      expect(sitemap.status, spoofName).toBe(200);
      const locations = [...sitemap.body.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1] ?? '');
      expect(locations.length, spoofName).toBeGreaterThanOrEqual(2);
      for (const loc of locations) {
        expect(new URL(loc).origin, spoofName).toBe(base);
      }
      const invite = await rawGet(`/mac/${liveCode}`, spoof);
      expect(invite.body, spoofName).toContain(`app-argument=${base}/mac/${liveCode}`);
      expect(invite.body, spoofName).toContain(`href="kadro://mac/${liveCode}"`);
      const home = await rawGet('/', spoof);
      expect(new URL(canonicalOf(home.body)).origin, spoofName).toBe(base);
    }
  }, 120_000);

  it('never redirects off the origin for protocol-relative, backslash or next-parameter paths', async () => {
    for (const path of REDIRECT_PATHS) {
      for (const [spoofName, spoof] of [['no spoof', {}], ...Object.entries(SPOOFS)] as const) {
        const label = `${spoofName} ${path}`;
        const response = await rawGet(path, spoof);
        expect(response.status, `${label}\n${output}`).toBeLessThan(500);
        expectSameOriginLocation(response, label);
        // Next.js pairs its slash-normalizing 308 with `Refresh: 0;url=<path>`: same rule.
        const refresh = response.headers.refresh;
        if (refresh !== undefined) {
          const target = /url=(.*)$/i.exec(String(refresh))?.[1] ?? '';
          expect(target, label).not.toMatch(/^\s*(\/\/|\/\\|\\)/);
          expect(new URL(target, base).origin, `${label} → ${String(refresh)}`).toBe(base);
        }
        // The attacker URL may sit inside the escaped flight data of the page; it must never
        // become a link, a form target, a resource or a meta refresh.
        expect(response.body, label).not.toMatch(
          /(href|src|action|formaction|content)="[^"]*evil\.example/i,
        );
        expect(response.body, label).not.toMatch(/<meta[^>]+http-equiv="refresh"/i);
      }
    }
  }, 120_000);

  it('follows every redirect chain of the admin and invite surfaces to the configured origin', async () => {
    for (const start of ['/admin', '/admin/', '/admin/sahalar', '/mac/', `//${EVIL}/admin`]) {
      let path = start;
      for (let hop = 0; hop < 5; hop += 1) {
        const response = await rawGet(path, SPOOFS['everything at once']);
        expectSameOriginLocation(response, `${start} hop ${hop}`);
        const location = response.headers.location;
        if (location === undefined || response.status < 300 || response.status >= 400) {
          break;
        }
        const next = new URL(location, base);
        path = `${next.pathname}${next.search}`;
      }
    }
  });
});

describe('invite links built by the API under a spoofed host (route level)', () => {
  let auth: AuthHarness | undefined;

  beforeAll(async () => {
    auth = await setupAuthHarness('web_attack_edge_invite_url', { RATE_LIMIT_AUTH_MAX: '100' });
  });

  afterAll(async () => {
    await auth?.database.dispose();
  });

  it('builds the invite URL from WEB_ORIGIN, never from the request URL or forwarded headers', async () => {
    const harness = auth as AuthHarness;
    const [district] = await harness.database.client.db
      .insert(districts)
      .values({
        il: 'Davet Ili',
        ilce: 'Davet Ilcesi',
        ilSlug: `davet-${run}`,
        slug: `davet-ilce-${run}`,
        centroid: { lng: 29, lat: 41 },
      })
      .returning({ id: districts.id });
    const captain = await createUser(harness);
    const session = await mobileLogin(loginRoute, captain.email, captain.password);
    const bearer = { authorization: `Bearer ${session.tokens.accessToken}` };
    const created = await post(
      createTeamRoute,
      mobile(undefined, bearer),
      { name: `Davet FK ${run}`, districtId: district?.id ?? '' },
      '/api/v1/teams',
    );
    const createdText = await created.text();
    expect(created.status, createdText).toBe(201);
    const teamId = (JSON.parse(createdText) as { id: string }).id;
    for (const [spoofName, spoof] of Object.entries(SPOOFS)) {
      // The request URL itself is what Next.js derives from a hostile Host header.
      const request = new Request(`https://${EVIL}/api/v1/teams/${teamId}/invites`, {
        method: 'POST',
        headers: { ...mobile(undefined, bearer), ...spoof, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const response = await createInviteRoute(request, {
        params: Promise.resolve({ id: teamId }),
      });
      const text = await response.text();
      expect(response.status, `${spoofName} ${text}`).toBe(201);
      expect(text, spoofName).not.toMatch(EVIL_PATTERN);
      const body = JSON.parse(text) as { url: string; code: string };
      expect(body.url, spoofName).toBe(`${TEST_WEB_ORIGIN}/mac/${body.code}`);
      for (const [, value] of response.headers) {
        expect(value, spoofName).not.toMatch(EVIL_PATTERN);
      }
    }
  });
});
