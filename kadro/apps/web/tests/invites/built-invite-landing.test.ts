import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { hashToken } from '@kadro/auth';
import { RATE_LIMIT_GROUPS } from '@kadro/contracts';
import { districts, teamInvites, teamMembers, teams, users } from '@kadro/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BUILD_PRESENT, freePort } from '../security/support/server';
import { createMigratedDatabase, type TestDatabase } from '../support/db';
import { testEnvSource } from '../support/env';
import { createRoleLogins, type RoleLogins } from '../support/jobs';
import { prerequisite } from '../support/prerequisite';

/**
 * Invite landing `/mac/<code>` and the verified app link files against the production build
 * (`next start`) and a migrated database read through the production web role (ADR-0034,
 * ADR-0045, ADR-0055, ADR-0058). Two servers share the database: one with the store and app
 * link configuration, one without it (and with its own rate-limit key space).
 */

const ENABLED = prerequisite(
  BUILD_PRESENT,
  'built-invite-landing.test',
  'apps/web/.next/BUILD_ID is missing, run `pnpm build` first',
);

const APP_DIR = fileURLToPath(new URL('../../', import.meta.url));
const NEXT_BIN = fileURLToPath(new URL('../../node_modules/next/dist/bin/next', import.meta.url));
const DAY_MS = 86_400_000;
const HOSTILE = '<img src=x onerror=alert(1)>';

const TEAM_ID = 'ABCDE12345';
const STORE_ID = '1234567890';
const FINGERPRINT = Array.from({ length: 32 }, () => 'AB').join(':');

const run = randomBytes(4).toString('hex');
const teamName = `Deneme FK ${run} ${HOSTILE}`;
const captainName = `Deneme Kaptan ${run}`;
const captainEmail = `deneme-${run}@example.test`;

/** Codes are created at run time like the API does (128 bits, base64url). */
function newCode(): string {
  return randomBytes(16).toString('base64url');
}

const codes = {
  live: newCode(),
  expired: newCode(),
  exhausted: newCode(),
  unknown: newCode(),
};

let database: TestDatabase | undefined;
let logins: RoleLogins | undefined;
const servers: { child: ChildProcess; base: string; output: string }[] = [];
let configured = '';
let bare = '';

async function seed(db: TestDatabase['client']['db']): Promise<void> {
  const now = Date.now();
  const [district] = await db
    .insert(districts)
    .values({
      il: 'Deneme İli',
      ilce: 'Deneme İlçesi',
      ilSlug: `il-${run}`,
      slug: `ilce-${run}`,
      centroid: { lng: 29, lat: 41 },
    })
    .returning({ id: districts.id });
  const [owner] = await db
    .insert(users)
    .values({ email: captainEmail, displayName: captainName, emailVerifiedAt: new Date() })
    .returning({ id: users.id });
  const [team] = await db
    .insert(teams)
    .values({
      name: teamName,
      slug: `deneme-${run}`,
      districtId: district?.id ?? '',
      ownerId: owner?.id ?? '',
    })
    .returning({ id: teams.id });
  const teamId = team?.id ?? '';
  await db.insert(teamMembers).values({ teamId, userId: owner?.id ?? '', role: 'captain' });
  await db.insert(teamInvites).values([
    { teamId, codeHash: hashToken(codes.live), expiresAt: new Date(now + DAY_MS), maxUses: 20 },
    { teamId, codeHash: hashToken(codes.expired), expiresAt: new Date(now - 1000), maxUses: 20 },
    {
      teamId,
      codeHash: hashToken(codes.exhausted),
      expiresAt: new Date(now + DAY_MS),
      maxUses: 1,
      uses: 1,
    },
  ]);
}

async function startServer(overrides: Readonly<Record<string, string>>): Promise<string> {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [NEXT_BIN, 'start', '--port', String(port), '-H', '127.0.0.1'],
    {
      cwd: APP_DIR,
      // Only the test configuration: no variable of the calling shell is inherited.
      env: {
        ...testEnvSource({
          WEB_ORIGIN: base,
          CORS_ALLOWED_ORIGINS: base,
          DATABASE_URL: logins?.appUrl ?? '',
          ...overrides,
        }),
        NODE_ENV: 'production',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  const server = { child, base, output: '' };
  servers.push(server);
  child.stdout?.on('data', (chunk: Buffer) => {
    server.output += chunk.toString('utf8');
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    server.output += chunk.toString('utf8');
  });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const response = await fetch(`${base}/api/v1/health`);
      await response.arrayBuffer();
      if (response.ok) {
        return base;
      }
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline || child.exitCode !== null) {
      throw new Error(`built server did not become ready\n${server.output}`);
    }
    await delay(250);
  }
}

