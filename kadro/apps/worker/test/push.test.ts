import { NOTIFICATION_TYPES, type PushSendJob, pushSendJobSchema } from '@kadro/contracts';
import { newId, pushTokens, rateLimitBuckets } from '@kadro/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { HOUR_MS, MINUTE_MS } from '../src/clock.js';
import { enqueue } from '../src/enqueue.js';
import { createLogger } from '../src/logger.js';
import { PUSH_CAP_KEY, hourWindowStart } from '../src/push/cap.js';
import { PUSH_REF_KEY, renderPush } from '../src/push/templates.js';
import { createPushTransport } from '../src/push/transport.js';
import {
  EXPO_RECEIPTS_PATH,
  EXPO_SEND_PATH,
  type FakeProvider,
  Fixtures,
  MutableClock,
  type RecordedRequest,
  type TestDatabase,
  type TestWorker,
  createTestDatabase,
  expoOkTickets,
  jobsIn,
  startFakeProvider,
  startTestWorker,
  waitFor,
  waitForJobState,
} from './support.js';

/** Coalescing window of `rsvp.changed` and `application.received` (ADR-0031). */
const COALESCE_WINDOW_MS = 10 * MINUTE_MS;

let database: TestDatabase;
let provider: FakeProvider;
let worker: TestWorker;
let fixtures: Fixtures;
const clock = new MutableClock(new Date());

beforeAll(async () => {
  database = await createTestDatabase('worker_push');
  provider = await startFakeProvider();
  worker = await startTestWorker(database, provider, {
    clock,
    queueOverrides: {
      'push.send': { retryLimit: 2, retryDelaySeconds: 1, retryBackoff: false },
      'push.receipts': { retryLimit: 1, retryDelaySeconds: 1 },
    },
  });
  fixtures = new Fixtures(database.admin.db);
});

afterAll(async () => {
  await worker.runtime.stop();
  await provider.close();
  await database.dispose();
});

beforeEach(async () => {
  clock.set(new Date());
  provider.requests.length = 0;
  provider.responders.set(EXPO_SEND_PATH, expoOkTickets);
  provider.responders.set(EXPO_RECEIPTS_PATH, () => ({ status: 200, body: { data: {} } }));
  await database.admin.db.delete(rateLimitBuckets).where(eq(rateLimitBuckets.key, PUSH_CAP_KEY));
});

interface Scene {
  readonly captainId: string;
  readonly playerId: string;
  readonly teamId: string;
  readonly matchId: string;
  readonly startsAt: Date;
}

async function scene(): Promise<Scene> {
  const captain = await fixtures.user({ displayName: 'Kaptan Gizli' });
  const player = await fixtures.user({ displayName: 'Oyuncu Gizli' });
  const teamId = await fixtures.team(captain.id, 'Çarşı Spor');
  await fixtures.member(teamId, player.id);
  const startsAt = new Date(Date.now() + 20 * HOUR_MS);
  const matchId = await fixtures.match(teamId, { startsAt });
  await fixtures.rsvp(matchId, player.id, 'in');
  await fixtures.rsvp(matchId, captain.id, 'in');
  return { captainId: captain.id, playerId: player.id, teamId, matchId, startsAt };
}

async function sendPush(job: Omit<PushSendJob, 'idempotencyKey'>): Promise<string> {
  const jobId = await enqueue(worker.runtime.boss, 'push.send', {
    ...job,
    idempotencyKey: `push:test:${newId()}`,
  });
  if (jobId === null) {
    throw new Error('expected a new job');
  }
  return jobId;
}

async function outcomeOf(jobId: string): Promise<unknown> {
  return (await waitForJobState(database, 'push.send', jobId, ['completed'])).output;
}

function sendRequests(): RecordedRequest[] {
  return provider.requests.filter((request) => request.path === EXPO_SEND_PATH);
}

