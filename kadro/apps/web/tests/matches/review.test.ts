import {
  matchDetailSchema,
  matchGuestViewSchema,
  matchMemberViewSchema,
  type MatchMemberView,
} from '@kadro/contracts';
import { matchRsvps, openCallApplications, openCalls, teamMembers } from '@kadro/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { expectProblem } from '../support/http';
import { account } from '../teams/support';
import {
  addPlayer,
  asAdmin,
  DAY_MS,
  expectJson,
  inDays,
  insertRsvp,
  jobsFor,
  matchApi,
  type MatchesHarness,
  matchRow,
  matchWorld,
  rsvpRow,
  setupMatchesHarness,
} from './support';

/**
 * Follow-up rules of the match endpoints: waitlist promotion on combined updates and reopening
 * (ADR-0035), slot reductions that would break the confirmed count or the stored lineup, one
 * consistent snapshot for `GET matches/:id`, millisecond reschedules of reminders, and the open
 * call closed through the shared calls helper (ADR-0037).
 */

let t: MatchesHarness;

beforeAll(async () => {
  t = await setupMatchesHarness('web_matches_review');
});

afterAll(async () => {
  await t.dispose();
});

async function queue(teamId: string, matchId: string, minutesAgo: number) {
  const member = await addPlayer(t, teamId);
  await insertRsvp(t, matchId, member.id, 'waitlist', {
    waitlistedAt: new Date(t.harness.runtime.now().getTime() - minutesAgo * 60_000),
  });
  return member;
}

/**
 * Runs `hook` once, right before the first query of the domain pool whose SQL text satisfies
 * `matches`, so a concurrent commit can be placed exactly between two reads of one request.
 */
function beforeQuery(matches: (text: string) => boolean, hook: () => Promise<void>): () => void {
  const prototype = (t.jobs.app.pool as unknown as { Client: { prototype: { query: unknown } } })
    .Client.prototype;
  const original = prototype.query as (...args: unknown[]) => unknown;
  let armed = true;
  prototype.query = function query(this: unknown, ...args: unknown[]) {
    const first = args[0];
    const text =
      typeof first === 'string'
        ? first
        : typeof first === 'object' && first !== null && 'text' in first
          ? String((first as { text: unknown }).text)
          : '';
    if (armed && matches(text)) {
      armed = false;
      const pending = hook().then(() => original.apply(this, args));
      // Callback-style callers receive the result through their callback.
      return typeof args.at(-1) === 'function' ? undefined : pending;
    }
    return original.apply(this, args);
  };
  return () => {
    prototype.query = original;
  };
}

describe('ADR-0035: promotion on combined updates and reopening', () => {
  it('more slots together with the lock promote the waitlist first, then lock', async () => {
    const world = await matchWorld(t, { slots: 4 });
    const first = await queue(world.teamId, world.matchId, 5);
    const second = await queue(world.teamId, world.matchId, 2);
    const view = matchMemberViewSchema.parse(
      await expectJson(
        await matchApi.update(world.captain.headers, world.matchId, { slots: 6, status: 'locked' }),
        200,
      ),
    );
    expect(view.status).toBe('locked');
    expect(view.lockedAt).not.toBeNull();
    expect((await rsvpRow(t, world.matchId, first.id))?.status).toBe('in');
    expect((await rsvpRow(t, world.matchId, second.id))?.status).toBe('in');
  });

  it('reopening a match with free slots promotes the oldest waiting player', async () => {
    const world = await matchWorld(t, { status: 'locked', slots: 5 });
    const older = await queue(world.teamId, world.matchId, 9);
    const newer = await queue(world.teamId, world.matchId, 3);
    await expectJson(
      await matchApi.update(world.captain.headers, world.matchId, { status: 'open' }),
      200,
    );
    expect((await rsvpRow(t, world.matchId, older.id))?.status).toBe('in');
    expect((await rsvpRow(t, world.matchId, newer.id))?.status).toBe('waitlist');
    const promoted = (await jobsFor(t, 'push.send', world.matchId)).filter(
      (job) => job.data.type === 'rsvp.promoted',
    );
    expect(promoted.map((job) => job.data.userId)).toEqual([older.id]);
  });
});

