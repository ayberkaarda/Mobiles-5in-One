import { randomUUID } from 'node:crypto';

import { matchDetailSchema, mvpVoteResponseSchema } from '@kadro/contracts';
import { matches, teamMembers, users } from '@kadro/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { expectProblem } from '../support/http';
import {
  type Actor,
  addPlayer,
  expectJson,
  headersOf,
  HOUR_MS,
  insertRsvp,
  matchApi,
  type MatchesHarness,
  matchWorld,
  setupMatchesHarness,
  voteRows,
} from './support';

/**
 * MVP vote (matrix §3.4 `mvp.vote`, footnote 17, ADR-0036): played matches only, inside the
 * 24-hour window, confirmed voter and votee, no self vote, one final vote, and tallies hidden:
 * no response ever carries a vote count, and the winners appear only after the window closed.
 */

let t: MatchesHarness;

beforeAll(async () => {
  t = await setupMatchesHarness('web_matches_mvp');
});

afterAll(async () => {
  await t.dispose();
});

/** No key that could carry a tally appears anywhere in a response body. */
function expectNoTally(text: string): void {
  expect(text).not.toMatch(/"(votes|count|counts?Votes|tally|voteCount)"/);
}

describe('POST /api/v1/matches/[id]/mvp-vote', () => {
  it('records one final vote and confirms only the own vote', async () => {
    const world = await matchWorld(t, { status: 'played' });
    const response = await matchApi.vote(world.player.headers, world.matchId, {
      voteeId: world.guest.id,
    });
    const text = await response.text();
    expect(response.status, text).toBe(201);
    expect(mvpVoteResponseSchema.parse(JSON.parse(text))).toEqual({
      matchId: world.matchId,
      voteeId: world.guest.id,
    });
    expect(Object.keys(JSON.parse(text) as object).sort()).toEqual(['matchId', 'voteeId']);
    expect(await voteRows(t, world.matchId)).toEqual([
      expect.objectContaining({ voterId: world.player.id, voteeId: world.guest.id }),
    ]);
    await expectProblem(
      await matchApi.vote(world.player.headers, world.matchId, { voteeId: world.captain.id }),
      409,
      'already_voted',
    );
    expect(await voteRows(t, world.matchId)).toHaveLength(1);
  });

  it('keeps tallies hidden while the window is open and shows only the winners afterwards', async () => {
    const world = await matchWorld(t, { status: 'played' });
    const extra = await addPlayer(t, world.teamId);
    await insertRsvp(t, world.matchId, extra.id, 'in');
    // guest 2 votes, player 2 votes, captain 1 vote: a tie between guest and player.
    const votes: [Actor | 'extra', string][] = [
      ['captain', world.guest.id],
      ['coCaptain', world.guest.id],
      ['guest', world.player.id],
      ['extra', world.player.id],
      ['player', world.captain.id],
    ];
    for (const [voter, voteeId] of votes) {
      const headers = voter === 'extra' ? extra.headers : headersOf(world, voter);
      expect((await matchApi.vote(headers, world.matchId, { voteeId })).status).toBe(201);
    }
    for (const viewer of [world.captain, world.guest]) {
      const text = await (await matchApi.get(viewer.headers, world.matchId)).text();
      expectNoTally(text);
      const view = matchDetailSchema.parse(JSON.parse(text));
      expect(view.mvp?.winnerIds).toBeNull();
    }
    const own = matchDetailSchema.parse(
      await expectJson(await matchApi.get(world.captain.headers, world.matchId), 200),
    );
    expect(own.mvp).toEqual({ myVoteeId: world.guest.id, winnerIds: null });

    await t.db
      .update(matches)
      .set({ mvpVoteClosesAt: new Date(t.harness.runtime.now().getTime() - 1_000) })
      .where(eq(matches.id, world.matchId));
    const closedText = await (await matchApi.get(world.guest.headers, world.matchId)).text();
    expectNoTally(closedText);
    const closed = matchDetailSchema.parse(JSON.parse(closedText));
    expect(closed.mvp).toEqual({
      myVoteeId: world.player.id,
      winnerIds: [world.guest.id, world.player.id].sort(),
    });
    await expectProblem(
      await matchApi.vote(world.modPlayer.headers, world.matchId, { voteeId: world.guest.id }),
      409,
      'mvp_vote_closed',
    );
  });

  it('a match without votes has no MVP after the window', async () => {
    const world = await matchWorld(t, {
      status: 'played',
      mvpVoteClosesAt: new Date(t.harness.runtime.now().getTime() - HOUR_MS),
    });
    const view = matchDetailSchema.parse(
      await expectJson(await matchApi.get(world.player.headers, world.matchId), 200),
    );
    expect(view.mvp).toEqual({ myVoteeId: null, winnerIds: [] });
  });

  it('opens only for played matches inside the window (409 mvp_vote_closed)', async () => {
    for (const options of [
      { status: 'open' as const },
      { status: 'locked' as const },
      { status: 'cancelled' as const },
      { status: 'played' as const, mvpVoteClosesAt: new Date(t.harness.runtime.now().getTime()) },
    ]) {
      const world = await matchWorld(t, options);
      await expectProblem(
        await matchApi.vote(world.player.headers, world.matchId, { voteeId: world.guest.id }),
        409,
        'mvp_vote_closed',
      );
    }
  });

  it('requires a confirmed voter and another confirmed, live votee', async () => {
    const world = await matchWorld(t, { status: 'played' });
    const maybe = await addPlayer(t, world.teamId);
    await insertRsvp(t, world.matchId, maybe.id, 'maybe');
    await expectProblem(
      await matchApi.vote(maybe.headers, world.matchId, { voteeId: world.player.id }),
      409,
      'player_not_confirmed',
    );
    await expectProblem(
      await matchApi.vote(world.player.headers, world.matchId, { voteeId: world.player.id }),
      409,
      'invalid_votee',
    );
    await expectProblem(
      await matchApi.vote(world.player.headers, world.matchId, {
        voteeId: world.player.id.toUpperCase(),
      }),
      409,
      'invalid_votee',
    );
    const [gone] = await t.db
      .insert(users)
      .values({
        email: `deleted+${randomUUID()}@deleted.invalid`,
        displayName: 'Silinmiş oyuncu',
        isTombstone: true,
        deactivatedAt: new Date(),
      })
      .returning({ id: users.id });
    await insertRsvp(t, world.matchId, gone?.id ?? '', 'in');
    for (const voteeId of [maybe.id, world.outsider.id, gone?.id ?? '']) {
      await expectProblem(
        await matchApi.vote(world.player.headers, world.matchId, { voteeId }),
        409,
        'invalid_votee',
      );
    }
    for (const body of [
      { voteeId: 'nobody' },
      { voteeId: world.guest.id, voterId: world.captain.id },
      {},
    ]) {
      await expectProblem(
        await matchApi.vote(world.player.headers, world.matchId, body),
        400,
        'validation_failed',
      );
    }
    expect(await voteRows(t, world.matchId)).toEqual([]);
  });

  it('answers every relationship cell; a former member votes on the played match (ADR-0005)', async () => {
    const cells: Readonly<Record<Actor, readonly [number, string?]>> = {
      anon: [401, 'unauthenticated'],
      outsider: [404, 'not_found'],
      moderator: [404, 'not_found'],
      guest: [201],
      player: [201],
      modPlayer: [409, 'player_not_confirmed'],
      coCaptain: [201],
      captain: [201],
    };
    for (const [actor, [status, code]] of Object.entries(cells) as [
      Actor,
      readonly [number, string?],
    ][]) {
      const world = await matchWorld(t, { status: 'played' });
      const voteeId = actor === 'guest' ? world.player.id : world.guest.id;
      const response = await matchApi.vote(headersOf(world, actor), world.matchId, { voteeId });
      if (code === undefined) {
        expect(response.status, actor).toBe(status);
      } else {
        await expectProblem(response, status, code);
      }
    }
    const world = await matchWorld(t, { status: 'played' });
    await t.db
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, world.teamId), eq(teamMembers.userId, world.player.id)));
    expect(
      (await matchApi.vote(world.player.headers, world.matchId, { voteeId: world.guest.id }))
        .status,
    ).toBe(201);
  });

  it('two concurrent votes of one voter: one recorded, the other 409 already_voted', async () => {
    for (let round = 0; round < 4; round += 1) {
      const world = await matchWorld(t, { status: 'played' });
      const results = await Promise.all([
        matchApi.vote(world.player.headers, world.matchId, { voteeId: world.guest.id }),
        matchApi.vote(world.player.headers, world.matchId, { voteeId: world.captain.id }),
      ]);
      expect(results.map((response) => response.status).sort()).toEqual([201, 409]);
      expect(await voteRows(t, world.matchId)).toHaveLength(1);
    }
  });
});
