import { EMAIL_KINDS, NOTIFICATION_TYPES, type PushSendJob } from '@kadro/contracts';
import { jobReceipts, rateLimitBuckets } from '@kadro/db';
import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { scheduledPayload } from '../src/boss.js';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../src/clock.js';
import { EMAIL_SEND_CLASS, PUSH_SEND_CLASS } from '../src/cost/classes.js';
import {
  type CostCaps,
  type UsageReader,
  alertKey,
  createCostGuardHandler,
  createDbUsageReader,
  gateKey,
  isSendPaused,
  meterLevel,
  nextUtcMidnight,
  utcDayStart,
} from '../src/cost/guard.js';
import { enqueue } from '../src/enqueue.js';
import { type JobContext } from '../src/job-runner.js';
import { PUSH_CAP_KEY } from '../src/push/cap.js';
import {
  EXPO_SEND_PATH,
  type FakeProvider,
  Fixtures,
  MetricsRecorder,
  MutableClock,
  RESEND_PATH,
  type TestDatabase,
  type TestWorker,
  captureLogs,
  createTestDatabase,
  expoOkTickets,
  newId,
  startFakeProvider,
  startTestWorker,
  waitForJobState,
} from './support.js';

let database: TestDatabase;
let provider: FakeProvider;
let worker: TestWorker;
let fixtures: Fixtures;
const clock = new MutableClock(new Date());

const CAPS: CostCaps = { emailDaily: 100, emailMonthly: 1_000, pushDaily: 200 };

beforeAll(async () => {
  database = await createTestDatabase('worker_cost_guard');
  provider = await startFakeProvider();
  worker = await startTestWorker(database, provider, { clock, costCaps: CAPS });
  fixtures = new Fixtures(database.admin.db);
});

afterAll(async () => {
  await worker.runtime.stop();
  await provider.close();
  await database.dispose();
});

beforeEach(() => {
  clock.set(new Date());
  provider.requests.length = 0;
  provider.responders.set(EXPO_SEND_PATH, expoOkTickets);
  provider.responders.set(RESEND_PATH, () => ({ status: 200, body: { id: newId() } }));
});

/** Every direct-handler test runs on its own UTC day, far from real time and 40 days apart. */
let nextDay = 0;
function isolatedNoon(): Date {
  nextDay += 1;
  return new Date(Date.UTC(2031, 0, 1) + nextDay * 40 * DAY_MS + 12 * HOUR_MS);
}

function context(logger = captureLogs().logger): JobContext {
  return {
    jobId: newId(),
    queue: 'cost.guard',
    retryCount: 0,
    createdOn: clock.now(),
    singletonKey: null,
    logger,
    signal: new AbortController().signal,
  };
}

function guard(options: { caps?: CostCaps; reader?: UsageReader; metrics?: MetricsRecorder } = {}) {
  const metrics = options.metrics ?? new MetricsRecorder();
  const handler = createCostGuardHandler({
    db: worker.runtime.db,
    clock,
    metrics,
    caps: options.caps ?? CAPS,
    ...(options.reader ? { reader: options.reader } : {}),
  });
  return {
    metrics,
    run: (logger?: ReturnType<typeof captureLogs>['logger']) =>
      handler(scheduledPayload('cost.guard'), context(logger)),
  };
}

async function pushUsage(at: Date, count: number): Promise<void> {
  await database.admin.db.insert(rateLimitBuckets).values({
    key: PUSH_CAP_KEY,
    windowStart: new Date(Math.floor(at.getTime() / HOUR_MS) * HOUR_MS),
    count,
  });
}

async function emailReceipts(at: Date, count: number, queue = 'email.send'): Promise<void> {
  await database.admin.db.insert(jobReceipts).values(
    Array.from({ length: count }, () => ({
      queue,
      idempotencyKey: `email:test:${newId()}`,
      createdAt: at,
    })),
  );
}

async function gateRows(kind: 'email' | 'push') {
  return database.admin.db
    .select({ windowStart: rateLimitBuckets.windowStart })
    .from(rateLimitBuckets)
    .where(eq(rateLimitBuckets.key, gateKey(kind)));
}

describe('cost.guard thresholds (ADR-0081)', () => {
  it('classifies usage against a threshold in integers; 0 disables it', () => {
    expect(meterLevel(1_000_000, 0)).toBe('disabled');
    expect(meterLevel(0, 100)).toBe('ok');
    expect(meterLevel(79, 100)).toBe('ok');
    expect(meterLevel(80, 100)).toBe('warning');
    expect(meterLevel(99, 100)).toBe('warning');
    expect(meterLevel(100, 100)).toBe('exceeded');
    expect(meterLevel(3, 3)).toBe('exceeded');
    expect(meterLevel(2, 3)).toBe('ok');
    expect(meterLevel(4, 5)).toBe('warning');
  });

  it('bounds the UTC day the gates and counters are keyed to', () => {
    const now = new Date('2031-05-20T23:59:59.999Z');
    expect(utcDayStart(now).toISOString()).toBe('2031-05-20T00:00:00.000Z');
    expect(nextUtcMidnight(now).toISOString()).toBe('2031-05-21T00:00:00.000Z');
    expect(utcDayStart(new Date('2031-05-21T00:00:00.000Z')).toISOString()).toBe(
      '2031-05-21T00:00:00.000Z',
    );
  });

  it('keeps every e-mail kind essential and pauses only the deferrable push types', () => {
    for (const kind of EMAIL_KINDS) {
      expect(EMAIL_SEND_CLASS[kind], kind).toBe('essential');
    }
    const essential = NOTIFICATION_TYPES.filter((type) => PUSH_SEND_CLASS[type] === 'essential');
    expect(essential).toEqual(['match.updated', 'rsvp.promoted', 'application.decided']);
  });
});