describe('slot reductions (ADR-0035)', () => {
  it('below the confirmed count is 409 slots_below_confirmed', async () => {
    const world = await matchWorld(t);
    await expectProblem(
      await matchApi.update(world.captain.headers, world.matchId, { slots: 3 }),
      409,
      'slots_below_confirmed',
    );
    expect((await matchRow(t, world.matchId))?.slots).toBe(10);
  });

  it('below the stored lineup of one side is 409 slots_below_lineup', async () => {
    const world = await matchWorld(t);
    await expectJson(
      await matchApi.lineup(world.captain.headers, world.matchId, {
        sides: [world.captain, world.coCaptain, world.player, world.guest].map((member) => ({
          userId: member.id,
          side: 'A',
        })),
      }),
      200,
    );
    await expectProblem(
      await matchApi.update(world.captain.headers, world.matchId, { slots: 4 }),
      409,
      'slots_below_lineup',
    );
    expect((await matchRow(t, world.matchId))?.slots).toBe(10);
    // ceil(7 / 2) = 4 still holds the side.
    await expectJson(
      await matchApi.update(world.captain.headers, world.matchId, { slots: 7 }),
      200,
    );
  });
});

describe('GET matches/:id reads one snapshot', () => {
  it('a removal committed after authorization does not change what the response shows', async () => {
    const world = await matchWorld(t, { status: 'locked' });
    const restore = beforeQuery(
      (text) => text.includes('"own_rsvp"') && text.includes('"teams"."name"'),
      async () => {
        await asAdmin(
          t,
          `delete from team_members where user_id = '${world.player.id}'; update match_rsvps set paid = true where user_id = '${world.coCaptain.id}'`,
        );
      },
    );
    let view: MatchMemberView;
    try {
      view = matchMemberViewSchema.parse(
        await expectJson(await matchApi.get(world.player.headers, world.matchId), 200),
      );
    } finally {
      restore();
    }
    const coCaptain = view.participants.find((row) => row.user.id === world.coCaptain.id);
    expect(coCaptain?.paid).toBe(false);
    const [membership] = await t.db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, world.teamId), eq(teamMembers.userId, world.player.id)));
    expect(membership).toBeUndefined();
  });

  it('counts, share and participants come from the same moment', async () => {
    const world = await matchWorld(t, { feeTotalMinor: 1_200 });
    const restore = beforeQuery(
      (text) => text.includes('"users"."display_name"') && text.includes('"match_rsvps"."side"'),
      async () => {
        await asAdmin(
          t,
          `update match_rsvps set status = 'out' where user_id = '${world.player.id}'`,
        );
      },
    );
    let text: string;
    try {
      text = await (await matchApi.get(world.captain.headers, world.matchId)).text();
    } finally {
      restore();
    }
    const view = matchMemberViewSchema.parse(JSON.parse(text));
    const confirmed = view.participants.filter((row) => row.status === 'in').length;
    expect(view.counts.in).toBe(confirmed);
    expect(view.sharePerPlayerMinor).toBe(Math.floor(1_200 / confirmed));
    expect((await rsvpRow(t, world.matchId, world.player.id))?.status).toBe('out');
  });
});

describe('reminders follow a reschedule to the millisecond', () => {
  it('replans under new keys; old jobs carry a start the worker no longer matches', async () => {
    const world = await matchWorld(t);
    const base = new Date(t.harness.runtime.now().getTime() + 3 * DAY_MS);
    base.setUTCMilliseconds(100);
    const created = matchDetailSchema.parse(
      await expectJson(
        await matchApi.create(world.captain.headers, world.teamId, {
          venueText: 'Çankaya Halı Saha',
          startsAt: base.toISOString(),
          format: '7v7',
          feeTotalMinor: 0,
          slots: 10,
          status: 'open',
        }),
        201,
      ),
    );
    const before = await jobsFor(t, 'match.reminder', created.id);
    expect(before).toHaveLength(2);
    const moved = new Date(base.getTime() + 800);
    await expectJson(
      await matchApi.update(world.captain.headers, created.id, { startsAt: moved.toISOString() }),
      200,
    );
    const after = await jobsFor(t, 'match.reminder', created.id);
    const current = after.filter((job) => job.data.startsAt === moved.toISOString());
    expect(current.map((job) => job.data.reminder).sort()).toEqual(['24h', '2h']);
    // The worker sends a reminder only when its startsAt equals the match's (ADR-0028 re-check).
    const stored = (await matchRow(t, created.id))?.startsAt.getTime();
    for (const job of before) {
      expect(Date.parse(String(job.data.startsAt))).not.toBe(stored);
    }
    for (const job of current) {
      expect(Date.parse(String(job.data.startsAt))).toBe(stored);
    }
  });
});

