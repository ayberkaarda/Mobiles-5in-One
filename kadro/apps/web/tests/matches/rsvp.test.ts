import { ownRsvpSchema } from '@kadro/contracts';
import { matchRsvps } from '@kadro/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { COALESCE_DELAY_MS } from '../../lib/server/jobs/notify';
import { expectProblem } from '../support/http';
import { type Account, account } from '../teams/support';
import {
  type Actor,
  addPlayer,
  asAdmin,
  auditRows,
  confirmedIds,
  expectJson,
  headersOf,
  HOUR_MS,
  insertGuest,
  insertRsvp,
  jobsFor,
  matchApi,
  type MatchesHarness,
  matchWorld,
  rsvpRow,
  setupMatchesHarness,
} from './support';

/**
 * `PUT matches/:id/rsvp` (matrix §3.4 `rsvp.set`, footnote 14; ADR-0035, ADR-0036): own row only,
 * waitlist by server-assigned `waitlisted_at`, oldest-first promotion, guests never waitlisted,
 * `out` only once locked, paid cleared and audited on leaving, notifications enqueued in the same
 * transaction, and no over-booking under concurrent requests.
 */

let t: MatchesHarness;

beforeAll(async () => {
  t = await setupMatchesHarness('web_matches_rsvp');
});

afterAll(async () => {
  await t.dispose();
});

async function waitlisted(teamId: string, matchId: string, minutesAgo: number): Promise<Account> {
  const member = await addPlayer(t, teamId);
  await insertRsvp(t, matchId, member.id, 'waitlist', {
    waitlistedAt: new Date(t.harness.runtime.now().getTime() - minutesAgo * 60_000),
  });
  return member;
}

