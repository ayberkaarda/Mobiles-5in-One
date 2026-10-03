// Takes the web screenshots in docs/screenshots/web from the production build with sample data.
//
// Usage (from kadro/, after `pnpm install` and `pnpm build`; needs Docker and Google Chrome):
//
//   node ops/take-web-screenshots.mjs [--out <dir>] [--python <python with Pillow>]
//
// What it does:
//   1. Starts a disposable PostGIS container with a unique name (tmpfs, loopback port), applies
//      every migration and the seed (districts and `[ÖRNEK]` sample venues), then adds sample rows:
//      a team with two open calls in Istanbul / Kadıköy, a live team invite and one staff admin with
//      an enrolled TOTP secret. Passwords, keys and the TOTP secret are created at run time and
//      only kept in memory; nothing is written to disk.
//   2. Starts `next start` on a free port with a local test configuration (dummy secrets created at
//      run time, WEB_ORIGIN pointing at the local URL), like the e2e suite does.
//   3. Captures the pages listed in PAGES with the installed Chrome (`channel: 'chrome'`), reduced
//      motion, fonts loaded. Desktop 1440x900, mobile 390x844, device scale factor 1. Full-page
//      shots are cut at MAX_HEIGHT pixels. The staff panel is captured after a password + TOTP
//      sign-in. The Open Graph card is saved as served (`/og/kadro.png`).
//   4. Optionally re-encodes every PNG as a 256-colour palette image with Pillow (`--python`).
//   5. Stops the server and removes the container by its exact name.
//
// Uses only dependencies already installed in the workspace (@playwright/test, pg, workspace
// packages) and Node.js 22.18+ (it imports the TOTP helper of apps/web as TypeScript).
import { execFile, spawn, spawnSync } from 'node:child_process';
import { randomBytes, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const KADRO = fileURLToPath(new URL('../', import.meta.url));
const WEB = join(KADRO, 'apps', 'web');
const NEXT_BIN = join(WEB, 'node_modules', 'next', 'dist', 'bin', 'next');
const BUILD_ID = join(WEB, '.next', 'BUILD_ID');
const IMAGE = 'postgis/postgis:16-3.5-alpine';
const CREDENTIALS = 'kadro_shots';
const MAX_HEIGHT = 1400;
const DAY_MS = 86_400_000;

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

const VENUE_SLUG = 'ornek-kadikoy-hali-saha-a';
const DISTRICT = { il: 'istanbul', ilce: 'kadikoy' };
const BLOG_SLUG = 'kadro-nasil-kurulur';

/** Public pages: file name, path (`{invite}` is replaced by the seeded invite code), viewports. */
const PAGES = [
  { name: 'web-01-home', path: '/', mobile: 'web-mobile-01-home' },
  { name: 'web-02-features', path: '/ozellikler' },
  { name: 'web-03-blog', path: '/blog' },
  { name: 'web-04-blog-article', path: `/blog/${BLOG_SLUG}`, mobile: 'web-mobile-02-blog-article' },
  { name: 'web-05-venue', path: `/saha/${VENUE_SLUG}`, mobile: 'web-mobile-03-venue' },
  {
    name: 'web-06-district',
    path: `/eksik-var/${DISTRICT.il}/${DISTRICT.ilce}`,
    mobile: 'web-mobile-04-district',
  },
  { name: 'web-07-faq', path: '/sss' },
  { name: 'web-08-invite', path: '/mac/{invite}', mobile: 'web-mobile-05-invite' },
  { name: 'web-09-privacy', path: '/gizlilik' },
];

const run = promisify(execFile);
const requireFromWeb = createRequire(join(WEB, 'package.json'));

function workspaceModule(pkg, file) {
  return import(pathToFileURL(join(WEB, 'node_modules', ...pkg.split('/'), file)).href);
}

function parseArgs(argv) {
  const options = { out: join(KADRO, 'docs', 'screenshots', 'web'), python: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === '--out' && value !== undefined) {
      options.out = resolve(value);
      index += 1;
    } else if (argv[index] === '--python' && value !== undefined) {
      options.python = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argv[index]}`);
    }
  }
  return options;
}

async function docker(args) {
  const { stdout } = await run('docker', args, { windowsHide: true });
  return stdout.trim();
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolvePort(typeof address === 'object' ? address.port : 0));
    });
  });
}

/** Two consecutive successes: the PostGIS image restarts its server once after init. */
async function waitFor(check, what, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let successes = 0;
  for (;;) {
    const ok = await check().catch(() => false);
    successes = ok ? successes + 1 : 0;
    if (successes >= 2) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`${what} did not become ready`);
    }
    await delay(500);
  }
}

/** Local web configuration with values created at run time (same shape as the e2e suite). */
function webEnv(overrides) {
  const keys = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return {
    PATH: process.env.PATH ?? '',
    SYSTEMROOT: process.env.SYSTEMROOT ?? '',
    NODE_ENV: 'production',
    APP_ENV: 'local',
    BUILD_SHA: 'screenshots',
    LOG_LEVEL: 'warn',
    JWT_PRIVATE_KEY: keys.privateKey,
    JWT_PUBLIC_KEY: keys.publicKey,
    CSRF_SECRET: randomBytes(32).toString('base64url'),
    HASH_SECRET: randomBytes(32).toString('base64url'),
    APPLE_AUDIENCES: 'app.kadro.mobile',
    GOOGLE_CLIENT_IDS: '100000000000-kadrotest.apps.googleusercontent.com',
    CLIENT_IP_HEADER: 'x-forwarded-for',
    TRUSTED_PROXY_CIDRS: '10.0.0.5/32',
    RATE_LIMIT_AUTH_MAX: '100',
    ...overrides,
  };
}

/** Sample rows on top of the seed: a team with open calls and an invite, and one staff admin. */
async function seedSampleData(url, totpKey, totp) {
  const { createDbClient, districts, matches, openCalls, teamInvites, teamMembers, teams, users } =
    await workspaceModule('@kadro/db', 'dist/index.js');
  const { seedDatabase } = await workspaceModule('@kadro/db', 'dist/seed/index.js');
  const { hashPassword, hashToken } = await workspaceModule('@kadro/auth', 'dist/index.js');
  const { and, eq } = await workspaceModule('drizzle-orm', 'index.js');

  const client = createDbClient({ connectionString: url, maxConnections: 2 });
  try {
    const { db } = client;
    await seedDatabase(db);
    const [district] = await db
      .select({ id: districts.id })
      .from(districts)
      .where(and(eq(districts.ilSlug, DISTRICT.il), eq(districts.slug, DISTRICT.ilce)));
    if (district === undefined) {
      throw new Error('seeded district is missing');
    }

    const [captain] = await db
      .insert(users)
      .values({
        email: 'ornek-kaptan@example.test',
        displayName: 'Örnek Kaptan',
        emailVerifiedAt: new Date(),
      })
      .returning({ id: users.id });
    const [team] = await db
      .insert(teams)
      .values({
        name: '[ÖRNEK] Moda Akşam FK',
        slug: 'ornek-moda-aksam-fk',
        districtId: district.id,
        ownerId: captain.id,
      })
      .returning({ id: teams.id });
    await db.insert(teamMembers).values({ teamId: team.id, userId: captain.id, role: 'captain' });

    const calls = [
      { days: 1, format: '7v7', slots: 14, missing: 2, position: 'GK', level: 'regular' },
      { days: 3, format: '6v6', slots: 12, missing: 1, position: 'DEF', level: 'casual' },
    ];
    for (const call of calls) {
      // Kick-off at 20:00 Istanbul time (17:00 UTC) on a later day; applications close 2 h before.
      const startsAt = new Date(Date.now() + call.days * DAY_MS);
      startsAt.setUTCHours(17, 0, 0, 0);
      const [match] = await db
        .insert(matches)
        .values({
          teamId: team.id,
          startsAt,
          format: call.format,
          slots: call.slots,
          status: 'open',
          venueId: null,
          venueText: null,
        })
        .returning({ id: matches.id });
      await db.insert(openCalls).values({
        matchId: match.id,
        missingCount: call.missing,
        position: call.position,
        level: call.level,
        districtId: district.id,
        status: 'open',
        expiresAt: new Date(startsAt.getTime() - 2 * 3_600_000),
      });
    }

    // Invite codes are 128 random bits in base64url, stored only as their hash (like the API).
    const inviteCode = randomBytes(16).toString('base64url');
    await db.insert(teamInvites).values({
      teamId: team.id,
      codeHash: hashToken(inviteCode),
      expiresAt: new Date(Date.now() + 7 * DAY_MS),
      maxUses: 20,
    });

    const staff = {
      email: 'ornek-yonetici@example.test',
      password: `Shots-${randomBytes(12).toString('hex')}`,
      secret: totp.generateTotpSecret(),
    };
    const [admin] = await db
      .insert(users)
      .values({
        email: staff.email,
        displayName: 'Örnek Yönetici',
        passwordHash: await hashPassword(staff.password),
        emailVerifiedAt: new Date(),
        role: 'admin',
      })
      .returning({ id: users.id });
    await db
      .update(users)
      .set({ totpSecretEnc: totp.encryptTotpSecret(totpKey, admin.id, staff.secret) })
      .where(eq(users.id, admin.id));
    return { inviteCode, staff };
  } finally {
    await client.close();
  }
}

async function settle(page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForLoadState('networkidle');
  await delay(300);
}

async function capture(page, base, path, file, viewport) {
  const response = await page.goto(`${base}${path}`, { waitUntil: 'load' });
  if (response === null || !response.ok()) {
    throw new Error(`${path} answered ${response?.status() ?? 'no response'}`);
  }
  await settle(page);
  await shoot(page, file, viewport);
}

async function shoot(page, file, viewport) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.screenshot({
    path: file,
    fullPage: true,
    animations: 'disabled',
    clip: { x: 0, y: 0, width: viewport.width, height: Math.min(height, MAX_HEIGHT) },
  });
  console.log(`saved ${file}`);
}

const PILLOW_SCRIPT = `
import sys
from PIL import Image
for path in sys.argv[1:]:
    image = Image.open(path).convert('RGB')
    image.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(path, optimize=True)
`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(BUILD_ID)) {
    throw new Error('apps/web/.next/BUILD_ID is missing: run `pnpm build` first');
  }
  mkdirSync(options.out, { recursive: true });
  const { chromium } = requireFromWeb('@playwright/test');
  const pg = requireFromWeb('pg');
  const { runMigrations } = await workspaceModule('@kadro/db', 'dist/migrate.js');
  const totp = await import(pathToFileURL(join(WEB, 'lib', 'server', 'admin', 'totp.ts')).href);

  const name = `kadro-web-shots-${randomBytes(6).toString('hex')}`;
  let server;
  let browser;
  let started = false;
  try {
    await docker([
      'run',
      '--detach',
      '--rm',
      '--name',
      name,
      '--tmpfs',
      '/var/lib/postgresql/data',
      '--env',
      `POSTGRES_USER=${CREDENTIALS}`,
      '--env',
      `POSTGRES_PASSWORD=${CREDENTIALS}`,
      '--env',
      `POSTGRES_DB=${CREDENTIALS}`,
      '--publish',
      '127.0.0.1::5432',
      IMAGE,
    ]);
    started = true;
    console.log(`container ${name} started`);
    const mapping = await docker(['port', name, '5432/tcp']);
    const dbPort = /:(\d+)\s*$/m.exec(mapping.split('\n')[0] ?? '')?.[1];
    if (dbPort === undefined) {
      throw new Error(`unexpected docker port output: ${mapping}`);
    }
    const url = `postgres://${CREDENTIALS}:${CREDENTIALS}@127.0.0.1:${dbPort}/${CREDENTIALS}`;
    await waitFor(async () => {
      const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2_000 });
      try {
        await client.connect();
        await client.query('select 1');
        return true;
      } finally {
        await client.end().catch(() => undefined);
      }
    }, 'PostGIS container');
    await runMigrations(url);
    const totpKey = randomBytes(32);
    const { inviteCode, staff } = await seedSampleData(url, totpKey, totp);

    const webPort = await freePort();
    const base = `http://localhost:${webPort}`;
    server = spawn(
      process.execPath,
      [NEXT_BIN, 'start', '--port', String(webPort), '-H', 'localhost'],
      {
        cwd: WEB,
        env: webEnv({
          WEB_ORIGIN: base,
          CORS_ALLOWED_ORIGINS: base,
          DATABASE_URL: url,
          TOTP_ENCRYPTION_KEY: totpKey.toString('base64url'),
        }),
        stdio: ['ignore', 'ignore', 'inherit'],
        windowsHide: true,
      },
    );
    await waitFor(async () => (await fetch(`${base}/api/v1/health`)).ok, 'web server', 60_000);
    console.log(`server ready at ${base}`);

    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const contextOptions = {
      locale: 'tr-TR',
      timezoneId: 'Europe/Istanbul',
      reducedMotion: 'reduce',
      deviceScaleFactor: 1,
    };
    const desktop = await browser.newContext({ ...contextOptions, viewport: DESKTOP });
    const mobile = await browser.newContext({
      ...contextOptions,
      viewport: MOBILE,
      isMobile: true,
      hasTouch: true,
    });
    const desktopPage = await desktop.newPage();
    const mobilePage = await mobile.newPage();
    for (const entry of PAGES) {
      const path = entry.path.replace('{invite}', inviteCode);
      await capture(desktopPage, base, path, join(options.out, `${entry.name}.png`), DESKTOP);
      if (entry.mobile !== undefined) {
        await capture(mobilePage, base, path, join(options.out, `${entry.mobile}.png`), MOBILE);
      }
    }

    // Staff panel: password sign-in, TOTP step-up, venue queue, one verification, audit log.
    const page = desktopPage;
    await capture(page, base, '/admin/giris', join(options.out, 'web-10-admin-login.png'), DESKTOP);
    await page.getByLabel('E-posta').fill(staff.email);
    await page.getByLabel('Şifre', { exact: true }).fill(staff.password);
    await page.getByRole('button', { name: 'Giriş yap' }).click();
    await page.waitForURL(`${base}/admin/dogrulama`);
    const remaining = () =>
      totp.TOTP_PERIOD_SECONDS - ((Date.now() / 1000) % totp.TOTP_PERIOD_SECONDS);
    while (remaining() < 10) {
      await delay(250);
    }
    await page.getByLabel('Doğrulama kodu').fill(totp.totpAt(staff.secret, new Date()));
    await page.getByRole('button', { name: 'Doğrula' }).click();
    await page.waitForURL(`${base}/admin/sahalar`);
    await settle(page);
    await shoot(page, join(options.out, 'web-11-admin-venues.png'), DESKTOP);
    const firstVerify = page.getByRole('button', { name: /: onayla$/ }).first();
    const label = (await firstVerify.getAttribute('aria-label')) ?? '';
    await firstVerify.click();
    await page
      .getByRole('button', { name: label, exact: true })
      .waitFor({ state: 'detached', timeout: 10_000 });
    await capture(
      page,
      base,
      '/admin/denetim',
      join(options.out, 'web-12-admin-audit.png'),
      DESKTOP,
    );

    const og = await desktop.request.get(`${base}/og/kadro.png`);
    if (!og.ok()) {
      throw new Error(`/og/kadro.png answered ${og.status()}`);
    }
    writeFileSync(join(options.out, 'web-13-og-card.png'), await og.body());
    console.log('saved web-13-og-card.png');
  } finally {
    await browser?.close().catch(() => undefined);
    server?.kill();
    if (started) {
      await docker(['rm', '-f', name]).catch((error) => {
        console.error(`could not remove container ${name}: ${error.message}`);
      });
      console.log(`container ${name} removed`);
    }
  }

  const files = readdirSync(options.out)
    .filter((file) => file.endsWith('.png'))
    .map((file) => join(options.out, file));
  if (options.python !== null) {
    const result = spawnSync(options.python, ['-c', PILLOW_SCRIPT, ...files], { stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error('PNG optimisation failed');
    }
  }
  let total = 0;
  for (const file of files) {
    const { size } = statSync(file);
    total += size;
    console.log(`${(size / 1024).toFixed(0).padStart(5)} KB  ${file}`);
  }
  console.log(`${(total / 1024).toFixed(0).padStart(5)} KB  total`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