describe('ADR-0037: a match leaving open closes its call through the calls helper', () => {
  for (const [label, leave] of [
    [
      'lock',
      (headers: Record<string, string>, id: string) =>
        matchApi.update(headers, id, { status: 'locked' }),
    ],
    ['cancel', (headers: Record<string, string>, id: string) => matchApi.remove(headers, id)],
  ] as const) {
    it(`${label}: call closed, pending applications rejected, applicants notified`, async () => {
      const world = await matchWorld(t);
      const [call] = await t.db
        .insert(openCalls)
        .values({
          matchId: world.matchId,
          missingCount: 2,
          level: 'casual',
          districtId: t.districtId,
          expiresAt: new Date(inDays(t, 1)),
        })
        .returning({ id: openCalls.id });
      const applicant = await account(t);
      const [application] = await t.db
        .insert(openCallApplications)
        .values({ openCallId: call?.id ?? '', userId: applicant.id })
        .returning({ id: openCallApplications.id });
      expect((await leave(world.captain.headers, world.matchId)).status).toBe(200);
      const [stored] = await t.db
        .select()
        .from(openCalls)
        .where(eq(openCalls.id, call?.id ?? ''));
      expect(stored?.status).toBe('closed');
      const [decided] = await t.db
        .select()
        .from(openCallApplications)
        .where(eq(openCallApplications.id, application?.id ?? ''));
      expect(decided?.status).toBe('rejected');
      const pushes = await jobsFor(t, 'push.send', application?.id ?? '');
      expect(pushes.map((job) => [job.data.type, job.data.userId])).toEqual([
        ['application.decided', applicant.id],
      ]);
    });
  }
});

describe('ADR-0028: jobs commit only with the match write', () => {
  it('a failure after the enqueues rolls back the reschedule and every job it queued', async () => {
    const world = await matchWorld(t);
    const before = {
      pushes: (await jobsFor(t, 'push.send', world.matchId)).length,
      reminders: (await jobsFor(t, 'match.reminder', world.matchId)).length,
      startsAt: (await matchRow(t, world.matchId))?.startsAt.toISOString(),
    };
    // The response projection reads the participants after every enqueue of the update.
    const restore = beforeQuery(
      (text) => text.includes('"users"."display_name"') && text.includes('"match_rsvps"."side"'),
      () => Promise.reject(new Error('injected failure after the enqueues')),
    );
    let response: Response;
    try {
      response = await matchApi.update(world.captain.headers, world.matchId, {
        startsAt: inDays(t, 6),
      });
    } finally {
      restore();
    }
    await expectProblem(response, 500, 'internal_error');
    expect((await jobsFor(t, 'push.send', world.matchId)).length).toBe(before.pushes);
    expect((await jobsFor(t, 'match.reminder', world.matchId)).length).toBe(before.reminders);
    expect((await matchRow(t, world.matchId))?.startsAt.toISOString()).toBe(before.startsAt);
  });
});

describe('ADR-0036: the actor’s exact share', () => {
  it('adds the remainder kuruş by RSVP order; null for an actor who is not in', async () => {
    const world = await matchWorld(t, { status: 'locked', feeTotalMinor: 100_001 });
    // The guest confirmed first, so the one remainder kuruş is theirs.
    await t.db
      .update(matchRsvps)
      .set({ createdAt: new Date(t.harness.runtime.now().getTime() - DAY_MS) })
      .where(and(eq(matchRsvps.matchId, world.matchId), eq(matchRsvps.userId, world.guest.id)));
    const guestText = await (await matchApi.get(world.guest.headers, world.matchId)).text();
    const guest = matchGuestViewSchema.parse(JSON.parse(guestText));
    expect(guest.myShareMinor).toBe(25_001);
    expect(guest.sharePerPlayerMinor).toBe(25_000);
    expect(guestText).not.toContain('feeTotalMinor');
    expect(guestText).not.toContain('"paid"');
    const captain = matchMemberViewSchema.parse(
      await expectJson(await matchApi.get(world.captain.headers, world.matchId), 200),
    );
    expect(captain.myShareMinor).toBe(25_000);
    const notIn = matchMemberViewSchema.parse(
      await expectJson(await matchApi.get(world.modPlayer.headers, world.matchId), 200),
    );
    expect(notIn.myShareMinor).toBeNull();
  });
});