describe('push.send (ADR-0031)', () => {
  it('sends to every device, prunes DeviceNotRegistered tickets and schedules the receipt check', async () => {
    const { playerId, matchId } = await scene();
    const devices = [
      await fixtures.pushToken(playerId),
      await fixtures.pushToken(playerId),
      await fixtures.pushToken(playerId),
    ];
    const dead = devices[1];
    provider.responders.set(EXPO_SEND_PATH, (request) => ({
      status: 200,
      body: {
        data: (request.body as { to: string }[]).map((message) =>
          message.to === dead?.token
            ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }
            : { status: 'ok', id: crypto.randomUUID() },
        ),
      },
    }));

    const sentAt = clock.now();
    const jobId = await sendPush({ type: 'match.reminder_24h', userId: playerId, refId: matchId });
    expect(await outcomeOf(jobId)).toEqual({ outcome: 'sent' });

    const [request] = sendRequests();
    expect(request?.authorization).toBe(`Bearer ${worker.secrets.expoAccessToken}`);
    const messages = request?.body as {
      to: string;
      title: string;
      body: string;
      data: Record<string, string>;
    }[];
    expect(messages).toHaveLength(3);
    expect(messages[0]?.data).toEqual({ type: 'match.reminder_24h', matchId });
    expect(messages[0]?.body).toContain('Çarşı Spor');
    expect(JSON.stringify(messages)).not.toContain('Gizli');

    const remaining = await database.admin.db
      .select({ id: pushTokens.id })
      .from(pushTokens)
      .where(eq(pushTokens.userId, playerId));
    expect(remaining.map((row) => row.id).sort()).toEqual([devices[0]?.id, devices[2]?.id].sort());

    const [receiptsJob] = (await jobsIn(database, 'push.receipts')).filter((job) =>
      String(job.data.idempotencyKey).startsWith(`receipts:${jobId}`),
    );
    expect(receiptsJob?.state).toBe('created');
    expect((receiptsJob?.data.tickets as unknown[]).length).toBe(2);
    const delay = (receiptsJob?.startAfter.getTime() ?? 0) - sentAt.getTime();
    expect(delay).toBeGreaterThanOrEqual(15 * MINUTE_MS - 5_000);
    expect(delay).toBeLessThanOrEqual(15 * MINUTE_MS + 5_000);

    const logText = worker.logs.lines.join('\n');
    for (const device of devices) {
      expect(logText).not.toContain(device.token);
    }
  });

  it('prunes tokens that the receipt check reports as unregistered', async () => {
    const user = await fixtures.user();
    const keep = await fixtures.pushToken(user.id);
    const gone = await fixtures.pushToken(user.id);
    const other = await fixtures.pushToken(user.id);
    const tickets = [keep, gone, other].map((device) => ({
      ticketId: crypto.randomUUID(),
      pushTokenId: device.id,
    }));
    const [okTicket, goneTicket, otherTicket] = tickets;
    provider.responders.set(EXPO_RECEIPTS_PATH, () => ({
      status: 200,
      body: {
        data: {
          [okTicket?.ticketId ?? '']: { status: 'ok' },
          [goneTicket?.ticketId ?? '']: {
            status: 'error',
            details: { error: 'DeviceNotRegistered' },
          },
          [otherTicket?.ticketId ?? '']: { status: 'error', details: { error: 'MessageTooBig' } },
        },
      },
    }));
    const jobId = await enqueue(worker.runtime.boss, 'push.receipts', {
      tickets,
      idempotencyKey: `receipts:${newId()}:0`,
    });
    const job = await waitForJobState(database, 'push.receipts', jobId ?? '', ['completed']);
    expect(job.output).toEqual({ outcome: 'checked' });
    const [receiptRequest] = provider.requests.filter((r) => r.path === EXPO_RECEIPTS_PATH);
    expect((receiptRequest?.body as { ids: string[] }).ids).toHaveLength(3);
    const remaining = await database.admin.db
      .select({ id: pushTokens.id })
      .from(pushTokens)
      .where(eq(pushTokens.userId, user.id));
    expect(remaining.map((row) => row.id).sort()).toEqual([keep.id, other.id].sort());
    expect(worker.metrics.count('push_receipt_error', { code: 'MessageTooBig' })).toBe(1);
  });

  it('drops the notification without calling Expo once the hourly cap is reached', async () => {
    const { playerId, matchId } = await scene();
    await fixtures.pushToken(playerId);
    await fixtures.pushToken(playerId);
    await database.admin.db.insert(rateLimitBuckets).values({
      key: PUSH_CAP_KEY,
      windowStart: hourWindowStart(clock.now()),
      count: 4_999,
    });
    const jobId = await sendPush({ type: 'match.reminder_2h', userId: playerId, refId: matchId });
    expect(await outcomeOf(jobId)).toEqual({ outcome: 'capped' });
    expect(sendRequests()).toHaveLength(0);
    expect(worker.metrics.count('push_capped', { type: 'match.reminder_2h' })).toBe(1);
    const [bucket] = await database.admin.db
      .select({ count: rateLimitBuckets.count })
      .from(rateLimitBuckets)
      .where(
        and(
          eq(rateLimitBuckets.key, PUSH_CAP_KEY),
          eq(rateLimitBuckets.windowStart, hourWindowStart(clock.now())),
        ),
      );
    expect(bucket?.count).toBe(4_999);
  });

  it('counts every message against the hourly window', async () => {
    const { playerId, matchId } = await scene();
    await fixtures.pushToken(playerId);
    await fixtures.pushToken(playerId);
    const jobId = await sendPush({ type: 'match.reminder_2h', userId: playerId, refId: matchId });
    expect(await outcomeOf(jobId)).toEqual({ outcome: 'sent' });
    const [bucket] = await database.admin.db
      .select({ count: rateLimitBuckets.count })
      .from(rateLimitBuckets)
      .where(eq(rateLimitBuckets.key, PUSH_CAP_KEY));
    expect(bucket?.count).toBe(2);
  });

  it('retries when Expo answers 429', async () => {
    const { playerId, matchId } = await scene();
    await fixtures.pushToken(playerId);
    let calls = 0;
    provider.responders.set(EXPO_SEND_PATH, (request) => {
      calls += 1;
      return calls === 1 ? { status: 429 } : expoOkTickets(request);
    });
    const jobId = await sendPush({ type: 'match.reminder_2h', userId: playerId, refId: matchId });
    const job = await waitForJobState(database, 'push.send', jobId, ['completed']);
    expect(job.retryCount).toBe(1);
    expect(job.output).toEqual({ outcome: 'sent' });
  });

  it('resolves the recipient at send time and skips anyone without access', async () => {
    const { captainId, playerId, teamId, matchId } = await scene();
    const outsider = await fixtures.user();
    const deactivated = await fixtures.user({ deactivatedAt: new Date() });
    for (const userId of [captainId, playerId, outsider.id, deactivated.id]) {
      await fixtures.pushToken(userId);
    }
    const callId = await fixtures.openCall(matchId, new Date(Date.now() + HOUR_MS));
    const applicationId = await fixtures.application(callId, outsider.id, 'pending');

    const cases: [Omit<PushSendJob, 'idempotencyKey'>, string][] = [
      [{ type: 'match.reminder_2h', userId: outsider.id, refId: matchId }, 'skipped_not_allowed'],
      [
        { type: 'match.reminder_2h', userId: deactivated.id, refId: matchId },
        'skipped_recipient_inactive',
      ],
      [{ type: 'rsvp.changed', userId: playerId, refId: matchId }, 'skipped_not_allowed'],
      [{ type: 'rsvp.changed', userId: captainId, refId: matchId }, 'sent'],
      [{ type: 'lineup.slot_free', userId: captainId, refId: matchId }, 'sent'],
      [{ type: 'application.received', userId: captainId, refId: applicationId }, 'sent'],
      [
        { type: 'application.received', userId: playerId, refId: applicationId },
        'skipped_not_allowed',
      ],
      [
        { type: 'application.decided', userId: outsider.id, refId: applicationId },
        'skipped_not_decided',
      ],
      [
        { type: 'application.decided', userId: captainId, refId: applicationId },
        'skipped_not_allowed',
      ],
      [{ type: 'team.member_joined', userId: captainId, refId: teamId }, 'sent'],
      [{ type: 'team.member_joined', userId: playerId, refId: teamId }, 'skipped_not_allowed'],
      [{ type: 'match.updated', userId: playerId, refId: newId() }, 'skipped_target_missing'],
    ];
    for (const [job, expected] of cases) {
      const jobId = await sendPush(job);
      expect(await outcomeOf(jobId), `${job.type} → ${expected}`).toEqual({ outcome: expected });
    }
    const bodies = sendRequests().map((request) => JSON.stringify(request.body));
    expect(bodies.join('\n')).not.toContain('Gizli');
  });

  it('completes without sending when the user has no device or the notification is stale', async () => {
    const { captainId, playerId, teamId } = await scene();
    const noDevice = await sendPush({
      type: 'team.member_joined',
      userId: captainId,
      refId: teamId,
    });
    expect(await outcomeOf(noDevice)).toEqual({ outcome: 'no_devices' });

    await fixtures.pushToken(playerId);
    clock.advance(6 * HOUR_MS + MINUTE_MS);
    const stale = await sendPush({ type: 'team.member_joined', userId: captainId, refId: teamId });
    expect(await outcomeOf(stale)).toEqual({ outcome: 'skipped_stale' });
    expect(sendRequests()).toHaveLength(0);
  });

  it('dead-letters an invalid push payload at once', async () => {
    const id = await worker.runtime.boss.send(
      'push.send',
      { type: 'broadcast.all', userId: newId(), refId: newId(), idempotencyKey: `bad:${newId()}` },
      { singletonKey: `bad-${newId()}` },
    );
    const job = await waitForJobState(database, 'push.send', id ?? '', ['failed']);
    expect(job.retryCount).toBe(0);
    await waitFor(async () =>
      (await jobsIn(database, 'push.send.dead')).find((row) => row.data.type === 'broadcast.all'),
    );
  });
});

