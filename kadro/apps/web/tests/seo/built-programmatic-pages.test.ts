import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { foldTr } from '@kadro/contracts';
import { districts, matches, openCalls, teams, users, venues } from '@kadro/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BUILD_PRESENT, freePort } from '../security/support/server';
import { createMigratedDatabase, type TestDatabase } from '../support/db';
import { testEnvSource } from '../support/env';
import { createRoleLogins, type RoleLogins } from '../support/jobs';
import { prerequisite } from '../support/prerequisite';

/**
 * Programmatic SEO pages against the production build (`next start`) and a migrated database
 * read through the production web role (ADR-0055, ADR-0057): per-request nonce on every script
 * including the JSON-LD data block, parseable structured data, canonical URLs, `noindex` on sample
 * venues and empty districts, 404 for private or unknown pages, the five-minute data cache, the
 * hard bound on expired calls and the sitemap. Fixture names are `[ÖRNEK]` or `Deneme` (test)
 * names; slugs are random per run because the data cache of the build lives on disk.
 */

const ENABLED = prerequisite(
  BUILD_PRESENT,
  'built-programmatic-pages.test',
  'apps/web/.next/BUILD_ID is missing, run `pnpm build` first',
);

const APP_DIR = fileURLToPath(new URL('../../', import.meta.url));
const NEXT_BIN = fileURLToPath(new URL('../../node_modules/next/dist/bin/next', import.meta.url));
const DAY_MS = 86_400_000;
const HOSTILE = '</script><script>alert(1)</script><!--';

let database: TestDatabase | undefined;
let logins: RoleLogins | undefined;
let child: ChildProcess | undefined;
let base = '';
let output = '';

const run = randomBytes(4).toString('hex');
const slugs = {
  il: `il-${run}`,
  district: `ilce-${run}`,
  quiet: `sakin-${run}`,
  expiring: `kisa-${run}`,
  verified: `ornek-dogrulanmis-${run}`,
  hostile: `ornek-isim-${run}`,
  sample: `ornek-demo-${run}`,
  pending: `ornek-bekleyen-${run}`,
  cached: `ornek-onbellek-${run}`,
};
const teamName = `Deneme FK ${run}`;
let expiringAt = new Date();

async function seed(db: TestDatabase['client']['db']): Promise<void> {
  const now = Date.now();
  const districtRows = await db
    .insert(districts)
    .values(
      [slugs.district, slugs.quiet, slugs.expiring].map((slug, index) => ({
        il: 'Deneme İli',
        ilce: `Deneme İlçesi ${index + 1}`,
        ilSlug: slugs.il,
        slug,
        centroid: { lng: 29, lat: 41 },
      })),
    )
    .returning({ id: districts.id, slug: districts.slug });
  const districtId = (slug: string) => districtRows.find((row) => row.slug === slug)?.id ?? '';
  const [owner] = await db
    .insert(users)
    .values({
      email: `deneme-${run}@example.test`,
      displayName: `Deneme Kaptan ${run}`,
      emailVerifiedAt: new Date(),
    })
    .returning({ id: users.id });
  const venue = (slug: string, name: string, flags: { verified: boolean; isSample: boolean }) => ({
    name,
    slug,
    searchName: foldTr(name),
    districtId: districtId(slugs.district),
    point: { lng: 29.01, lat: 41.01 },
    indoor: true,
    features: { lighting: true, shower: false },
    priceMinMinor: 250_000,
    priceMaxMinor: 350_000,
    phone: '+90 216 000 00 00',
    address: 'Deneme Mahallesi 1',
    createdBy: owner?.id ?? null,
    ...flags,
  });
  const venueRows = await db
    .insert(venues)
    .values([
      venue(slugs.verified, '[ÖRNEK] Deneme Kapalı Saha', { verified: true, isSample: false }),
      venue(slugs.hostile, `[ÖRNEK] Deneme ${HOSTILE}`, { verified: true, isSample: false }),
      venue(slugs.sample, '[ÖRNEK] Deneme Demo Saha', { verified: false, isSample: true }),
      venue(slugs.pending, '[ÖRNEK] Deneme Bekleyen Saha', { verified: false, isSample: false }),
      venue(slugs.cached, '[ÖRNEK] Deneme İlk Ad', { verified: true, isSample: false }),
    ])
    .returning({ id: venues.id, slug: venues.slug });
  const [team] = await db
    .insert(teams)
    .values({
      name: teamName,
      slug: `deneme-${run}`,
      districtId: districtId(slugs.district),
      ownerId: owner?.id ?? '',
    })
    .returning({ id: teams.id });
  const match = async (venueSlug: string | null) => {
    const venueId = venueRows.find((row) => row.slug === venueSlug)?.id ?? null;
    const [row] = await db
      .insert(matches)
      .values({
        teamId: team?.id ?? '',
        startsAt: new Date(now + 2 * DAY_MS),
        format: '7v7',
        slots: 14,
        status: 'open',
        venueId,
        venueText: venueId === null ? 'Deneme sahası' : null,
      })
      .returning({ id: matches.id });
    return row?.id ?? '';
  };
  expiringAt = new Date(now + 20_000);
  await db.insert(openCalls).values([
    {
      matchId: await match(slugs.verified),
      missingCount: 2,
      position: 'GK',
      level: 'regular',
      districtId: districtId(slugs.district),
      status: 'open',
      expiresAt: new Date(now + DAY_MS),
    },
    {
      matchId: await match(null),
      missingCount: 1,
      position: null,
      level: 'casual',
      districtId: districtId(slugs.expiring),
      status: 'open',
      expiresAt: expiringAt,
    },
  ]);
}

