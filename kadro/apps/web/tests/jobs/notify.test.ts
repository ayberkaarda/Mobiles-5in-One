import { newId } from '@kadro/db';

import { LIMITS, pushSendJobSchema } from '@kadro/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  COALESCE_DELAY_MS,
  notifyApplicationDecided,
  notifyApplicationReceived,
  notifyLineupSlotFree,
  notifyMatchUpdated,
  notifyMemberJoined,
  notifyRsvpChanged,
  notifyRsvpPromoted,
  reminderIdempotencyKey,
  scheduleMatchReminders,
} from '../../lib/server/jobs/notify';
import { type StoredJob, storedJobs } from '../support/jobs';
import { type JobsHarness, setupJobsHarness } from './support';

/**
 * Push and reminder producers (ADR-0031, handoff worker-to-web-001 §3, §4): one `push.send` job
 * per recipient with ids only, per-event keys, coalesced types delayed by 10 minutes, and the
 * worker's reminder rule (24 h / 2 h before the start, only while still in the future).
 */

let jobs: JobsHarness;

beforeAll(async () => {
  jobs = await setupJobsHarness('web_jobs_notify');
});

afterAll(async () => {
  await jobs.dispose();
});

/** Runs a producer in its own transaction and returns the jobs it added to `queue`. */
async function produced(
  queue: 'push.send' | 'match.reminder',
  produce: (
    tx: Parameters<Parameters<JobsHarness['app']['db']['transaction']>[0]>[0],
  ) => Promise<unknown>,
): Promise<StoredJob[]> {
  const before = new Set((await storedJobs(jobs.database.url, queue)).map((job) => job.id));
  await jobs.app.db.transaction(async (tx) => {
    await produce(tx);
  });
  return (await storedJobs(jobs.database.url, queue)).filter((job) => !before.has(job.id));
}

const sender = () => jobs.harness.runtime.jobs;

describe('push producers', () => {
  it('notifyMatchUpdated: one job per distinct recipient, ids only, per-event key', async () => {
    const matchId = newId();
    const [a, b] = [newId(), newId()];
    const changedAt = new Date('2026-10-02T18:00:00Z');
    const added = await produced('push.send', (tx) =>
      notifyMatchUpdated(sender(), tx, { matchId, recipientIds: [a, b, a], changedAt }),
    );
    expect(
      added.map((job) => job.data).sort((x, y) => String(x.userId).localeCompare(String(y.userId))),
    ).toEqual(
      [a, b].sort().map((userId) => ({
        type: 'match.updated',
        userId,
        refId: matchId,
        idempotencyKey: `push:match_updated:${matchId}:${userId}:${Math.floor(changedAt.getTime() / 1_000)}`,
      })),
    );
    for (const job of added) {
      expect(pushSendJobSchema.safeParse(job.data).success).toBe(true);
      expect(Object.keys(job.data).sort()).toEqual(['idempotencyKey', 'refId', 'type', 'userId']);
    }
  });

  it('notifyRsvpChanged: coalesced per match and recipient for 10 minutes', async () => {
    const matchId = newId();
    const captain = newId();
    const now = new Date(Date.now() + 60_000);
    const first = await produced('push.send', (tx) =>
      notifyRsvpChanged(sender(), tx, { matchId, recipientIds: [captain], now }),
    );
    const again = await produced('push.send', (tx) =>
      notifyRsvpChanged(sender(), tx, {
        matchId,
        recipientIds: [captain],
        now: new Date(now.getTime() + 60_000),
      }),
    );
    expect(first).toHaveLength(1);
    expect(again).toHaveLength(0);
    expect(first[0]?.singletonKey).toBe(`rsvp:${matchId}:${captain}`);
    expect(first[0]?.startAfter.getTime()).toBe(now.getTime() + COALESCE_DELAY_MS);
  });

  it('notifyApplicationReceived: coalesced per call and recipient, refId is the application', async () => {
    const openCallId = newId();
    const [captain, coCaptain] = [newId(), newId()];
    const now = new Date(Date.now() + 60_000);
    const applicationId = newId();
    const added = await produced('push.send', (tx) =>
      notifyApplicationReceived(sender(), tx, {
        openCallId,
        applicationId,
        recipientIds: [captain, coCaptain],
        now,
      }),
    );
    const repeat = await produced('push.send', (tx) =>
      notifyApplicationReceived(sender(), tx, {
        openCallId,
        applicationId: newId(),
        recipientIds: [captain],
        now,
      }),
    );
    expect(added.map((job) => job.singletonKey).sort()).toEqual(
      [`application:${openCallId}:${captain}`, `application:${openCallId}:${coCaptain}`].sort(),
    );
    expect(added.every((job) => job.data.refId === applicationId)).toBe(true);
    expect(
      added.every((job) => job.startAfter.getTime() === now.getTime() + COALESCE_DELAY_MS),
    ).toBe(true);
    expect(repeat).toHaveLength(0);
  });

  it('notifyApplicationDecided: the key the expiry job uses, so a close and an expiry notify once', async () => {
    const applicationId = newId();
    const applicantId = newId();
    const added = await produced('push.send', (tx) =>
      notifyApplicationDecided(sender(), tx, { applicationId, applicantId }),
    );
    const repeat = await produced('push.send', (tx) =>
      notifyApplicationDecided(sender(), tx, { applicationId, applicantId }),
    );
    expect(added.map((job) => job.data)).toEqual([
      {
        type: 'application.decided',
        userId: applicantId,
        refId: applicationId,
        idempotencyKey: `push:decided:${applicationId}`,
      },
    ]);
    expect(repeat).toHaveLength(0);
  });

  it('notifyRsvpPromoted, notifyLineupSlotFree, notifyMemberJoined: per-event keys within 128 chars', async () => {
    const matchId = newId();
    const teamId = newId();
    const [player, captain, leaver, member] = [newId(), newId(), newId(), newId()];
    const at = new Date('2026-10-03T09:30:00Z');
    const added = await produced('push.send', async (tx) => {
      await notifyRsvpPromoted(sender(), tx, { matchId, userId: player, promotedAt: at });
      await notifyLineupSlotFree(sender(), tx, {
        matchId,
        captainId: captain,
        leaverId: leaver,
        leftAt: at,
      });
      await notifyMemberJoined(sender(), tx, {
        teamId,
        captainId: captain,
        memberId: member,
        joinedAt: at,
      });
    });
    expect(
      added
        .map((job) => [job.data.type, job.data.userId, job.data.refId])
        .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    ).toEqual([
      ['lineup.slot_free', captain, matchId],
      ['rsvp.promoted', player, matchId],
      ['team.member_joined', captain, teamId],
    ]);
    for (const job of added) {
      expect(String(job.singletonKey).length).toBeLessThanOrEqual(LIMITS.idempotencyKey.max);
      // Other people's ids appear only in keys, never as payload fields beyond the recipient.
      expect(Object.keys(job.data).sort()).toEqual(['idempotencyKey', 'refId', 'type', 'userId']);
    }
    // A second, later leave from the same player is a new event.
    const later = await produced('push.send', (tx) =>
      notifyLineupSlotFree(sender(), tx, {
        matchId,
        captainId: captain,
        leaverId: leaver,
        leftAt: new Date(at.getTime() + 5_000),
      }),
    );
    expect(later).toHaveLength(1);
  });
});

