import { matches, newId } from '@kadro/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { HOUR_MS, MINUTE_MS } from '../src/clock.js';
import { enqueue } from '../src/enqueue.js';
import { planMatchReminders, reminderIdempotencyKey } from '../src/reminders/plan.js';
import {
  type FakeProvider,
  Fixtures,
  MutableClock,
  type TestDatabase,
  type TestWorker,
  createTestDatabase,
  jobsIn,
  startFakeProvider,
  startTestWorker,
  waitForJobState,
} from './support.js';

describe('planMatchReminders', () => {
  const now = new Date('2031-06-10T09:00:00.000Z');
  const id = newId();

  it('plans T-24 h and T-2 h for a match two days ahead', () => {
    const startsAt = new Date(now.getTime() + 48 * HOUR_MS);
    const plans = planMatchReminders({ id, startsAt }, now);
    expect(plans.map((plan) => plan.payload.reminder)).toEqual(['24h', '2h']);
    expect(plans[0]?.startAfter).toEqual(new Date(startsAt.getTime() - 24 * HOUR_MS));
    expect(plans[1]?.startAfter).toEqual(new Date(startsAt.getTime() - 2 * HOUR_MS));
    expect(plans[0]?.payload).toEqual({
      matchId: id,
      reminder: '24h',
      startsAt: startsAt.toISOString(),
      idempotencyKey: `reminder:${id}:24h:${startsAt.getTime()}`,
    });
  });

  it('skips reminders whose time has passed', () => {
    const in20h = new Date(now.getTime() + 20 * HOUR_MS);
    expect(planMatchReminders({ id, startsAt: in20h }, now).map((p) => p.payload.reminder)).toEqual(
      ['2h'],
    );
    const exactly24h = new Date(now.getTime() + 24 * HOUR_MS);
    expect(
      planMatchReminders({ id, startsAt: exactly24h }, now).map((p) => p.payload.reminder),
    ).toEqual(['2h']);
    const in90min = new Date(now.getTime() + 90 * MINUTE_MS);
    expect(planMatchReminders({ id, startsAt: in90min }, now)).toEqual([]);
  });

  it('derives a new key when the match is rescheduled', () => {
    const first = new Date(now.getTime() + 30 * HOUR_MS);
    const second = new Date(first.getTime() + HOUR_MS);
    expect(reminderIdempotencyKey(id, '2h', first)).not.toBe(
      reminderIdempotencyKey(id, '2h', second),
    );
    // A reschedule within the same second still changes the key (handoff matches-to-worker-001).
    const sameSecond = new Date(first.getTime() + 250);
    expect(reminderIdempotencyKey(id, '2h', sameSecond)).not.toBe(
      reminderIdempotencyKey(id, '2h', first),
    );
    expect(reminderIdempotencyKey(id, '2h', sameSecond)).toBe(
      `reminder:${id}:2h:${sameSecond.getTime()}`,
    );
  });
});