describe('coalesced push.send windows (ADR-0031)', () => {
  /**
   * The web producer's keys for `rsvp.changed`: `singletonKey` = `rsvp:<matchId>:<recipientId>`
   * coalesces, `idempotencyKey` adds the moment the window opened and is the delivery receipt key.
   */
  async function sendCoalesced(
    target: Scene,
    windowOpenedAt: Date,
    startAfter?: Date,
  ): Promise<string | null> {
    const singletonKey = `rsvp:${target.matchId}:${target.captainId}`;
    const data = pushSendJobSchema.parse({
      type: 'rsvp.changed',
      userId: target.captainId,
      refId: target.matchId,
      idempotencyKey: `${singletonKey}:${windowOpenedAt.getTime()}`,
    });
    return worker.runtime.boss.send('push.send', data, {
      singletonKey,
      ...(startAfter === undefined ? {} : { startAfter }),
    });
  }

  it('sends the next window after a delivered one and drops a repeat inside a window', async () => {
    const current = await scene();
    await fixtures.pushToken(current.captainId);

    const opened = clock.now();
    const first = await sendCoalesced(current, opened);
    expect(await outcomeOf(first ?? '')).toEqual({ outcome: 'sent' });

    // Ten minutes later a new change opens the next window: same coalescing key, new delivery key.
    clock.advance(COALESCE_WINDOW_MS);
    const second = await sendCoalesced(current, clock.now());
    expect(second).not.toBeNull();
    expect(await outcomeOf(second ?? '')).toEqual({ outcome: 'sent' });
    expect(sendRequests()).toHaveLength(2);

    // A replay of a delivered window is still a duplicate (the receipt key is per window).
    const replay = await sendCoalesced(current, opened);
    expect(await outcomeOf(replay ?? '')).toEqual({ outcome: 'duplicate' });
    expect(sendRequests()).toHaveLength(2);

    // Inside an open window the queued job absorbs the repeat.
    clock.advance(COALESCE_WINDOW_MS);
    const queued = await sendCoalesced(
      current,
      clock.now(),
      new Date(Date.now() + COALESCE_WINDOW_MS),
    );
    expect(queued).not.toBeNull();
    clock.advance(MINUTE_MS);
    expect(await sendCoalesced(current, clock.now())).toBeNull();
  });
});

