import { randomBytes } from 'node:crypto';

import {
  deletionRequests,
  emailTokens,
  jobReceipts,
  pushResends,
  newId,
  openCallApplications,
  openCalls,
  pushTokens,
  rateLimitBuckets,
  refreshTokens,
} from '@kadro/db';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { scheduledPayload } from '../src/boss.js';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../src/clock.js';
import { sha256Hex } from '../src/email/tokens.js';
import { decidedIdempotencyKey, expireOpenCalls } from '../src/opencalls/expire.js';
import { SCHEDULE_TIME_ZONE } from '../src/queues.js';
import {
  EXPO_SEND_PATH,
  type FakeProvider,
  Fixtures,
  MutableClock,
  type TestDatabase,
  type TestWorker,
  createTestDatabase,
  jobsIn,
  startFakeProvider,
  startTestWorker,
  waitFor,
  waitForJobState,
} from './support.js';

let database: TestDatabase;
let provider: FakeProvider;
let worker: TestWorker;
let fixtures: Fixtures;
const clock = new MutableClock(new Date());

beforeAll(async () => {
  database = await createTestDatabase('worker_scheduled');
  provider = await startFakeProvider();
  worker = await startTestWorker(database, provider, { clock });
  fixtures = new Fixtures(database.admin.db);
});

afterAll(async () => {
  await worker.runtime.stop();
  await provider.close();
  await database.dispose();
});

async function runScheduled(queue: 'opencall.expire' | 'maintenance.sweep') {
  const jobId = await worker.runtime.boss.send(queue, scheduledPayload(queue));
  return waitForJobState(database, queue, jobId ?? '', ['completed']);
}

describe('cron schedules', () => {
  it('fire at minute 5 and 35 of every hour, Istanbul time', () => {
    const from = new Date('2031-01-15T21:50:00.000Z'); // 00:50 in Istanbul (UTC+3)
    const expire = worker.runtime.boss.previewSchedule('5 * * * *', {
      tz: SCHEDULE_TIME_ZONE,
      from,
      count: 2,
    });
    expect(expire.map((date) => date.toISOString())).toEqual([
      '2031-01-15T22:05:00.000Z',
      '2031-01-15T23:05:00.000Z',
    ]);
    const sweep = worker.runtime.boss.previewSchedule('35 * * * *', {
      tz: SCHEDULE_TIME_ZONE,
      from,
      count: 1,
    });
    expect(sweep.map((date) => date.toISOString())).toEqual(['2031-01-15T22:35:00.000Z']);
  });
});