describe('match.reminder (ADR-0031)', () => {
  let database: TestDatabase;
  let provider: FakeProvider;
  let worker: TestWorker;
  let fixtures: Fixtures;
  const clock = new MutableClock(new Date());

  beforeAll(async () => {
    database = await createTestDatabase('worker_reminder');
    provider = await startFakeProvider();
    worker = await startTestWorker(database, provider, { clock });
    fixtures = new Fixtures(database.admin.db);
  });

  afterAll(async () => {
    await worker.runtime.stop();
    await provider.close();
    await database.dispose();
  });

  beforeEach(() => {
    clock.set(new Date());
  });

  async function matchWithRoster(startsAt: Date) {
    const captain = await fixtures.user();
    const teamId = await fixtures.team(captain.id);
    const matchId = await fixtures.match(teamId, { startsAt });
    const roster: Record<string, string> = {};
    for (const [label, status, deactivated] of [
      ['in1', 'in', false],
      ['in2', 'in', false],
      ['maybe', 'maybe', false],
      ['out', 'out', false],
      ['waitlist', 'waitlist', false],
      ['inDeactivated', 'in', true],
    ] as const) {
      const user = await fixtures.user(deactivated ? { deactivatedAt: new Date() } : {});
      await fixtures.member(teamId, user.id);
      await fixtures.rsvp(matchId, user.id, status);
      roster[label] = user.id;
    }
    return { matchId, roster };
  }

  async function pushJobsFor(matchId: string) {
    return (await jobsIn(database, 'push.send')).filter((job) => job.data.refId === matchId);
  }

  async function runReminder(matchId: string, reminder: '24h' | '2h', startsAt: Date) {
    const jobId = await enqueue(worker.runtime.boss, 'match.reminder', {
      matchId,
      reminder,
      startsAt: startsAt.toISOString(),
      idempotencyKey: reminderIdempotencyKey(matchId, reminder, startsAt),
    });
    return waitForJobState(database, 'match.reminder', jobId ?? '', ['completed']);
  }

  it('defers the planned jobs until starts_at minus the lead time', async () => {
    const startsAt = new Date(Date.now() + 48 * HOUR_MS);
    const { matchId } = await matchWithRoster(startsAt);
    for (const plan of planMatchReminders({ id: matchId, startsAt }, clock.now())) {
      await enqueue(worker.runtime.boss, 'match.reminder', plan.payload, {
        startAfter: plan.startAfter,
      });
    }
    const jobs = (await jobsIn(database, 'match.reminder')).filter(
      (job) => job.data.matchId === matchId,
    );
    expect(jobs.map((job) => [job.data.reminder, job.state, job.startAfter.getTime()])).toEqual([
      ['24h', 'created', startsAt.getTime() - 24 * HOUR_MS],
      ['2h', 'created', startsAt.getTime() - 2 * HOUR_MS],
    ]);
  });

  it('notifies only confirmed, active players two hours before', async () => {
    const startsAt = new Date(Date.now() + 2 * HOUR_MS);
    const { matchId, roster } = await matchWithRoster(startsAt);
    const job = await runReminder(matchId, '2h', startsAt);
    expect(job.output).toEqual({ outcome: 'fanned_out' });
    const pushes = await pushJobsFor(matchId);
    expect(pushes.map((push) => push.data.userId).sort()).toEqual([roster.in1, roster.in2].sort());
    expect(pushes.every((push) => push.data.type === 'match.reminder_2h')).toBe(true);
  });

  it('adds maybe answers to the 24-hour reminder', async () => {
    const startsAt = new Date(Date.now() + 24 * HOUR_MS);
    const { matchId, roster } = await matchWithRoster(startsAt);
    await runReminder(matchId, '24h', startsAt);
    const pushes = await pushJobsFor(matchId);
    expect(pushes.map((push) => push.data.userId).sort()).toEqual(
      [roster.in1, roster.in2, roster.maybe].sort(),
    );
  });

  it('fans out once even when the reminder runs twice', async () => {
    const startsAt = new Date(Date.now() + 3 * HOUR_MS);
    const { matchId } = await matchWithRoster(startsAt);
    expect((await runReminder(matchId, '2h', startsAt)).output).toEqual({ outcome: 'fanned_out' });
    expect((await runReminder(matchId, '2h', startsAt)).output).toEqual({ outcome: 'duplicate' });
    expect(await pushJobsFor(matchId)).toHaveLength(2);
  });

  it('skips cancelled, rescheduled and already started matches', async () => {
    const startsAt = new Date(Date.now() + 2 * HOUR_MS);
    const cancelled = await matchWithRoster(startsAt);
    await database.admin.db
      .update(matches)
      .set({ status: 'cancelled' })
      .where(eq(matches.id, cancelled.matchId));
    expect((await runReminder(cancelled.matchId, '2h', startsAt)).output).toEqual({
      outcome: 'skipped_status',
    });

    const moved = await matchWithRoster(startsAt);
    await database.admin.db
      .update(matches)
      .set({ startsAt: new Date(startsAt.getTime() + HOUR_MS) })
      .where(eq(matches.id, moved.matchId));
    expect((await runReminder(moved.matchId, '2h', startsAt)).output).toEqual({
      outcome: 'skipped_rescheduled',
    });

    const started = await matchWithRoster(startsAt);
    clock.advance(2 * HOUR_MS + MINUTE_MS);
    expect((await runReminder(started.matchId, '2h', startsAt)).output).toEqual({
      outcome: 'skipped_stale',
    });

    for (const matchId of [cancelled.matchId, moved.matchId, started.matchId]) {
      expect(await pushJobsFor(matchId)).toHaveLength(0);
    }
  });
});
