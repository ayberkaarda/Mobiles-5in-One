import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import { hashPassword } from '@kadro/auth';
import { foldTr, type PlatformRole } from '@kadro/contracts';
import { createDbClient, districts, users, venues } from '@kadro/db';
import { runMigrations } from '@kadro/db/migrate';
import { eq } from 'drizzle-orm';
import pg from 'pg';

import {
  base32Encode,
  encryptTotpSecret,
  generateTotpSecret,
} from '../../../lib/server/admin/totp';
import { testEnvSource } from '../../support/env';
import { bootstrapJobQueues } from '../../support/jobs';

/**
 * Local stack of the admin end-to-end suite (ADR-0068): a disposable PostGIS container (tmpfs,
 * random loopback port, removed afterwards), every migration, the pg-boss queues, seeded staff and
 * players, then the production build (`next start`) on a free port. Passwords, the TOTP
 * encryption key and the TOTP secrets are created at run time; nothing is stored in the repo.
 */

const run = promisify(execFile);
const IMAGE = 'postgis/postgis:16-3.5-alpine';
const CREDENTIALS = 'kadro_e2e';
const APP_DIR = fileURLToPath(new URL('../../../', import.meta.url));
const NEXT_BIN = fileURLToPath(
  new URL('../../../node_modules/next/dist/bin/next', import.meta.url),
);
const BUILD_ID = fileURLToPath(new URL('../../../.next/BUILD_ID', import.meta.url));

export interface SeededAccount {
  readonly id: string;
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly role: PlatformRole;
  /** Base32 TOTP secret of an enrolled staff account, `null` otherwise. */
  readonly totpSecret: string | null;
}

export interface E2eState {
  readonly baseUrl: string;
  readonly accounts: Readonly<Record<AccountKey, SeededAccount>>;
  readonly venueNames: readonly string[];
  /** Output of the web server, for diagnosing a failed run. */
  readonly serverLog: string;
}

export type AccountKey =
  | 'venueAdmin'
  | 'userAdmin'
  | 'importAdmin'
  | 'moderator'
  | 'unenrolledModerator'
  | 'player'
  | 'target';

const ACCOUNTS: readonly {
  key: AccountKey;
  role: PlatformRole;
  displayName: string;
  enrolled: boolean;
}[] = [
  { key: 'venueAdmin', role: 'admin', displayName: 'Saha Yöneticisi', enrolled: true },
  { key: 'userAdmin', role: 'admin', displayName: 'Kullanıcı Yöneticisi', enrolled: true },
  { key: 'importAdmin', role: 'admin', displayName: 'Aktarım Yöneticisi', enrolled: true },
  { key: 'moderator', role: 'moderator', displayName: 'Deneme Moderatör', enrolled: true },
  {
    key: 'unenrolledModerator',
    role: 'moderator',
    displayName: 'Yeni Moderatör',
    enrolled: false,
  },
  { key: 'player', role: 'user', displayName: 'Deneme Oyuncu', enrolled: false },
  { key: 'target', role: 'user', displayName: 'Hedef Oyuncu', enrolled: false },
];

async function docker(args: readonly string[]): Promise<string> {
  const { stdout } = await run('docker', [...args], { windowsHide: true });
  return stdout.trim();
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

async function waitFor(check: () => Promise<boolean>, what: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let successes = 0;
  for (;;) {
    let ok = false;
    try {
      ok = await check();
    } catch {
      ok = false;
    }
    successes = ok ? successes + 1 : 0;
    // Two consecutive successes: the PostGIS image restarts its server once after init.
    if (successes >= 2) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`${what} did not become ready`);
    }
    await delay(500);
  }
}

