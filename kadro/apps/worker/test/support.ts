import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

import {
  type Database,
  type DbClient,
  type MatchStatus,
  type RsvpStatus,
  type TeamRole,
  createDbClient,
  districts,
  matchRsvps,
  matches,
  newId,
  openCallApplications,
  openCalls,
  pushTokens,
  teamMembers,
  teams,
  users,
} from '@kadro/db';
import { runMigrations } from '@kadro/db/migrate';
import pg from 'pg';
import { type Logger } from 'pino';
import { inject } from 'vitest';

import { type Clock } from '../src/clock.js';
import { type CostCaps } from '../src/cost/guard.js';
import { FakeS3, TEST_BACKUP_BUCKET, TEST_INCOMING_BUCKET, TEST_MEDIA_BUCKET } from './fake-s3.js';
import { createLogger } from '../src/logger.js';
import { type MetricLabels, type MetricName, type Metrics } from '../src/metrics.js';
import { type QueueOverrides } from '../src/queues.js';
import { type WorkerRuntime, type WorkerRuntimeOptions, startWorker } from '../src/runtime.js';

// ---------------------------------------------------------------------------
// Databases and roles
// ---------------------------------------------------------------------------

export interface TestDatabase {
  readonly name: string;
  /** Superuser connection URL for fixtures and assertions. */
  readonly adminUrl: string;
  /** Login that is a member of `kadro_worker` (the worker connects with it). */
  readonly workerUrl: string;
  /** Login that is a member of `kadro_app` (the web app's send-only role). */
  readonly appUrl: string;
  /** Superuser Drizzle client for fixtures. */
  readonly admin: DbClient;
  dispose(): Promise<void>;
}

function withDatabase(url: string, database: string, credentials?: [string, string]): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  if (credentials) {
    parsed.username = credentials[0];
    parsed.password = credentials[1];
  }
  return parsed.toString();
}

async function withAdmin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: inject('adminDatabaseUrl') });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function suffix(): string {
  return randomBytes(4).toString('hex');
}