describe('PUT /api/v1/matches/[id]/rsvp', () => {
  it('confirms with a free slot and tells the staff (coalesced rsvp.changed)', async () => {
    const world = await matchWorld(t);
    const member = await addPlayer(t, world.teamId);
    const now = t.harness.runtime.now();
    const own = ownRsvpSchema.parse(
      await expectJson(await matchApi.rsvp(member.headers, world.matchId, 'in'), 200),
    );
    expect(own).toMatchObject({ matchId: world.matchId, status: 'in', side: null });
    const changed = (await jobsFor(t, 'push.send', world.matchId)).filter(
      (job) => job.data.type === 'rsvp.changed',
    );
    expect(changed.map((job) => job.data.userId).sort()).toEqual(
      [world.captain.id, world.coCaptain.id].sort(),
    );
    for (const job of changed) {
      expect(job.singletonKey).toBe(`rsvp:${world.matchId}:${String(job.data.userId)}`);
      expect(job.startAfter.getTime()).toBe(now.getTime() + COALESCE_DELAY_MS);
    }
    // The staff member who answers is not told about their own answer.
    await expectJson(await matchApi.rsvp(world.captain.headers, world.matchId, 'maybe'), 200);
  });

  it('puts a member on the waitlist when full; re-sending in keeps the place', async () => {
    const world = await matchWorld(t, { slots: 4 });
    const member = await addPlayer(t, world.teamId);
    const first = ownRsvpSchema.parse(
      await expectJson(await matchApi.rsvp(member.headers, world.matchId, 'in'), 200),
    );
    expect(first.status).toBe('waitlist');
    const queued = (await rsvpRow(t, world.matchId, member.id))?.waitlistedAt;
    expect(queued?.toISOString()).toBe(t.harness.runtime.now().toISOString());
    t.harness.advance(60_000);
    await expectJson(await matchApi.rsvp(member.headers, world.matchId, 'in'), 200);
    expect((await rsvpRow(t, world.matchId, member.id))?.waitlistedAt).toEqual(queued);
    // Leaving the waitlist clears the position; re-joining goes to the end.
    await expectJson(await matchApi.rsvp(member.headers, world.matchId, 'maybe'), 200);
    expect((await rsvpRow(t, world.matchId, member.id))?.waitlistedAt).toBeNull();
  });

  it('never waitlists a guest: 409 match_full without a free slot', async () => {
    const world = await matchWorld(t, { slots: 4, guestStatus: 'out' });
    await insertRsvp(t, world.matchId, (await addPlayer(t, world.teamId)).id, 'in');
    await expectProblem(
      await matchApi.rsvp(world.guest.headers, world.matchId, 'in'),
      409,
      'match_full',
    );
    expect((await rsvpRow(t, world.matchId, world.guest.id))?.status).toBe('out');
    await expectJson(await matchApi.rsvp(world.player.headers, world.matchId, 'out'), 200);
    const back = ownRsvpSchema.parse(
      await expectJson(await matchApi.rsvp(world.guest.headers, world.matchId, 'in'), 200),
    );
    expect(back.status).toBe('in');
  });

  it('leaving promotes the oldest waitlisted_at, clears side and paid, audits the clearing', async () => {
    const world = await matchWorld(t, { slots: 4 });
    // Created first but queued later: the queue order is waitlisted_at, not creation or id.
    const later = await waitlisted(world.teamId, world.matchId, 1);
    const earlier = await waitlisted(world.teamId, world.matchId, 5);
    const rsvpId = (await rsvpRow(t, world.matchId, world.player.id))?.id ?? '';
    await t.db.update(matchRsvps).set({ side: 'A', paid: true }).where(eq(matchRsvps.id, rsvpId));
    await expectJson(await matchApi.rsvp(world.player.headers, world.matchId, 'out'), 200);
    const left = await rsvpRow(t, world.matchId, world.player.id);
    expect(left).toMatchObject({ status: 'out', side: null, paid: false, waitlistedAt: null });
    expect((await rsvpRow(t, world.matchId, earlier.id))?.status).toBe('in');
    expect((await rsvpRow(t, world.matchId, earlier.id))?.waitlistedAt).toBeNull();
    expect((await rsvpRow(t, world.matchId, later.id))?.status).toBe('waitlist');
    const promoted = (await jobsFor(t, 'push.send', world.matchId)).filter(
      (job) => job.data.type === 'rsvp.promoted',
    );
    expect(promoted.map((job) => job.data.userId)).toEqual([earlier.id]);
    const audits = await auditRows(t, rsvpId);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'payment.mark',
      actorId: world.player.id,
      targetType: 'match_rsvp',
      metadata: {
        matchId: world.matchId,
        targetUserId: world.player.id,
        paid: false,
        selfMark: true,
        reason: 'rsvp_left',
      },
    });
  });

  it('a locked match accepts only out, which promotes and tells the captain a slot is free', async () => {
    const world = await matchWorld(t, { status: 'locked', slots: 4 });
    const queued = await waitlisted(world.teamId, world.matchId, 3);
    const member = await addPlayer(t, world.teamId);
    for (const choice of ['in', 'maybe'] as const) {
      await expectProblem(
        await matchApi.rsvp(member.headers, world.matchId, choice),
        409,
        'match_not_open',
      );
    }
    await expectJson(await matchApi.rsvp(world.player.headers, world.matchId, 'out'), 200);
    expect((await rsvpRow(t, world.matchId, queued.id))?.status).toBe('in');
    const pushes = await jobsFor(t, 'push.send', world.matchId);
    const slotFree = pushes.filter((job) => job.data.type === 'lineup.slot_free');
    expect(slotFree.map((job) => job.data.userId)).toEqual([world.captain.id]);
    expect(slotFree[0]?.singletonKey).toContain(world.player.id);
    expect(pushes.some((job) => job.data.type === 'rsvp.promoted')).toBe(true);
  });

  it('refuses draft, played, cancelled and started matches with 409 match_not_open', async () => {
    for (const options of [
      { status: 'draft' as const },
      { status: 'played' as const },
      { status: 'cancelled' as const },
      { status: 'open' as const, startsAt: new Date(t.harness.runtime.now().getTime() - HOUR_MS) },
    ]) {
      const world = await matchWorld(t, options);
      await expectProblem(
        await matchApi.rsvp(world.player.headers, world.matchId, 'out'),
        409,
        'match_not_open',
      );
      expect((await rsvpRow(t, world.matchId, world.player.id))?.status).toBe('in');
    }
  });

  it('answers every relationship cell; a stray RSVP of a former member grants nothing', async () => {
    const cells: Record<Actor, readonly [number, string?]> = {
      anon: [401, 'unauthenticated'],
      outsider: [404, 'not_found'],
      moderator: [404, 'not_found'],
      guest: [200],
      player: [200],
      modPlayer: [200],
      coCaptain: [200],
      captain: [200],
    };
    const world = await matchWorld(t);
    for (const [actor, [status, code]] of Object.entries(cells) as [
      Actor,
      readonly [number, string?],
    ][]) {
      const response = await matchApi.rsvp(headersOf(world, actor), world.matchId, 'maybe');
      if (code === undefined) {
        expect(response.status, actor).toBe(status);
      } else {
        await expectProblem(response, status, code);
      }
    }
    const former = await account(t);
    await insertRsvp(t, world.matchId, former.id, 'in');
    await expectProblem(
      await matchApi.rsvp(former.headers, world.matchId, 'out'),
      404,
      'not_found',
    );
    expect((await rsvpRow(t, world.matchId, former.id))?.status).toBe('in');
  });

  it('accepts only the actor’s own status: user, side, paid and waitlist are 400', async () => {
    const world = await matchWorld(t);
    for (const body of [
      { status: 'waitlist' },
      { status: 'in', userId: world.captain.id },
      { status: 'in', side: 'A' },
      { status: 'in', paid: true },
    ]) {
      await expectProblem(
        await matchApi.rsvpBody(world.player.headers, world.matchId, body),
        400,
        'validation_failed',
      );
    }
    expect((await rsvpRow(t, world.matchId, world.captain.id))?.status).toBe('in');
  });
});