async function canQuery(url: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2_000 });
  try {
    await client.connect();
    await client.query('select 1');
    return true;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function seed(url: string, totpKey: Buffer) {
  const client = createDbClient({ connectionString: url, maxConnections: 2 });
  try {
    const db = client.db;
    const [district] = await db
      .insert(districts)
      .values({
        il: 'İzmir',
        ilce: 'Bornova',
        ilSlug: 'izmir',
        slug: 'bornova',
        centroid: { lng: 27.21, lat: 38.46 },
      })
      .returning({ id: districts.id });
    if (district === undefined) {
      throw new Error('district insert returned no row');
    }
    const venueNames = ['Bornova Gece Sahası', 'Kazımdirik Halı Saha'];
    for (const [index, name] of venueNames.entries()) {
      await db.insert(venues).values({
        name,
        slug: `e2e-saha-${index + 1}`,
        searchName: foldTr(name),
        districtId: district.id,
        point: { lng: 27.2 + index / 100, lat: 38.45 },
        address: 'Kazımdirik Mah. 1',
        phone: null,
        verified: false,
        isSample: false,
        createdBy: null,
      });
    }

    const accounts: Partial<Record<AccountKey, SeededAccount>> = {};
    for (const spec of ACCOUNTS) {
      const email = `e2e-${spec.key.toLowerCase()}@example.test`;
      const password = `E2e-${randomBytes(12).toString('hex')}`;
      const [row] = await db
        .insert(users)
        .values({
          email,
          displayName: spec.displayName,
          passwordHash: await hashPassword(password),
          emailVerifiedAt: new Date(),
          role: spec.role,
        })
        .returning({ id: users.id });
      if (row === undefined) {
        throw new Error('user insert returned no row');
      }
      let totpSecret: string | null = null;
      if (spec.enrolled) {
        const secret = generateTotpSecret();
        totpSecret = base32Encode(secret);
        await db
          .update(users)
          .set({ totpSecretEnc: encryptTotpSecret(totpKey, row.id, secret) })
          .where(eq(users.id, row.id));
      }
      accounts[spec.key] = {
        id: row.id,
        email,
        password,
        displayName: spec.displayName,
        role: spec.role,
        totpSecret,
      };
    }
    return { accounts: accounts as Record<AccountKey, SeededAccount>, venueNames };
  } finally {
    await client.close();
  }
}

export interface RunningStack {
  readonly state: E2eState;
  stop(): Promise<void>;
}

/** Starts the container, migrates, seeds and serves the build. */
export async function startStack(): Promise<RunningStack> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path inside this package
  if (!existsSync(BUILD_ID)) {
    throw new Error('apps/web/.next/BUILD_ID is missing: run `pnpm build` before the e2e suite');
  }
  await docker(['info', '--format', '{{.ServerVersion}}']).catch((error: unknown) => {
    throw new Error('Docker is not reachable; the admin e2e suite needs a PostGIS container', {
      cause: error,
    });
  });

  const name = `kadro-web-e2e-${randomBytes(6).toString('hex')}`;
  await docker([
    'run',
    '--detach',
    '--rm',
    '--name',
    name,
    '--label',
    'kadro.purpose=apps-web-e2e',
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
  let server: ChildProcess | undefined;
  const stop = async () => {
    server?.kill();
    await docker(['rm', '--force', '--volumes', name]).catch(() => undefined);
  };

  try {
    const mapping = await docker(['port', name, '5432/tcp']);
    const port = /:(\d+)\s*$/m.exec(mapping.split('\n')[0] ?? '')?.[1];
    if (port === undefined) {
      throw new Error(`unexpected docker port output: ${mapping}`);
    }
    const url = `postgres://${CREDENTIALS}:${CREDENTIALS}@127.0.0.1:${port}/${CREDENTIALS}`;
    await waitFor(() => canQuery(url), 'PostGIS container');
    await runMigrations(url);
    await bootstrapJobQueues(url);

    const totpKey = randomBytes(32);
    const seeded = await seed(url, totpKey);

    const webPort = await freePort();
    const baseUrl = `http://localhost:${webPort}`;
    const serverLog = join(tmpdir(), `${name}.log`);
    server = spawn(
      process.execPath,
      [NEXT_BIN, 'start', '--port', String(webPort), '-H', 'localhost'],
      {
        cwd: APP_DIR,
        env: {
          ...testEnvSource({
            WEB_ORIGIN: baseUrl,
            CORS_ALLOWED_ORIGINS: baseUrl,
            DATABASE_URL: url,
            TOTP_ENCRYPTION_KEY: totpKey.toString('base64url'),
            // Every spec signs in from the same loopback address.
            RATE_LIMIT_AUTH_MAX: '100',
          }),
          NODE_ENV: 'production',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- run-specific file in the OS temp directory
    const log = createWriteStream(serverLog);
    server.stdout?.pipe(log);
    server.stderr?.pipe(log);
    await waitFor(async () => (await fetch(`${baseUrl}/api/v1/health`)).ok, 'web server', 60_000);
    return {
      state: { baseUrl, accounts: seeded.accounts, venueNames: seeded.venueNames, serverLog },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