describe('cost.guard job', () => {
  it('runs on its queue and reports ok below every threshold', async () => {
    const jobId = await worker.runtime.boss.send('cost.guard', scheduledPayload('cost.guard'));
    const job = await waitForJobState(database, 'cost.guard', jobId ?? '', ['completed']);
    expect(job.output).toEqual({ outcome: 'ok' });
  });

  it('reads the push windows of the current UTC day and the e-mail receipts of the day and 30 days', async () => {
    const noon = isolatedNoon();
    clock.set(noon);
    const dayStart = utcDayStart(noon);
    await pushUsage(dayStart, 10);
    await pushUsage(new Date(dayStart.getTime() + 23 * HOUR_MS), 5);
    await pushUsage(new Date(dayStart.getTime() - HOUR_MS), 1_000); // yesterday
    await pushUsage(nextUtcMidnight(noon), 1_000); // tomorrow
    await emailReceipts(new Date(noon.getTime() - MINUTE_MS), 3);
    await emailReceipts(new Date(dayStart.getTime() - MINUTE_MS), 4); // yesterday, within 30 days
    await emailReceipts(new Date(noon.getTime() - 29 * DAY_MS), 5);
    await emailReceipts(new Date(noon.getTime() - 31 * DAY_MS), 50); // outside the window
    await emailReceipts(new Date(noon.getTime() - MINUTE_MS), 7, 'push.send'); // other queue

    const usage = await createDbUsageReader(worker.runtime.db).read(noon);
    expect(usage).toEqual({ emailDay: 3, emailRolling30d: 12, pushDay: 15 });
  });

  it('warns once per UTC day at 80 percent without pausing anything', async () => {
    const noon = isolatedNoon();
    clock.set(noon);
    await pushUsage(noon, 160);
    const capture = captureLogs();
    const { run, metrics } = guard();

    expect(await run(capture.logger)).toBe('warning');
    clock.advance(15 * MINUTE_MS);
    expect(await run(capture.logger)).toBe('warning');
    expect(metrics.count('cost_threshold')).toBe(1);
    expect(metrics.count('cost_threshold', { kind: 'push', period: 'day', level: 'warning' })).toBe(
      1,
    );
    const warnings = capture
      .entries()
      .filter((entry) => entry.msg === 'usage threshold at 80 percent');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: 'push', period: 'day', used: 160, cap: 200 });
    expect(await isSendPaused(worker.runtime.db, 'push', clock.now())).toBe(false);

    // The next UTC day has its own counters and its own alert.
    clock.set(new Date(noon.getTime() + DAY_MS));
    await pushUsage(clock.now(), 170);
    expect(await run(capture.logger)).toBe('warning');
    expect(metrics.count('cost_threshold')).toBe(2);
  });

  it('pauses deferrable sends at 100 percent until the next UTC midnight', async () => {
    const noon = isolatedNoon();
    clock.set(noon);
    await pushUsage(noon, 200);
    const capture = captureLogs();
    const { run, metrics } = guard();

    expect(await run(capture.logger)).toBe('paused');
    expect(await run(capture.logger)).toBe('paused');
    expect(metrics.count('cost_threshold', { kind: 'push', level: 'exceeded' })).toBe(1);
    expect(capture.entries().filter((entry) => entry.msg === 'usage threshold exceeded')).toEqual([
      expect.objectContaining({
        level: 50,
        kind: 'push',
        used: 200,
        cap: 200,
        pausedUntil: nextUtcMidnight(noon).toISOString(),
      }),
    ]);
    expect(await gateRows('push')).toContainEqual({ windowStart: utcDayStart(noon) });
    expect(await isSendPaused(worker.runtime.db, 'push', noon)).toBe(true);
    expect(await isSendPaused(worker.runtime.db, 'email', noon)).toBe(false);
    const lastMs = nextUtcMidnight(noon).getTime() - 1;
    expect(await isSendPaused(worker.runtime.db, 'push', new Date(lastMs))).toBe(true);
    expect(await isSendPaused(worker.runtime.db, 'push', nextUtcMidnight(noon))).toBe(false);
  });

  it('closes the e-mail gate when the rolling 30-day threshold is reached', async () => {
    const noon = isolatedNoon();
    clock.set(noon);
    await emailReceipts(new Date(noon.getTime() - 10 * DAY_MS), 10);
    const { run, metrics } = guard({ caps: { emailDaily: 100, emailMonthly: 10, pushDaily: 0 } });
    expect(await run()).toBe('paused');
    expect(
      metrics.count('cost_threshold', { kind: 'email', period: '30d', level: 'exceeded' }),
    ).toBe(1);
    expect(await isSendPaused(worker.runtime.db, 'email', noon)).toBe(true);
    expect(await isSendPaused(worker.runtime.db, 'push', noon)).toBe(false);
  });

  it('ignores disabled thresholds', async () => {
    const noon = isolatedNoon();
    clock.set(noon);
    await pushUsage(noon, 90_000);
    await emailReceipts(noon, 20);
    const { run, metrics } = guard({ caps: { emailDaily: 0, emailMonthly: 0, pushDaily: 0 } });
    expect(await run()).toBe('ok');
    expect(metrics.recorded).toEqual([]);
    expect(await isSendPaused(worker.runtime.db, 'push', noon)).toBe(false);
  });

  it('fails closed for deferrable sends when the counters cannot be read', async () => {
    const noon = isolatedNoon();
    clock.set(noon);
    const capture = captureLogs();
    const { run, metrics } = guard({
      reader: { read: () => Promise.reject(new Error('relation does not exist')) },
    });
    expect(await run(capture.logger)).toBe('failed_closed');
    expect(metrics.count('cost_guard_failed', { reason: 'read_usage' })).toBe(1);
    expect(capture.entries()).toContainEqual(
      expect.objectContaining({
        level: 50,
        msg: 'usage counters unreadable; pausing deferrable sends',
      }),
    );
    expect(await isSendPaused(worker.runtime.db, 'push', noon)).toBe(true);
    expect(await isSendPaused(worker.runtime.db, 'email', noon)).toBe(true);
  });
});