describe('opencall.expire (ADR-0037)', () => {
  it('expires due calls, rejects their pending applications and notifies each applicant', async () => {
    clock.set(new Date());
    const captain = await fixtures.user();
    const teamId = await fixtures.team(captain.id, 'Gece Ligi');
    const matchId = await fixtures.match(teamId, { startsAt: new Date(Date.now() + DAY_MS) });
    const otherMatchId = await fixtures.match(teamId, {
      startsAt: new Date(Date.now() + 2 * DAY_MS),
    });
    const expiredCall = await fixtures.openCall(matchId, new Date(Date.now() - MINUTE_MS));
    const liveCall = await fixtures.openCall(otherMatchId, new Date(Date.now() + HOUR_MS));

    const applicants = await Promise.all([1, 2, 3, 4, 5].map(() => fixtures.user()));
    const [a1, a2, a3, a4, a5] = applicants.map((user) => user.id);
    const pending1 = await fixtures.application(expiredCall, a1 ?? '');
    const pending2 = await fixtures.application(expiredCall, a2 ?? '');
    const accepted = await fixtures.application(expiredCall, a3 ?? '', 'accepted');
    const withdrawn = await fixtures.application(expiredCall, a4 ?? '', 'withdrawn');
    const livePending = await fixtures.application(liveCall, a5 ?? '');
    const device = await fixtures.pushToken(a1 ?? '');

    const job = await runScheduled('opencall.expire');
    expect(job.output).toEqual({ outcome: 'expired' });

    const calls = await database.admin.db
      .select({ id: openCalls.id, status: openCalls.status })
      .from(openCalls)
      .where(inArray(openCalls.id, [expiredCall, liveCall]));
    expect(Object.fromEntries(calls.map((call) => [call.id, call.status]))).toEqual({
      [expiredCall]: 'expired',
      [liveCall]: 'open',
    });
    const applications = await database.admin.db
      .select({ id: openCallApplications.id, status: openCallApplications.status })
      .from(openCallApplications)
      .where(
        inArray(openCallApplications.id, [pending1, pending2, accepted, withdrawn, livePending]),
      );
    expect(Object.fromEntries(applications.map((row) => [row.id, row.status]))).toEqual({
      [pending1]: 'rejected',
      [pending2]: 'rejected',
      [accepted]: 'accepted',
      [withdrawn]: 'withdrawn',
      [livePending]: 'pending',
    });

    const pushes = (await jobsIn(database, 'push.send')).filter(
      (row) => row.data.type === 'application.decided',
    );
    expect(pushes.map((row) => row.data.idempotencyKey).sort()).toEqual(
      [decidedIdempotencyKey(pending1), decidedIdempotencyKey(pending2)].sort(),
    );

    // The applicant with a device receives the fixed "not accepted" text.
    const request = await waitFor(async () =>
      provider.requests.find((r) => r.path === EXPO_SEND_PATH),
    );
    const [message] = request.body as { to: string; title: string; body: string }[];
    expect(message?.to).toBe(device.token);
    expect(message?.title).toBe('Başvurun sonuçlandı');
    expect(message?.body).toContain('Gece Ligi');

    // A second run finds nothing and enqueues nothing.
    const again = await runScheduled('opencall.expire');
    expect(again.output).toEqual({ outcome: 'nothing_due' });
    const after = (await jobsIn(database, 'push.send')).filter(
      (row) => row.data.type === 'application.decided',
    );
    expect(after).toHaveLength(2);
  });

  it('treats expires_at equal to now as expired and leaves closed calls alone', async () => {
    const now = new Date(Date.now() + 3 * HOUR_MS);
    clock.set(now);
    const captain = await fixtures.user();
    const teamId = await fixtures.team(captain.id);
    const m1 = await fixtures.match(teamId, { startsAt: new Date(now.getTime() + DAY_MS) });
    const m2 = await fixtures.match(teamId, { startsAt: new Date(now.getTime() + DAY_MS) });
    const boundary = await fixtures.openCall(m1, now);
    const closed = await fixtures.openCall(m2, new Date(now.getTime() - HOUR_MS));
    await database.admin.db
      .update(openCalls)
      .set({ status: 'closed' })
      .where(eq(openCalls.id, closed));
    const closedPending = await fixtures.application(closed, (await fixtures.user()).id);

    const result = await expireOpenCalls({
      db: worker.runtime.db,
      boss: worker.runtime.boss,
      clock,
    });
    expect(result.expired).toBeGreaterThanOrEqual(1);
    const [boundaryRow] = await database.admin.db
      .select({ status: openCalls.status })
      .from(openCalls)
      .where(eq(openCalls.id, boundary));
    expect(boundaryRow?.status).toBe('expired');
    const [closedApplication] = await database.admin.db
      .select({ status: openCallApplications.status })
      .from(openCallApplications)
      .where(eq(openCallApplications.id, closedPending));
    expect(closedApplication?.status).toBe('pending');
  });
});