function output(): string {
  return servers.map((server) => server.output).join('\n');
}

async function get(base: string, path: string): Promise<{ response: Response; html: string }> {
  const response = await fetch(`${base}${path}`, { redirect: 'manual' });
  return { response, html: await response.text() };
}

function nonceOf(response: Response): string {
  const csp = response.headers.get('content-security-policy') ?? '';
  return /script-src 'self' 'nonce-([A-Za-z0-9+/=]+)' 'strict-dynamic'/.exec(csp)?.[1] ?? '';
}

function expectNoncedScripts(response: Response, html: string): void {
  const nonce = nonceOf(response);
  expect(nonce).not.toBe('');
  const tags = html.match(/<script\b[^>]*>/g) ?? [];
  expect(tags.length).toBeGreaterThan(0);
  for (const tag of tags) {
    expect(tag).toContain(`nonce="${nonce}"`);
  }
}

/** The invite page headers: noindex, no referrer, never stored. */
function expectInviteHeaders(response: Response): void {
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  const cacheControl = response.headers.get('cache-control') ?? '';
  expect(cacheControl).toMatch(/(^|, )no-store(,|$)/);
  expect(cacheControl).not.toMatch(/public|s-maxage/);
}

/** `name` and `content` of every `<meta name=… content=…>` element. */
function metas(html: string): { name: string; content: string }[] {
  return [...html.matchAll(/<meta name="([^"]+)" content="([^"]*)"/g)].map((match) => ({
    name: match[1] ?? '',
    content: match[2] ?? '',
  }));
}

function metaContent(html: string, name: string): string | undefined {
  return metas(html).find((meta) => meta.name === name)?.content;
}

/**
 * A 404 body without the per-response values: the nonce, the requested code itself and the
 * streamed not-found marker of the flight payload, whose position depends only on when the page
 * stopped rendering (a malformed code stops before the lookup).
 */
function normalized(html: string, response: Response, code: string): string {
  return html
    .replaceAll(nonceOf(response), 'NONCE')
    .replaceAll(code, 'CODE')
    .replace(/\d+:E\{\\"digest\\":\\"NEXT_HTTP_ERROR_FALLBACK;404\\"\}\\n/g, '');
}