describe('senders behind a closed gate', () => {
  async function sendPush(job: Omit<PushSendJob, 'idempotencyKey'>): Promise<unknown> {
    const jobId = await enqueue(worker.runtime.boss, 'push.send', {
      ...job,
      idempotencyKey: `push:test:${newId()}`,
    });
    return (await waitForJobState(database, 'push.send', jobId ?? '', ['completed'])).output;
  }

  it('drops deferrable pushes, still delivers essential pushes and every e-mail', async () => {
    const now = clock.now();
    await database.admin.db
      .delete(rateLimitBuckets)
      .where(
        and(
          like(rateLimitBuckets.key, 'cost:gate:%'),
          eq(rateLimitBuckets.windowStart, utcDayStart(now)),
        ),
      );
    const captain = await fixtures.user();
    const player = await fixtures.user();
    const teamId = await fixtures.team(captain.id, 'Gece Ligi');
    await fixtures.member(teamId, player.id);
    const matchId = await fixtures.match(teamId, { startsAt: new Date(now.getTime() + DAY_MS) });
    await fixtures.rsvp(matchId, player.id, 'in');
    await fixtures.pushToken(player.id);
    await fixtures.pushToken(captain.id);

    const caps = { emailDaily: 1, emailMonthly: 0, pushDaily: 1 };
    await pushUsage(now, 1);
    await emailReceipts(now, 1);
    expect(await guard({ caps }).run()).toBe('paused');
    expect(await isSendPaused(worker.runtime.db, 'push', now)).toBe(true);
    expect(await isSendPaused(worker.runtime.db, 'email', now)).toBe(true);

    expect(
      await sendPush({ type: 'match.reminder_2h', userId: player.id, refId: matchId }),
    ).toEqual({ outcome: 'cost_paused' });
    expect(
      await sendPush({ type: 'team.member_joined', userId: captain.id, refId: teamId }),
    ).toEqual({ outcome: 'cost_paused' });
    expect(worker.metrics.count('cost_capped', { kind: 'push', type: 'match.reminder_2h' })).toBe(
      1,
    );
    expect(provider.requests.filter((request) => request.path === EXPO_SEND_PATH)).toHaveLength(0);

    expect(await sendPush({ type: 'match.updated', userId: player.id, refId: matchId })).toEqual({
      outcome: 'sent',
    });
    expect(provider.requests.filter((request) => request.path === EXPO_SEND_PATH)).toHaveLength(1);

    const unverified = await fixtures.user({ verified: false });
    const emailJob = await enqueue(worker.runtime.boss, 'email.send', {
      kind: 'verify_email',
      userId: unverified.id,
      requestId: 'req_costguard',
      idempotencyKey: `email:verify:${unverified.id}:${newId()}`,
    });
    const emailDone = await waitForJobState(database, 'email.send', emailJob ?? '', ['completed']);
    expect(emailDone.output).toEqual({ outcome: 'sent' });
    expect(provider.requests.filter((request) => request.path === RESEND_PATH)).toHaveLength(1);
  });

  it('names alert rows per meter and level', () => {
    expect(alertKey({ kind: 'email', period: '30d', used: 1, cap: 1 }, 'exceeded')).toBe(
      'cost:alert:email:30d:exceeded',
    );
    expect(gateKey('push')).toBe('cost:gate:push');
  });
});