async function get(path: string): Promise<{ response: Response; html: string }> {
  const response = await fetch(`${base}${path}`);
  return { response, html: await response.text() };
}

function nonceOf(response: Response): string {
  const csp = response.headers.get('content-security-policy') ?? '';
  const nonce = /script-src 'self' 'nonce-([A-Za-z0-9+/=]+)' 'strict-dynamic'/.exec(csp)?.[1];
  expect(nonce, csp).toBeDefined();
  return nonce ?? '';
}

/** Every script element carries the response nonce; returns the parsed JSON-LD blocks. */
function expectNoncedScripts(response: Response, html: string): Record<string, unknown>[] {
  const nonce = nonceOf(response);
  const tags = html.match(/<script\b[^>]*>/g) ?? [];
  expect(tags.length).toBeGreaterThan(0);
  for (const tag of tags) {
    expect(tag).toContain(`nonce="${nonce}"`);
  }
  return [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([^<]*)<\/script>/g)].map(
    (match) => JSON.parse(match[1] ?? '') as Record<string, unknown>,
  );
}

function canonicalOf(html: string): string | undefined {
  return /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
}

function robotsOf(html: string): string | undefined {
  return /<meta name="robots" content="([^"]+)"/.exec(html)?.[1];
}

function graphTypes(blocks: readonly Record<string, unknown>[]): unknown[] {
  return blocks.flatMap((block) =>
    ((block['@graph'] as Record<string, unknown>[] | undefined) ?? []).map((node) => node['@type']),
  );
}