describe.skipIf(!ENABLED)('invite landing and app link files (production build)', () => {
  beforeAll(async () => {
    database = await createMigratedDatabase('web_invite_built');
    logins = await createRoleLogins(database.url);
    await seed(database.client.db);
    configured = await startServer({
      APPLE_TEAM_ID: TEAM_ID,
      APPLE_APP_STORE_ID: STORE_ID,
      ANDROID_CERT_SHA256_FINGERPRINTS: FINGERPRINT,
    });
    // A different hash secret gives this server its own rate-limit buckets in the shared table.
    bare = await startServer({ HASH_SECRET: 'C'.repeat(43) });
  }, 180_000);

  afterAll(async () => {
    for (const { child } of servers) {
      if (child.exitCode === null) {
        const exited = new Promise((resolve) => child.once('exit', resolve));
        child.kill();
        await exited;
      }
    }
    await logins?.drop();
    await database?.dispose();
  });

  it('shows the team summary of a live invite with the nonce and the invite headers', async () => {
    const { response, html } = await get(configured, `/mac/${codes.live}`);
    expect(response.status, output()).toBe(200);
    expectInviteHeaders(response);
    expectNoncedScripts(response, html);
    expect(metaContent(html, 'robots')).toBe('noindex, nofollow');
    expect(metaContent(html, 'referrer')).toBe('no-referrer');
    expect(html).not.toMatch(/<link rel="canonical"/);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Deneme İlçesi, Deneme İli');
    expect(html).toMatch(/>1<[^]{0,200}oyuncu/);
    // The hostile team name is text, never markup.
    expect(html).not.toContain(HOSTILE);
    expect(html).toContain(`Deneme FK ${run} &lt;img src=x onerror=alert(1)&gt;`);
    // The title names no team, so history entries and link previews show nothing about it.
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
    expect(title).toBe('Takım daveti · Kadro');
    for (const meta of metas(html)) {
      expect(meta.content, meta.name).not.toContain(`Deneme FK ${run}`);
    }
    // No person, email or third-party resource.
    expect(html).not.toContain(captainName);
    expect(html).not.toContain(captainEmail);
    expect(html).not.toMatch(/<(img|iframe)\b[^>]*src="https?:/);
    expect(html).not.toMatch(/<link\b[^>]*href="https?:\/\/(?!127\.0\.0\.1)/);
  });

  it('links the app, the configured stores and the Smart App Banner', async () => {
    const { html } = await get(configured, `/mac/${codes.live}`);
    expect(html).toContain(`href="kadro://mac/${codes.live}"`);
    expect(html).toContain(`href="https://apps.apple.com/tr/app/id${STORE_ID}"`);
    expect(html).toContain('href="https://play.google.com/store/apps/details?id=app.kadro.mobile"');
    expect(metaContent(html, 'apple-itunes-app')).toBe(
      `app-id=${STORE_ID}, app-argument=${configured}/mac/${codes.live}`,
    );
  });

  it('shows store placeholders and no banner without configuration', async () => {
    const { response, html } = await get(bare, `/mac/${codes.live}`);
    expect(response.status, output()).toBe(200);
    expect(html).toContain('Yakında');
    expect(html).not.toContain('apps.apple.com');
    expect(html).not.toContain('play.google.com');
    expect(metaContent(html, 'apple-itunes-app')).toBeUndefined();
    expect(html).toContain(`href="kadro://mac/${codes.live}"`);
  });

  it('answers the same 404 for unknown, expired, exhausted and malformed codes', async () => {
    const bodies: string[] = [];
    for (const code of [codes.unknown, codes.expired, codes.exhausted, 'kisa', `${codes.live}x`]) {
      const { response, html } = await get(configured, `/mac/${code}`);
      expect(response.status, code).toBe(404);
      expectInviteHeaders(response);
      expectNoncedScripts(response, html);
      expect(metaContent(html, 'robots'), code).toMatch(/noindex/);
      expect(html, code).not.toContain(`Deneme FK ${run}`);
      bodies.push(normalized(html, response, code));
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it('serves apple-app-site-association as JSON without a redirect', async () => {
    const response = await fetch(`${configured}/.well-known/apple-app-site-association`, {
      redirect: 'manual',
    });
    expect(response.status, output()).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(await response.json()).toEqual({
      applinks: {
        details: [
          {
            appIDs: [`${TEAM_ID}.app.kadro.mobile`],
            components: [
              { '/': '/mac/*' },
              { '/': '/saha/*' },
              { '/': '/eksik-var/*' },
              { '/': '/e-posta-dogrula' },
              { '/': '/sifre-sifirla' },
            ],
          },
        ],
      },
    });
  });

  it('serves assetlinks.json as JSON without a redirect', async () => {
    const response = await fetch(`${configured}/.well-known/assetlinks.json`, {
      redirect: 'manual',
    });
    expect(response.status, output()).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'app.kadro.mobile',
          sha256_cert_fingerprints: [FINGERPRINT],
        },
      },
    ]);
  });

  it('serves neither file without configuration (404, never a placeholder app)', async () => {
    for (const path of [
      '/.well-known/apple-app-site-association',
      '/.well-known/assetlinks.json',
    ]) {
      const response = await fetch(`${bare}${path}`, { redirect: 'manual' });
      expect(response.status, path).toBe(404);
      expect(await response.text(), path).not.toMatch(/applinks|android_app/);
    }
  });

  it('charges each lookup once to rate limit group I and then shows no team', async () => {
    // Earlier tests charged this server's address bucket five times: two lookups of the live
    // code and the unknown, expired and exhausted codes. Malformed codes are refused without a
    // lookup. Metadata and page share one lookup per request, so 15 more requests pass.
    const max = RATE_LIMIT_GROUPS.I.max;
    let passed = 0;
    let limited: string | undefined;
    for (let attempt = 0; attempt <= max && limited === undefined; attempt += 1) {
      const { response, html } = await get(configured, `/mac/${codes.live}`);
      expect(response.status).toBe(200);
      if (html.includes(`kadro://mac/${codes.live}`)) {
        passed += 1;
      } else {
        limited = html;
      }
    }
    expect(passed, output()).toBe(max - 5);
    expect(limited).toContain('çok fazla davet bağlantısı açıldı');
    expect(limited).not.toContain(`Deneme FK ${run}`);
    expect(metaContent(limited ?? '', 'apple-itunes-app')).toBeUndefined();
  }, 60_000);
});