describe('maintenance.sweep (ADR-0028)', () => {
  it('removes expired and retired rows, keeps fresh ones and re-queues overdue deletions', async () => {
    const now = new Date();
    clock.set(now);
    const ago = (ms: number): Date => new Date(now.getTime() - ms);
    const user = await fixtures.user();
    const hash = (): string => sha256Hex(randomBytes(16).toString('hex'));

    const [expiredToken, liveToken] = await database.admin.db
      .insert(emailTokens)
      .values([
        { userId: user.id, purpose: 'reset', tokenHash: hash(), expiresAt: ago(MINUTE_MS) },
        {
          userId: user.id,
          purpose: 'reset',
          tokenHash: hash(),
          expiresAt: new Date(now.getTime() + HOUR_MS),
        },
      ])
      .returning({ id: emailTokens.id });
    const familyId = newId();
    const [oldRevoked, recentRevoked, oldExpired] = await database.admin.db
      .insert(refreshTokens)
      .values([
        {
          userId: user.id,
          tokenHash: hash(),
          client: 'mobile',
          familyId,
          expiresAt: new Date(now.getTime() + DAY_MS),
          revokedAt: ago(31 * DAY_MS),
        },
        {
          userId: user.id,
          tokenHash: hash(),
          client: 'mobile',
          familyId,
          expiresAt: new Date(now.getTime() + DAY_MS),
          revokedAt: ago(DAY_MS),
        },
        {
          userId: user.id,
          tokenHash: hash(),
          client: 'web',
          familyId: newId(),
          expiresAt: ago(31 * DAY_MS),
        },
      ])
      .returning({ id: refreshTokens.id });
    const [oldBucket, freshBucket] = await database.admin.db
      .insert(rateLimitBuckets)
      .values([
        { key: `auth:ip:${newId()}`, windowStart: ago(3 * DAY_MS), count: 2 },
        { key: `auth:ip:${newId()}`, windowStart: ago(HOUR_MS), count: 2 },
      ])
      .returning({ id: rateLimitBuckets.id });
    const [oldReceipt, freshReceipt] = await database.admin.db
      .insert(jobReceipts)
      .values([
        { queue: 'email.send', idempotencyKey: `old:${newId()}`, createdAt: ago(31 * DAY_MS) },
        { queue: 'email.send', idempotencyKey: `fresh:${newId()}`, createdAt: ago(DAY_MS) },
      ])
      .returning({ id: jobReceipts.id });
    const [oldResend, freshResend] = await database.admin.db
      .insert(pushResends)
      .values(
        [ago(25 * HOUR_MS), ago(HOUR_MS)].map((requestedAt) => ({
          singletonKey: `rsvp:${newId()}:${user.id}`,
          type: 'rsvp.changed' as const,
          userId: user.id,
          refId: newId(),
          requestedAt,
        })),
      )
      .returning({ id: pushResends.id });
    const unseenDevice = await fixtures.pushToken(user.id, ago(61 * DAY_MS));
    const activeDevice = await fixtures.pushToken(user.id, ago(DAY_MS));

    const doomed = await fixtures.user({ deactivatedAt: ago(8 * DAY_MS) });
    const waiting = await fixtures.user({ deactivatedAt: ago(DAY_MS) });
    const [overdue, notYet] = await database.admin.db
      .insert(deletionRequests)
      .values([
        { userId: doomed.id, requestedAt: ago(8 * DAY_MS), graceUntil: ago(DAY_MS) },
        {
          userId: waiting.id,
          requestedAt: ago(DAY_MS),
          graceUntil: new Date(now.getTime() + 6 * DAY_MS),
        },
      ])
      .returning({ id: deletionRequests.id });

    const job = await runScheduled('maintenance.sweep');
    expect(job.output).toEqual({ outcome: 'swept' });

    const ids = async (table: 'email' | 'refresh' | 'bucket' | 'receipt' | 'push') => {
      switch (table) {
        case 'email':
          return (await database.admin.db.select({ id: emailTokens.id }).from(emailTokens)).map(
            (r) => r.id,
          );
        case 'refresh':
          return (await database.admin.db.select({ id: refreshTokens.id }).from(refreshTokens)).map(
            (r) => r.id,
          );
        case 'bucket':
          return (
            await database.admin.db.select({ id: rateLimitBuckets.id }).from(rateLimitBuckets)
          ).map((r) => r.id);
        case 'receipt':
          return (await database.admin.db.select({ id: jobReceipts.id }).from(jobReceipts)).map(
            (r) => r.id,
          );
        case 'push':
          return (await database.admin.db.select({ id: pushTokens.id }).from(pushTokens)).map(
            (r) => r.id,
          );
      }
    };
    expect(await ids('email')).toContain(liveToken?.id);
    expect(await ids('email')).not.toContain(expiredToken?.id);
    expect(await ids('refresh')).toEqual([recentRevoked?.id]);
    expect(await ids('refresh')).not.toContain(oldRevoked?.id);
    expect(await ids('refresh')).not.toContain(oldExpired?.id);
    expect(await ids('bucket')).toContain(freshBucket?.id);
    expect(await ids('bucket')).not.toContain(oldBucket?.id);
    expect(await ids('receipt')).toContain(freshReceipt?.id);
    expect(await ids('receipt')).not.toContain(oldReceipt?.id);
    const resends = (await database.admin.db.select({ id: pushResends.id }).from(pushResends)).map(
      (r) => r.id,
    );
    expect(resends).toContain(freshResend?.id);
    expect(resends).not.toContain(oldResend?.id);
    expect(await ids('push')).toContain(activeDevice.id);
    expect(await ids('push')).not.toContain(unseenDevice.id);

    const deletions = await jobsIn(database, 'account.hard_delete');
    expect(deletions.map((row) => row.data)).toEqual([
      { deletionRequestId: overdue?.id, idempotencyKey: `delete:${overdue?.id}` },
    ]);
    expect(deletions[0]?.singletonKey).toBe(`delete:${overdue?.id}`);
    expect(deletions.some((row) => row.data.deletionRequestId === notYet?.id)).toBe(false);

    // The re-queued job runs the hard delete; afterwards the request is complete, so the next
    // sweep re-queues nothing.
    await waitForJobState(database, 'account.hard_delete', deletions[0]?.id ?? '', ['completed']);
    const [completed] = await database.admin.db
      .select({ completedAt: deletionRequests.completedAt })
      .from(deletionRequests)
      .where(eq(deletionRequests.id, overdue?.id ?? ''));
    expect(completed?.completedAt).not.toBeNull();
    await runScheduled('maintenance.sweep');
    expect(await jobsIn(database, 'account.hard_delete')).toHaveLength(1);
  });
});