/** Fresh database with all migrations applied plus one login per application role. */
export async function createTestDatabase(prefix: string): Promise<TestDatabase> {
  const name = `${prefix}_${suffix()}`;
  const workerLogin = `worker_${suffix()}`;
  const appLogin = `app_${suffix()}`;
  const workerPassword = randomBytes(18).toString('base64url');
  const appPassword = randomBytes(18).toString('base64url');
  for (const identifier of [name, workerLogin, appLogin]) {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(identifier)) {
      throw new Error('invalid generated identifier');
    }
  }
  const base = inject('adminDatabaseUrl');
  await withAdmin((client) =>
    client.query(`create database ${client.escapeIdentifier(name)} template template0`),
  );
  const adminUrl = withDatabase(base, name);
  await runMigrations(adminUrl);
  await withAdmin(async (client) => {
    await client.query(
      `create role ${client.escapeIdentifier(workerLogin)} login password ${client.escapeLiteral(workerPassword)} in role kadro_worker`,
    );
    await client.query(
      `create role ${client.escapeIdentifier(appLogin)} login password ${client.escapeLiteral(appPassword)} in role kadro_app`,
    );
  });
  const admin = createDbClient({ connectionString: adminUrl, maxConnections: 4 });
  return {
    name,
    adminUrl,
    workerUrl: withDatabase(base, name, [workerLogin, workerPassword]),
    appUrl: withDatabase(base, name, [appLogin, appPassword]),
    admin,
    dispose: async () => {
      await admin.close();
      await withAdmin(async (client) => {
        await client.query(`drop database if exists ${client.escapeIdentifier(name)} with (force)`);
        await client.query(`drop role if exists ${client.escapeIdentifier(workerLogin)}`);
        await client.query(`drop role if exists ${client.escapeIdentifier(appLogin)}`);
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Observability capture
// ---------------------------------------------------------------------------

export interface CapturedLogs {
  readonly logger: Logger;
  readonly lines: string[];
  entries(): Record<string, unknown>[];
}

export function captureLogs(): CapturedLogs {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(...chunk.toString('utf8').split('\n').filter(Boolean));
      callback();
    },
  });
  const logger = createLogger({ level: 'debug', buildSha: 'test', appEnv: 'local' }, stream);
  return {
    logger,
    lines,
    entries: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

export interface RecordedMetric {
  readonly name: MetricName;
  readonly labels: MetricLabels;
}

export class MetricsRecorder implements Metrics {
  readonly recorded: RecordedMetric[] = [];

  increment(name: MetricName, labels: MetricLabels): void {
    this.recorded.push({ name, labels });
  }

  count(name: MetricName, labels: Partial<Record<string, string | number>> = {}): number {
    return this.recorded.filter(
      (metric) =>
        metric.name === name &&
        // eslint-disable-next-line security/detect-object-injection -- key comes from the test's own label filter
        Object.entries(labels).every(([key, value]) => metric.labels[key] === value),
    ).length;
  }
}

export class MutableClock implements Clock {
  #now: Date;

  constructor(start: Date) {
    this.#now = start;
  }

  now(): Date {
    return new Date(this.#now);
  }

  set(value: Date): void {
    this.#now = value;
  }

  advance(ms: number): void {
    this.#now = new Date(this.#now.getTime() + ms);
  }
}

// ---------------------------------------------------------------------------
// Fake provider APIs (Resend and Expo) on a local HTTP server
// ---------------------------------------------------------------------------

export interface RecordedRequest {
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

export interface FakeResponse {
  readonly status: number;
  readonly body?: unknown;
  /** Delay before answering, in milliseconds. */
  readonly delayMs?: number;
  /** Drop the connection without an answer (network failure). */
  readonly destroy?: boolean;
}

export type FakeResponder = (request: RecordedRequest) => FakeResponse | Promise<FakeResponse>;

export interface FakeProvider {
  readonly origin: string;
  /** In-memory S3 API on the same server (buckets `kadro-test-incoming`, `kadro-test-media`). */
  readonly s3: FakeS3;
  readonly requests: RecordedRequest[];
  /** Responder per path prefix; unmatched paths answer 404. */
  readonly responders: Map<string, FakeResponder>;
  close(): Promise<void>;
}

export const RESEND_PATH = '/emails';
export const EXPO_SEND_PATH = '/--/api/v2/push/send';
export const EXPO_RECEIPTS_PATH = '/--/api/v2/push/getReceipts';

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text.length === 0 ? undefined : (JSON.parse(text) as unknown);
}

/** Expo answer for a send request: one `ok` ticket per message with a fresh ticket id. */
export function expoOkTickets(request: RecordedRequest): FakeResponse {
  const messages = request.body as unknown[];
  return {
    status: 200,
    body: { data: messages.map(() => ({ status: 'ok', id: crypto.randomUUID() })) },
  };
}

export async function startFakeProvider(): Promise<FakeProvider> {
  const requests: RecordedRequest[] = [];
  const responders = new Map<string, FakeResponder>([
    [RESEND_PATH, () => ({ status: 200, body: { id: crypto.randomUUID() } })],
    [EXPO_SEND_PATH, expoOkTickets],
    [EXPO_RECEIPTS_PATH, () => ({ status: 200, body: { data: {} } })],
  ]);
  const s3 = new FakeS3();
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      if (s3.handles(request.url ?? '/')) {
        await s3.handle(request, response);
        return;
      }
      const recorded: RecordedRequest = {
        path: request.url ?? '/',
        authorization: request.headers.authorization,
        body: await readBody(request),
      };
      requests.push(recorded);
      const responder = responders.get(recorded.path);
      const answer = responder ? await responder(recorded) : { status: 404 };
      if (answer.delayMs) {
        await delay(answer.delayMs);
      }
      if (answer.destroy) {
        request.socket.destroy();
        return;
      }
      response.writeHead(answer.status, { 'content-type': 'application/json' });
      response.end(answer.body === undefined ? '' : JSON.stringify(answer.body));
    })().catch(() => {
      response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    s3,
    requests,
    responders,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

// ---------------------------------------------------------------------------
// Worker under test
// ---------------------------------------------------------------------------

export interface TestWorker {
  readonly runtime: WorkerRuntime;
  readonly logs: CapturedLogs;
  readonly metrics: MetricsRecorder;
  readonly secrets: { readonly resendApiKey: string; readonly expoAccessToken: string };
}

export interface TestWorkerOptions {
  readonly clock?: Clock;
  readonly queueOverrides?: QueueOverrides;
  readonly hourlyCap?: number;
  readonly costCaps?: Partial<CostCaps>;
  readonly shutdownTimeoutMs?: number;
  readonly schedule?: boolean;
  /** Extra environment keys (optional settings such as `BACKUP_*`). */
  readonly env?: Partial<WorkerRuntimeOptions['env']>;
  readonly extra?: Partial<WorkerRuntimeOptions>;
}

export async function startTestWorker(
  database: TestDatabase,
  provider: FakeProvider,
  options: TestWorkerOptions = {},
): Promise<TestWorker> {
  const logs = captureLogs();
  const metrics = new MetricsRecorder();
  const secrets = {
    resendApiKey: `re_${randomBytes(18).toString('base64url')}`,
    expoAccessToken: randomBytes(30).toString('base64url'),
  };
  const runtime = await startWorker({
    env: {
      APP_ENV: 'local',
      DATABASE_URL: database.workerUrl,
      WEB_ORIGIN: 'http://localhost:3000',
      EMAIL_TRANSPORT: 'resend',
      RESEND_API_KEY: secrets.resendApiKey,
      EMAIL_FROM: 'Kadro <bildirim@kadro.app>',
      PUSH_TRANSPORT: 'expo',
      EXPO_ACCESS_TOKEN: secrets.expoAccessToken,
      PUSH_HOURLY_CAP: options.hourlyCap ?? 5_000,
      EMAIL_DAILY_CAP: options.costCaps?.emailDaily ?? 2_000,
      EMAIL_MONTHLY_CAP: options.costCaps?.emailMonthly ?? 45_000,
      PUSH_DAILY_CAP: options.costCaps?.pushDaily ?? 50_000,
      R2_ENDPOINT: provider.origin,
      R2_ACCESS_KEY_ID: 'kadro-test',
      R2_SECRET_ACCESS_KEY: 'A'.repeat(32),
      R2_INCOMING_BUCKET: TEST_INCOMING_BUCKET,
      R2_MEDIA_BUCKET: TEST_MEDIA_BUCKET,
      ...options.env,
    },
    logger: logs.logger,
    metrics,
    fetch: globalThis.fetch,
    schedule: options.schedule ?? false,
    pollingIntervalSeconds: 0.5,
    shutdownTimeoutMs: options.shutdownTimeoutMs ?? 10_000,
    healthFile: join(await mkdtemp(join(tmpdir(), 'kadro-worker-test-')), 'health.json'),
    resendApiOrigin: provider.origin,
    expoApiOrigin: provider.origin,
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.queueOverrides ? { queueOverrides: options.queueOverrides } : {}),
    ...options.extra,
  });
  return { runtime, logs, metrics, secrets };
}

// ---------------------------------------------------------------------------
// Waiting and job inspection
// ---------------------------------------------------------------------------

export async function waitFor<T>(
  probe: () => Promise<T | undefined | null | false>,
  { timeoutMs = 20_000, intervalMs = 100, label = 'condition' } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== null && value !== false) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await delay(intervalMs);
  }
}

export interface JobRow {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly retryCount: number;
  readonly singletonKey: string | null;
  readonly startAfter: Date;
  readonly createdOn: Date;
  readonly data: Record<string, unknown>;
  readonly output: Record<string, unknown> | null;
}

/** Reads pg-boss job rows directly (superuser), across every queue partition. */
export async function jobsIn(database: TestDatabase, queue: string): Promise<JobRow[]> {
  const result = await database.admin.pool.query<JobRow>(
    `select id, name, state::text as state, retry_count as "retryCount",
            singleton_key as "singletonKey", start_after as "startAfter",
            created_on as "createdOn", data, output
       from pgboss.job where name = $1 order by created_on, id`,
    [queue],
  );
  return result.rows;
}

export async function waitForJobState(
  database: TestDatabase,
  queue: string,
  jobId: string,
  states: readonly string[],
  timeoutMs = 20_000,
): Promise<JobRow> {
  return waitFor(
    async () => {
      const jobs = await jobsIn(database, queue);
      return jobs.find((job) => job.id === jobId && states.includes(job.state));
    },
    { timeoutMs, label: `${queue} job ${jobId} in ${states.join('|')}` },
  );
}

// ---------------------------------------------------------------------------
// Domain fixtures (superuser, bypassing grants)
// ---------------------------------------------------------------------------

export function generatedPasswordHash(): string {
  return `$argon2id$v=19$m=65536,t=3,p=1$${randomBytes(16).toString('base64')}$${randomBytes(32).toString('base64')}`;
}

export class Fixtures {
  #districtId: string | undefined;

  constructor(readonly db: Database) {}

  async district(): Promise<string> {
    if (this.#districtId) {
      return this.#districtId;
    }
    const code = suffix();
    const [row] = await this.db
      .insert(districts)
      .values({
        il: `Test İl ${code}`,
        ilce: `Test İlçe ${code}`,
        ilSlug: `test-il-${code}`,
        slug: `test-ilce-${code}`,
        centroid: { lng: 29, lat: 41 },
      })
      .returning({ id: districts.id });
    if (!row) throw new Error('district insert returned no row');
    this.#districtId = row.id;
    return row.id;
  }

  async user(
    overrides: Partial<typeof users.$inferInsert> & { verified?: boolean } = {},
  ): Promise<{ id: string; email: string; displayName: string }> {
    const { verified = true, ...values } = overrides;
    const email = `oyuncu-${suffix()}@example.test`;
    const [row] = await this.db
      .insert(users)
      .values({
        email,
        displayName: 'Deneme Oyuncu',
        passwordHash: generatedPasswordHash(),
        emailVerifiedAt: verified ? new Date() : null,
        ...values,
      })
      .returning({ id: users.id, email: users.email, displayName: users.displayName });
    if (!row) throw new Error('user insert returned no row');
    return row;
  }

  async team(ownerId: string, name = 'Deneme Kadro'): Promise<string> {
    const [row] = await this.db
      .insert(teams)
      .values({ name, slug: `kadro-${suffix()}`, districtId: await this.district(), ownerId })
      .returning({ id: teams.id });
    if (!row) throw new Error('team insert returned no row');
    await this.member(row.id, ownerId, 'captain');
    return row.id;
  }

  async member(teamId: string, userId: string, role: TeamRole = 'player'): Promise<void> {
    await this.db.insert(teamMembers).values({ teamId, userId, role });
  }

  async match(
    teamId: string,
    values: { startsAt: Date; status?: MatchStatus; slots?: number },
  ): Promise<string> {
    const status = values.status ?? 'open';
    const [row] = await this.db
      .insert(matches)
      .values({
        teamId,
        startsAt: values.startsAt,
        format: '6v6',
        slots: values.slots ?? 12,
        status,
        lockedAt: status === 'locked' ? new Date() : null,
      })
      .returning({ id: matches.id });
    if (!row) throw new Error('match insert returned no row');
    return row.id;
  }

  async rsvp(matchId: string, userId: string, status: RsvpStatus): Promise<void> {
    await this.db.insert(matchRsvps).values({
      matchId,
      userId,
      status,
      waitlistedAt: status === 'waitlist' ? new Date() : null,
    });
  }

  async pushToken(userId: string, lastSeenAt = new Date()): Promise<{ id: string; token: string }> {
    const token = `ExponentPushToken[${randomBytes(11).toString('base64url')}]`;
    const [row] = await this.db
      .insert(pushTokens)
      .values({ userId, expoToken: token, platform: 'ios', lastSeenAt })
      .returning({ id: pushTokens.id });
    if (!row) throw new Error('push token insert returned no row');
    return { id: row.id, token };
  }

  async openCall(matchId: string, expiresAt: Date): Promise<string> {
    const [row] = await this.db
      .insert(openCalls)
      .values({
        matchId,
        missingCount: 2,
        level: 'regular',
        districtId: await this.district(),
        expiresAt,
      })
      .returning({ id: openCalls.id });
    if (!row) throw new Error('open call insert returned no row');
    return row.id;
  }

  async application(
    openCallId: string,
    userId: string,
    status: 'pending' | 'accepted' | 'rejected' | 'withdrawn' = 'pending',
  ): Promise<string> {
    const [row] = await this.db
      .insert(openCallApplications)
      .values({ openCallId, userId, status })
      .returning({ id: openCallApplications.id });
    if (!row) throw new Error('application insert returned no row');
    return row.id;
  }
}

export { newId };

export { FakeS3, TEST_BACKUP_BUCKET, TEST_INCOMING_BUCKET, TEST_MEDIA_BUCKET };