describe('RSVP concurrency (ADR-0035: match row lock)', () => {
  it('two members racing for the last slot: exactly one gets it, the other is waitlisted', async () => {
    for (let round = 0; round < 5; round += 1) {
      const world = await matchWorld(t, { slots: 5 });
      const a = await addPlayer(t, world.teamId);
      const b = await addPlayer(t, world.teamId);
      const results = await Promise.all([
        matchApi.rsvp(a.headers, world.matchId, 'in'),
        matchApi.rsvp(b.headers, world.matchId, 'in'),
      ]);
      const statuses = await Promise.all(
        results.map(
          async (response) => ownRsvpSchema.parse(await expectJson(response, 200)).status,
        ),
      );
      expect(statuses.sort()).toEqual(['in', 'waitlist']);
      expect(await confirmedIds(t, world.matchId)).toHaveLength(5);
    }
  });

  it('two guests racing for one slot: one confirmed, one 409 match_full', async () => {
    for (let round = 0; round < 3; round += 1) {
      const world = await matchWorld(t, { slots: 5, guestStatus: 'out' });
      await insertRsvp(t, world.matchId, (await addPlayer(t, world.teamId)).id, 'in');
      const second = await insertGuest(t, world.matchId, 'out');
      const results = await Promise.all([
        matchApi.rsvp(world.guest.headers, world.matchId, 'in'),
        matchApi.rsvp(second.headers, world.matchId, 'in'),
      ]);
      expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
      expect(await confirmedIds(t, world.matchId)).toHaveLength(5);
    }
  });

  it('concurrent drop-outs promote each waitlisted player exactly once, in queue order', async () => {
    for (let round = 0; round < 3; round += 1) {
      const world = await matchWorld(t, { slots: 4 });
      const first = await waitlisted(world.teamId, world.matchId, 9);
      const second = await waitlisted(world.teamId, world.matchId, 6);
      const third = await waitlisted(world.teamId, world.matchId, 3);
      const results = await Promise.all([
        matchApi.rsvp(world.player.headers, world.matchId, 'out'),
        matchApi.rsvp(world.coCaptain.headers, world.matchId, 'maybe'),
      ]);
      expect(results.map((response) => response.status)).toEqual([200, 200]);
      const confirmed = await confirmedIds(t, world.matchId);
      expect(confirmed).toEqual([world.captain.id, world.guest.id, first.id, second.id].sort());
      expect((await rsvpRow(t, world.matchId, third.id))?.status).toBe('waitlist');
      const promoted = (await jobsFor(t, 'push.send', world.matchId)).filter(
        (job) => job.data.type === 'rsvp.promoted',
      );
      expect(promoted.map((job) => job.data.userId).sort()).toEqual([first.id, second.id].sort());
    }
  });

  it('a newcomer racing a drop-out never jumps the queue', async () => {
    for (let round = 0; round < 3; round += 1) {
      const world = await matchWorld(t, { slots: 4 });
      const queued = await waitlisted(world.teamId, world.matchId, 5);
      const newcomer = await addPlayer(t, world.teamId);
      await Promise.all([
        matchApi.rsvp(world.player.headers, world.matchId, 'out'),
        matchApi.rsvp(newcomer.headers, world.matchId, 'in'),
      ]);
      expect((await rsvpRow(t, world.matchId, queued.id))?.status).toBe('in');
      expect((await rsvpRow(t, world.matchId, newcomer.id))?.status).toBe('waitlist');
      expect(await confirmedIds(t, world.matchId)).toHaveLength(4);
    }
  });
});

describe('notifications commit with the RSVP write (ADR-0028)', () => {
  it('an audit failure rolls back the RSVP change, the promotion and every enqueued job', async () => {
    const world = await matchWorld(t, { status: 'locked', slots: 4 });
    const queued = await waitlisted(world.teamId, world.matchId, 2);
    const rsvpId = (await rsvpRow(t, world.matchId, world.player.id))?.id ?? '';
    await t.db.update(matchRsvps).set({ paid: true }).where(eq(matchRsvps.id, rsvpId));
    const jobsBefore = (await jobsFor(t, 'push.send', world.matchId)).length;

    await asAdmin(t, 'revoke insert on audit_logs from kadro_app');
    try {
      await expectProblem(
        await matchApi.rsvp(world.player.headers, world.matchId, 'out'),
        500,
        'internal_error',
      );
    } finally {
      await asAdmin(t, 'grant insert on audit_logs to kadro_app');
    }
    expect(await rsvpRow(t, world.matchId, world.player.id)).toMatchObject({
      status: 'in',
      paid: true,
    });
    expect((await rsvpRow(t, world.matchId, queued.id))?.status).toBe('waitlist');
    expect(await jobsFor(t, 'push.send', world.matchId)).toHaveLength(jobsBefore);
    expect(await auditRows(t, rsvpId)).toEqual([]);

    await expectJson(await matchApi.rsvp(world.player.headers, world.matchId, 'out'), 200);
    const types = (await jobsFor(t, 'push.send', world.matchId)).map((job) => job.data.type);
    expect(types).toEqual(
      expect.arrayContaining(['lineup.slot_free', 'rsvp.promoted', 'rsvp.changed']),
    );
    expect(await auditRows(t, rsvpId)).toHaveLength(1);
  });
});