describe.skipIf(!ENABLED)('programmatic SEO pages (production build)', () => {
  beforeAll(async () => {
    database = await createMigratedDatabase('web_seo_built');
    logins = await createRoleLogins(database.url);
    await seed(database.client.db);
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    child = spawn(
      process.execPath,
      [NEXT_BIN, 'start', '--port', String(port), '-H', '127.0.0.1'],
      {
        cwd: APP_DIR,
        // Only the test configuration built above: no variable of the calling shell is inherited.
        env: {
          ...testEnvSource({
            WEB_ORIGIN: base,
            CORS_ALLOWED_ORIGINS: base,
            DATABASE_URL: logins.appUrl,
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
  });

  afterAll(async () => {
    if (child !== undefined && child.exitCode === null) {
      const exited = new Promise((resolve) => child?.once('exit', resolve));
      child.kill();
      await exited;
    }
    await logins?.drop();
    await database?.dispose();
  });

  it('renders a verified venue with the nonce, canonical URL and SportsActivityLocation', async () => {
    const { response, html } = await get(`/saha/${slugs.verified}`);
    expect(response.status, output).toBe(200);
    expect(response.headers.get('cache-control') ?? '').toMatch(/private|no-store/);
    expect(response.headers.get('cache-control') ?? '').not.toMatch(/public|s-maxage/);
    expect(response.headers.get('x-robots-tag')).toBeNull();
    const blocks = expectNoncedScripts(response, html);
    expect(blocks).toHaveLength(1);
    expect(graphTypes(blocks)).toEqual(['BreadcrumbList', 'SportsActivityLocation']);
    expect(canonicalOf(html)).toBe(`${base}/saha/${slugs.verified}`);
    expect(robotsOf(html)).toBeUndefined();
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('[ÖRNEK] Deneme Kapalı Saha');
    expect(html).toContain('Bu sahada maç kur');
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).toMatch(/· Kadro$/);
  });

  it('keeps a hostile venue name inside text and the escaped data block', async () => {
    const { response, html } = await get(`/saha/${slugs.hostile}`);
    expect(response.status).toBe(200);
    const blocks = expectNoncedScripts(response, html);
    expect(html).not.toContain(HOSTILE);
    expect(html).not.toContain('<script>alert(1)');
    const place = (blocks[0]?.['@graph'] as Record<string, unknown>[] | undefined)?.find(
      (node) => node['@type'] === 'SportsActivityLocation',
    );
    expect(place?.name).toBe(`[ÖRNEK] Deneme ${HOSTILE}`);
  });

  it('marks a sample venue as demonstration data and keeps it out of the index', async () => {
    const { response, html } = await get(`/saha/${slugs.sample}`);
    expect(response.status).toBe(200);
    const blocks = expectNoncedScripts(response, html);
    expect(graphTypes(blocks)).toEqual(['BreadcrumbList']);
    expect(robotsOf(html)).toBe('noindex, follow');
    expect(html).toContain('Bu kayıt örnek veridir; gerçek bir halı saha değildir.');
    // Contact details of an unverified venue are never shown.
    expect(html).not.toContain('+90 216 000 00 00');
  });

  it('answers 404 for unverified, unknown and malformed venue slugs', async () => {
    for (const slug of [slugs.pending, `olmayan-${run}`, 'Buyuk-Harf', 'a--b']) {
      const { response, html } = await get(`/saha/${slug}`);
      expect(response.status, slug).toBe(404);
      expect(html, slug).not.toContain('Bekleyen');
      expect(robotsOf(html), slug).toMatch(/noindex/);
    }
  });

  it('lists the live calls of a district with the public projection only', async () => {
    const { response, html } = await get(`/eksik-var/${slugs.il}/${slugs.district}`);
    expect(response.status, output).toBe(200);
    const blocks = expectNoncedScripts(response, html);
    expect(graphTypes(blocks)).toEqual(['BreadcrumbList']);
    expect(canonicalOf(html)).toBe(`${base}/eksik-var/${slugs.il}/${slugs.district}`);
    expect(robotsOf(html)).toBeUndefined();
    expect(html).toContain(teamName);
    expect(html).toContain('Kaleci');
    expect(html).toContain(`href="/saha/${slugs.verified}"`);
    // No person, address or contact detail of the match leaves the server.
    expect(html).not.toContain(`Deneme Kaptan ${run}`);
    expect(html).not.toContain('Deneme sahası');
    expect(html).not.toContain(`deneme-${run}@example.test`);
  });

  it('keeps a district without live calls out of the index; unknown districts are 404', async () => {
    const quiet = await get(`/eksik-var/${slugs.il}/${slugs.quiet}`);
    expect(quiet.response.status).toBe(200);
    expectNoncedScripts(quiet.response, quiet.html);
    expect(robotsOf(quiet.html)).toBe('noindex, follow');
    expect(quiet.html).toContain('açık eksik oyuncu ilanı yok');
    for (const path of [
      `/eksik-var/${slugs.il}/olmayan-${run}`,
      `/eksik-var/olmayan-${run}/${slugs.district}`,
      `/eksik-var/${slugs.il}`,
    ]) {
      expect((await get(path)).response.status, path).toBe(404);
    }
  });

  it('serves venue data from the data cache: a change appears only after revalidation', async () => {
    const first = await get(`/saha/${slugs.cached}`);
    expect(first.html).toContain('[ÖRNEK] Deneme İlk Ad');
    await database?.client.db
      .update(venues)
      .set({ name: '[ÖRNEK] Deneme Yeni Ad', searchName: foldTr('[ÖRNEK] Deneme Yeni Ad') })
      .where(eq(venues.slug, slugs.cached));
    const second = await get(`/saha/${slugs.cached}`);
    expect(second.html).toContain('[ÖRNEK] Deneme İlk Ad');
    expect(second.html).not.toContain('[ÖRNEK] Deneme Yeni Ad');
    // The HTML is still rendered per request: a new nonce on every response.
    expect(nonceOf(second.response)).not.toBe(nonceOf(first.response));
  });

  it('drops an expired call at read time although the cached entry still holds it', async () => {
    const path = `/eksik-var/${slugs.il}/${slugs.expiring}`;
    const before = await get(path);
    expect(before.html).toContain('1 eksik oyuncu');
    expect(robotsOf(before.html)).toBeUndefined();
    await delay(Math.max(0, expiringAt.getTime() - Date.now()) + 500);
    const after = await get(path);
    expect(after.response.status).toBe(200);
    expect(after.html).not.toContain('1 eksik oyuncu');
    expect(robotsOf(after.html)).toBe('noindex, follow');
  }, 60_000);

  it('lists indexable pages in the sitemap and leaves noindex pages out', async () => {
    const response = await fetch(`${base}/sitemap.xml`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type') ?? '').toContain('xml');
    const xml = await response.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    expect(locs).toEqual(
      expect.arrayContaining([
        `${base}/`,
        `${base}/ozellikler`,
        `${base}/eksik-var/${slugs.il}/${slugs.district}`,
        `${base}/saha/${slugs.verified}`,
      ]),
    );
    for (const hidden of [
      `${base}/saha/${slugs.sample}`,
      `${base}/saha/${slugs.pending}`,
      `${base}/eksik-var/${slugs.il}/${slugs.quiet}`,
      `${base}/eksik-var/${slugs.il}/${slugs.expiring}`,
    ]) {
      expect(locs).not.toContain(hidden);
    }
  });

  it('serves robots.txt with the sitemap of the configured origin and the nonce CSP', async () => {
    const response = await fetch(`${base}/robots.txt`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type') ?? '').toContain('text/plain');
    expect(response.headers.get('content-security-policy') ?? '').toMatch(/'nonce-[^']+'/);
    const text = await response.text();
    expect(text).toContain('User-Agent: *');
    expect(text).toContain('Allow: /');
    for (const path of ['/api/', '/admin/', '/mac/', '/giris', '/sifre-sifirla']) {
      expect(text).toContain(`Disallow: ${path}`);
    }
    expect(text).toContain(`Sitemap: ${base}/sitemap.xml`);
  });
});