describe('push templates (ADR-0031)', () => {
  it('render every notification type from team name, time and counts only', () => {
    const startsAt = new Date('2031-05-04T18:00:00.000Z');
    expect(NOTIFICATION_TYPES).toHaveLength(9);
    for (const type of NOTIFICATION_TYPES) {
      const content = renderPush(type, { teamName: 'Mahalle FK', startsAt, count: 7 });
      expect(content.title.length, type).toBeGreaterThan(0);
      expect(content.body.length, type).toBeLessThanOrEqual(178);
      expect(`${content.title} ${content.body}`).not.toMatch(/@|https?:|₺|TL\b/);
      expect(PUSH_REF_KEY[type]).toMatch(/^(matchId|teamId|applicationId)$/);
    }
    expect(renderPush('match.reminder_24h', { teamName: 'Mahalle FK', startsAt }).title).toBe(
      'Maç yarın, saat 21:00',
    );
    expect(
      renderPush('match.updated', { teamName: 'Mahalle FK', startsAt, variant: 'cancelled' }).title,
    ).toBe('Maç iptal edildi');
    expect(
      renderPush('application.decided', { teamName: 'Mahalle FK', startsAt, variant: 'accepted' })
        .title,
    ).toBe('Başvurun kabul edildi');
  });

  it('refuses the log transport outside APP_ENV=local', () => {
    const logger = createLogger({ level: 'silent', buildSha: 'test', appEnv: 'preview' });
    expect(() =>
      createPushTransport(
        { APP_ENV: 'preview', PUSH_TRANSPORT: 'log' },
        { logger, fetch: globalThis.fetch },
      ),
    ).toThrow(/APP_ENV=local/);
  });
});