describe('scheduleMatchReminders (worker rule, ADR-0031)', () => {
  const HOUR = 3_600_000;

  it('plans 24 h and 2 h reminders for a match two days ahead', async () => {
    const now = new Date('2026-10-01T12:00:00Z');
    const match = { id: newId(), startsAt: new Date(now.getTime() + 48 * HOUR) };
    let planned: string[] = [];
    const added = await produced('match.reminder', async (tx) => {
      planned = await scheduleMatchReminders(sender(), tx, match, now);
    });
    expect(planned).toEqual(['24h', '2h']);
    added.sort((x, y) => x.startAfter.getTime() - y.startAfter.getTime());
    expect(
      added.map((job) => [job.data.reminder, job.startAfter.getTime(), job.singletonKey]),
    ).toEqual([
      [
        '24h',
        match.startsAt.getTime() - 24 * HOUR,
        reminderIdempotencyKey(match.id, '24h', match.startsAt),
      ],
      [
        '2h',
        match.startsAt.getTime() - 2 * HOUR,
        reminderIdempotencyKey(match.id, '2h', match.startsAt),
      ],
    ]);
    expect(added[0]?.data).toEqual({
      matchId: match.id,
      reminder: '24h',
      startsAt: match.startsAt.toISOString(),
      idempotencyKey: `reminder:${match.id}:24h:${match.startsAt.getTime()}`,
    });
  });

  it('skips reminders whose time has passed', async () => {
    const now = new Date('2026-10-01T12:00:00Z');
    const soon = { id: newId(), startsAt: new Date(now.getTime() + 20 * HOUR) };
    const verySoon = { id: newId(), startsAt: new Date(now.getTime() + 90 * 60_000) };
    expect(
      (
        await produced('match.reminder', (tx) => scheduleMatchReminders(sender(), tx, soon, now))
      ).map((job) => job.data.reminder),
    ).toEqual(['2h']);
    expect(
      await produced('match.reminder', (tx) => scheduleMatchReminders(sender(), tx, verySoon, now)),
    ).toEqual([]);
  });

  it('plans new keys after a reschedule and keeps the old jobs for the worker to skip', async () => {
    const now = new Date('2026-10-01T12:00:00Z');
    const id = newId();
    const first = await produced('match.reminder', (tx) =>
      scheduleMatchReminders(
        sender(),
        tx,
        { id, startsAt: new Date(now.getTime() + 72 * HOUR) },
        now,
      ),
    );
    const moved = await produced('match.reminder', (tx) =>
      scheduleMatchReminders(
        sender(),
        tx,
        { id, startsAt: new Date(now.getTime() + 96 * HOUR) },
        now,
      ),
    );
    expect(first).toHaveLength(2);
    expect(moved).toHaveLength(2);
    expect(new Set([...first, ...moved].map((job) => job.singletonKey)).size).toBe(4);
  });
});
