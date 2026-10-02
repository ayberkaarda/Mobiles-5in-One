import { randomUUID } from 'node:crypto';

import {
  lineupResponseSchema,
  paymentResponseSchema,
  suggestLineup,
  type LineupAssignment,
} from '@kadro/contracts';
import { matchRsvps, users } from '@kadro/db';
import { and, eq, isNotNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { expectProblem } from '../support/http';
import {
  type Actor,
  addPlayer,
  asAdmin,
  auditRows,
  expectJson,
  headersOf,
  insertRsvp,
  matchApi,
  type MatchesHarness,
  type MatchWorld,
  matchWorld,
  rsvpRow,
  setupMatchesHarness,
} from './support';

/**
 * Lineup (matrix §3.4 `lineup.set`, footnote 15, ADR-0035) and payment marking (`payment.mark`,
 * footnote 16, ADR-0006, ADR-0013): relationship cells before state, the nested target loaded
 * inside the authorized match, whole-lineup replacement, side capacity, one audit row per mark in
 * the same transaction, and serialized concurrent writes.
 */

let t: MatchesHarness;

beforeAll(async () => {
  t = await setupMatchesHarness('web_matches_lineup');
});

afterAll(async () => {
  await t.dispose();
});

type Cells = Readonly<Record<Actor, readonly [number, string?]>>;

async function expectCells(
  cells: Cells,
  request: (world: MatchWorld, actor: Actor) => Promise<Response>,
  world: () => Promise<MatchWorld>,
): Promise<void> {
  for (const [actor, [status, code]] of Object.entries(cells) as [
    Actor,
    readonly [number, string?],
  ][]) {
    const response = await request(await world(), actor);
    if (code === undefined) {
      expect(response.status, `${actor}: ${await response.clone().text()}`).toBe(status);
    } else {
      await expectProblem(response, status, code);
    }
  }
}

async function storedSides(matchId: string): Promise<LineupAssignment[]> {
  const rows = await t.db
    .select({ userId: matchRsvps.userId, side: matchRsvps.side })
    .from(matchRsvps)
    .where(and(eq(matchRsvps.matchId, matchId), isNotNull(matchRsvps.side)));
  return rows
    .flatMap((row) => (row.side === null ? [] : [{ userId: row.userId, side: row.side }]))
    .sort((a, b) => a.userId.localeCompare(b.userId));
}

function sorted(sides: readonly LineupAssignment[]): LineupAssignment[] {
  return [...sides].sort((a, b) => a.userId.localeCompare(b.userId));
}

async function tombstone(): Promise<string> {
  const [row] = await t.db
    .insert(users)
    .values({
      email: `deleted+${randomUUID()}@deleted.invalid`,
      displayName: 'Silinmiş oyuncu',
      isTombstone: true,
      deactivatedAt: new Date(),
    })
    .returning({ id: users.id });
  return row?.id ?? '';
}

// ---------------------------------------------------------------------------
// Lineup
// ---------------------------------------------------------------------------

describe('PUT /api/v1/matches/[id]/lineup', () => {
  it('replaces the whole lineup and clears everyone not listed', async () => {
    const world = await matchWorld(t);
    await t.db
      .update(matchRsvps)
      .set({ side: 'B' })
      .where(and(eq(matchRsvps.matchId, world.matchId), eq(matchRsvps.userId, world.player.id)));
    const body = {
      sides: [
        { userId: world.captain.id, side: 'A' },
        { userId: world.guest.id, side: 'B' },
      ],
    };
    const stored = lineupResponseSchema.parse(
      await expectJson(await matchApi.lineup(world.coCaptain.headers, world.matchId, body), 200),
    );
    expect(stored.matchId).toBe(world.matchId);
    expect(sorted(stored.sides)).toEqual(sorted(body.sides as LineupAssignment[]));
    expect(await storedSides(world.matchId)).toEqual(sorted(body.sides as LineupAssignment[]));
    expect((await rsvpRow(t, world.matchId, world.player.id))?.side).toBeNull();
    const cleared = lineupResponseSchema.parse(
      await expectJson(
        await matchApi.lineup(world.captain.headers, world.matchId, { sides: [] }),
        200,
      ),
    );
    expect(cleared.sides).toEqual([]);
  });

  it('accepts the shared auto-balance suggestion (suggestLineup) for confirmed players', async () => {
    const world = await matchWorld(t, { slots: 6 });
    const positions = ['GK', 'DEF', 'MID', 'FWD'] as const;
    const members = [world.captain, world.coCaptain, world.player, world.guest];
    for (const [index, member] of members.entries()) {
      await t.db
        .update(users)
        .set({ position: positions[index % positions.length] ?? null })
        .where(eq(users.id, member.id));
    }
    const suggestion = suggestLineup(
      members.map((member, index) => ({
        userId: member.id,
        position: positions[index % positions.length] ?? null,
      })),
      6,
    );
    const stored = lineupResponseSchema.parse(
      await expectJson(
        await matchApi.lineup(world.captain.headers, world.matchId, { sides: suggestion }),
        200,
      ),
    );
    expect(sorted(stored.sides)).toEqual(sorted(suggestion));
  });

  it('refuses players without an in RSVP, strangers and deleted accounts (409 lineup_invalid_player)', async () => {
    const world = await matchWorld(t);
    const maybe = await addPlayer(t, world.teamId);
    await insertRsvp(t, world.matchId, maybe.id, 'maybe');
    const waiting = await addPlayer(t, world.teamId);
    await insertRsvp(t, world.matchId, waiting.id, 'waitlist');
    const gone = await tombstone();
    await insertRsvp(t, world.matchId, gone, 'in');
    for (const userId of [maybe.id, waiting.id, world.outsider.id, gone]) {
      await expectProblem(
        await matchApi.lineup(world.captain.headers, world.matchId, {
          sides: [
            { userId: world.player.id, side: 'A' },
            { userId, side: 'B' },
          ],
        }),
        409,
        'lineup_invalid_player',
      );
    }
    expect(await storedSides(world.matchId)).toEqual([]);
  });

  it('caps each side at ceil(slots / 2) (409 lineup_side_full)', async () => {
    const world = await matchWorld(t, { slots: 5 });
    const extra = await addPlayer(t, world.teamId);
    await insertRsvp(t, world.matchId, extra.id, 'in');
    const ids = [world.captain.id, world.coCaptain.id, world.player.id, world.guest.id];
    await expectProblem(
      await matchApi.lineup(world.captain.headers, world.matchId, {
        sides: [...ids, extra.id].map((userId) => ({ userId, side: 'A' })),
      }),
      409,
      'lineup_side_full',
    );
    // ceil(5 / 2) = 3 fits.
    const ok = lineupResponseSchema.parse(
      await expectJson(
        await matchApi.lineup(world.captain.headers, world.matchId, {
          sides: [
            ...ids.slice(0, 3).map((userId) => ({ userId, side: 'A' })),
            { userId: extra.id, side: 'B' },
          ],
        }),
        200,
      ),
    );
    expect(ok.sides).toHaveLength(4);
  });

  it('is allowed in open and locked only (409 match_state_conflict)', async () => {
    for (const status of ['draft', 'played', 'cancelled'] as const) {
      const world = await matchWorld(t, { status });
      await expectProblem(
        await matchApi.lineup(world.captain.headers, world.matchId, {
          sides: [{ userId: world.player.id, side: 'A' }],
        }),
        409,
        'match_state_conflict',
      );
    }
    const locked = await matchWorld(t, { status: 'locked' });
    await expectJson(
      await matchApi.lineup(locked.captain.headers, locked.matchId, {
        sides: [{ userId: locked.player.id, side: 'A' }],
      }),
      200,
    );
  });

  it('refuses duplicates and unknown fields with 400', async () => {
    const world = await matchWorld(t);
    for (const body of [
      {
        sides: [
          { userId: world.player.id, side: 'A' },
          { userId: world.player.id, side: 'B' },
        ],
      },
      { sides: [{ userId: world.player.id, side: 'C' }] },
      { sides: [{ userId: world.player.id, side: 'A', paid: true }] },
      { sides: [], matchId: world.matchId },
    ]) {
      await expectProblem(
        await matchApi.lineup(world.captain.headers, world.matchId, body),
        400,
        'validation_failed',
      );
    }
  });

  it('answers every relationship cell before any state check', async () => {
    const cells: Cells = {
      anon: [401, 'unauthenticated'],
      outsider: [404, 'not_found'],
      moderator: [404, 'not_found'],
      guest: [403, 'forbidden'],
      player: [403, 'forbidden'],
      modPlayer: [403, 'forbidden'],
      coCaptain: [200],
      captain: [200],
    };
    await expectCells(
      cells,
      (world, actor) =>
        matchApi.lineup(headersOf(world, actor), world.matchId, {
          sides: [{ userId: world.player.id, side: 'A' }],
        }),
      () => matchWorld(t),
    );
    // Invalid players in a played match: still 403 for a player, 404 for an outsider.
    const played = await matchWorld(t, { status: 'played' });
    const body = { sides: [{ userId: played.outsider.id, side: 'A' }] };
    await expectProblem(
      await matchApi.lineup(played.player.headers, played.matchId, body),
      403,
      'forbidden',
    );
    await expectProblem(
      await matchApi.lineup(played.outsider.headers, played.matchId, body),
      404,
      'not_found',
    );
  });

  it('two concurrent lineups: the stored lineup is exactly one of them, never a mix', async () => {
    for (let round = 0; round < 5; round += 1) {
      const world = await matchWorld(t);
      const first: LineupAssignment[] = [
        { userId: world.captain.id, side: 'A' },
        { userId: world.coCaptain.id, side: 'A' },
        { userId: world.player.id, side: 'B' },
      ];
      const second: LineupAssignment[] = [
        { userId: world.guest.id, side: 'A' },
        { userId: world.player.id, side: 'A' },
        { userId: world.captain.id, side: 'B' },
      ];
      const results = await Promise.all([
        matchApi.lineup(world.captain.headers, world.matchId, { sides: first }),
        matchApi.lineup(world.coCaptain.headers, world.matchId, { sides: second }),
      ]);
      expect(results.map((response) => response.status)).toEqual([200, 200]);
      const stored = await storedSides(world.matchId);
      expect([sorted(first), sorted(second)]).toContainEqual(stored);
    }
  });
});

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

describe('PATCH /api/v1/matches/[id]/payments/[userId]', () => {
  it('marks and clears a share, one audit row per call without personal data', async () => {
    const world = await matchWorld(t, { status: 'locked' });
    const rsvpId = (await rsvpRow(t, world.matchId, world.player.id))?.id ?? '';
    for (const paid of [true, true, false]) {
      const response = paymentResponseSchema.parse(
        await expectJson(
          await matchApi.pay(world.coCaptain.headers, world.matchId, world.player.id, { paid }),
          200,
        ),
      );
      expect(response).toMatchObject({ matchId: world.matchId, userId: world.player.id, paid });
    }
    const audits = await auditRows(t, rsvpId);
    expect(audits).toHaveLength(3);
    expect(audits.map((row) => row.metadata)).toEqual([
      { matchId: world.matchId, targetUserId: world.player.id, paid: true, selfMark: false },
      { matchId: world.matchId, targetUserId: world.player.id, paid: true, selfMark: false },
      { matchId: world.matchId, targetUserId: world.player.id, paid: false, selfMark: false },
    ]);
    for (const row of audits) {
      expect(row).toMatchObject({
        action: 'payment.mark',
        targetType: 'match_rsvp',
        actorId: world.coCaptain.id,
      });
      expect(row.ipHash).toMatch(/^[0-9a-f]+$/);
      expect(JSON.stringify(row.metadata)).not.toContain('@');
    }
    // Guests' shares are marked like members'.
    await expectJson(
      await matchApi.pay(world.captain.headers, world.matchId, world.guest.id, { paid: true }),
      200,
    );
  });

  it('lets only the captain mark their own share (ADR-0006)', async () => {
    const world = await matchWorld(t, { status: 'played' });
    const own = await expectJson<{ paid: boolean }>(
      await matchApi.pay(world.captain.headers, world.matchId, world.captain.id, { paid: true }),
      200,
    );
    expect(own.paid).toBe(true);
    const [audit] = await auditRows(
      t,
      (await rsvpRow(t, world.matchId, world.captain.id))?.id ?? '',
    );
    expect(audit?.metadata).toMatchObject({ selfMark: true });
    await expectProblem(
      await matchApi.pay(world.coCaptain.headers, world.matchId, world.coCaptain.id, {
        paid: true,
      }),
      403,
      'forbidden',
    );
    await expectJson(
      await matchApi.pay(world.captain.headers, world.matchId, world.coCaptain.id, { paid: true }),
      200,
    );
  });

  it('answers every relationship cell (players and guests 403, outsiders 404)', async () => {
    const cells: Cells = {
      anon: [401, 'unauthenticated'],
      outsider: [404, 'not_found'],
      moderator: [404, 'not_found'],
      guest: [403, 'forbidden'],
      player: [403, 'forbidden'],
      modPlayer: [403, 'forbidden'],
      coCaptain: [200],
      captain: [200],
    };
    await expectCells(
      cells,
      (world, actor) =>
        matchApi.pay(headersOf(world, actor), world.matchId, world.player.id, { paid: true }),
      () => matchWorld(t, { status: 'locked' }),
    );
  });

  it('loads the target inside the authorized match: 404 / 403 / 404 / 409 in matrix order', async () => {
    const world = await matchWorld(t, { status: 'locked' });
    const absent = world.outsider.id;
    await expectProblem(
      await matchApi.pay(world.outsider.headers, world.matchId, absent, { paid: true }),
      404,
      'not_found',
    );
    await expectProblem(
      await matchApi.pay(world.player.headers, world.matchId, absent, { paid: true }),
      403,
      'forbidden',
    );
    await expectProblem(
      await matchApi.pay(world.captain.headers, world.matchId, absent, { paid: true }),
      404,
      'not_found',
    );
    // A member of another match of the team is not a target of this one.
    const maybe = await addPlayer(t, world.teamId);
    await insertRsvp(t, world.matchId, maybe.id, 'maybe');
    await expectProblem(
      await matchApi.pay(world.captain.headers, world.matchId, maybe.id, { paid: true }),
      409,
      'player_not_confirmed',
    );
    const open = await matchWorld(t);
    await expectProblem(
      await matchApi.pay(open.captain.headers, open.matchId, open.player.id, { paid: true }),
      409,
      'match_state_conflict',
    );
    expect((await rsvpRow(t, open.matchId, open.player.id))?.paid).toBe(false);
    await expectProblem(
      await matchApi.pay(open.captain.headers, open.matchId, 'not-an-id', { paid: true }),
      400,
      'validation_failed',
    );
    for (const body of [
      { paid: 'yes' },
      { paid: true, userId: open.player.id },
      { side: 'A' },
      {},
    ]) {
      await expectProblem(
        await matchApi.pay(open.captain.headers, open.matchId, open.player.id, body),
        400,
        'validation_failed',
      );
    }
  });

  it('ADR-0006: when the audit row cannot be written the mark rolls back', async () => {
    const world = await matchWorld(t, { status: 'locked' });
    await asAdmin(t, 'revoke insert on audit_logs from kadro_app');
    try {
      await expectProblem(
        await matchApi.pay(world.captain.headers, world.matchId, world.player.id, { paid: true }),
        500,
        'internal_error',
      );
    } finally {
      await asAdmin(t, 'grant insert on audit_logs to kadro_app');
    }
    const row = await rsvpRow(t, world.matchId, world.player.id);
    expect(row?.paid).toBe(false);
    expect(await auditRows(t, row?.id ?? '')).toEqual([]);
  });

  it('concurrent marks: every call audited, the final flag is the last audited value', async () => {
    const world = await matchWorld(t, { status: 'locked' });
    const values = [true, false, true, true, false, true];
    const results = await Promise.all(
      values.map((paid, index) =>
        matchApi.pay(
          (index % 2 === 0 ? world.captain : world.coCaptain).headers,
          world.matchId,
          world.player.id,
          { paid },
        ),
      ),
    );
    expect(results.map((response) => response.status)).toEqual(values.map(() => 200));
    const row = await rsvpRow(t, world.matchId, world.player.id);
    const audits = await auditRows(t, row?.id ?? '');
    expect(audits).toHaveLength(values.length);
    // `created_at` is the transaction start (now()), not the commit order: a mark that waited for
    // the match lock can carry an earlier time. Every value written is audited exactly once.
    expect(audits.map((audit) => audit.metadata.paid).sort()).toEqual([...values].sort());
    // The UUIDv7 id is generated at insert time, inside the serialized section, so it follows the
    // commit order: the last audited value is the stored flag.
    const lastWritten = [...audits].sort((a, b) => a.id.localeCompare(b.id)).at(-1);
    expect(lastWritten?.metadata).toMatchObject({ paid: row?.paid });
  });

  it('a mark racing the player’s drop-out never leaves a paid flag on a non-confirmed RSVP', async () => {
    for (let round = 0; round < 4; round += 1) {
      const world = await matchWorld(t, { status: 'locked' });
      const [mark, leave] = await Promise.all([
        matchApi.pay(world.captain.headers, world.matchId, world.player.id, { paid: true }),
        matchApi.rsvp(world.player.headers, world.matchId, 'out'),
      ]);
      expect(leave.status).toBe(200);
      const row = await rsvpRow(t, world.matchId, world.player.id);
      expect(row).toMatchObject({ status: 'out', paid: false });
      expect(row?.status).not.toBe('in');
      const audits = await auditRows(t, row?.id ?? '');
      if (mark.status === 200) {
        // Marked, then cleared by leaving (ADR-0036 `rsvp_left`): one set and one clear. The
        // created_at order is the transaction start, not the commit order, so compare as a set.
        expect(audits.map((audit) => audit.metadata.paid).sort()).toEqual([false, true]);
        expect(audits.filter((audit) => audit.metadata.reason === 'rsvp_left')).toHaveLength(1);
      } else {
        await expectProblem(mark, 409, 'player_not_confirmed');
        expect(audits).toEqual([]);
      }
    }
  });
});
