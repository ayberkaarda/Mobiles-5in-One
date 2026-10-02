import {
  type MatchDetail,
  matchDetailSchema,
  matchGuestViewSchema,
  matchMemberViewSchema,
  matchSummarySchema,
  paginatedResponseSchema,
  RATE_LIMIT_GROUPS,
} from '@kadro/contracts';
import { matches, newId, openCallApplications, openCalls, teamMembers } from '@kadro/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { apiErrorFromDatabase, findPgError } from '../../lib/server/errors';
import { groupLimitKeys } from '../../lib/server/group-limits';
import { reminderIdempotencyKey } from '../../lib/server/jobs/notify';
import { expectProblem } from '../support/http';
import { account, webAccount } from '../teams/support';
import {
  type Actor,
  DAY_MS,
  expectJson,
  headersOf,
  HOUR_MS,
  inDays,
  insertGuest,
  insertMatchRow,
  insertRsvp,
  insertVenue,
  jobsFor,
  matchApi,
  type MatchesHarness,
  matchRow,
  matchWorld,
  rsvpRow,
  setupMatchesHarness,
} from './support';

/**
 * Match endpoints (matrix §3.4 rows `match.*`, footnotes 10–13, §4.4; ADR-0004, ADR-0031,
 * ADR-0037): success paths, every role × relationship cell in the order 401 → 404 → 403 → 409,
 * strict bodies, the state machine with the frozen terms after the first lock, reminders and
 * notifications committed with the write, pagination and the group G limit.
 */

let t: MatchesHarness;

beforeAll(async () => {
  t = await setupMatchesHarness('web_matches_matches');
});

afterAll(async () => {
  await t.dispose();
});

const listSchema = paginatedResponseSchema(matchSummarySchema);

function createBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    venueText: 'Çankaya Halı Saha',
    startsAt: inDays(t, 3),
    format: '7v7',
    feeTotalMinor: 140_000,
    slots: 14,
    ...overrides,
  };
}

async function expectStatus(response: Response, status: number, code?: string): Promise<void> {
  if (code === undefined) {
    const text = await response.text();
    expect(response.status, text).toBe(status);
  } else {
    await expectProblem(response, status, code);
  }
}

/** Expected result per actor: status, plus the problem code for failures. */
type Cells = Readonly<Record<Actor, readonly [number, string?]>>;

const ACTORS: readonly Actor[] = [
  'anon',
  'outsider',
  'moderator',
  'guest',
  'player',
  'modPlayer',
  'coCaptain',
  'captain',
];

describe('POST /api/v1/teams/[id]/matches', () => {
  it('creates an open match with its reminders in the same transaction', async () => {
    const world = await matchWorld(t);
    const startsAt = new Date(t.harness.runtime.now().getTime() + 3 * DAY_MS);
    const response = await matchApi.create(world.captain.headers, world.teamId, {
      ...createBody({ startsAt: startsAt.toISOString() }),
      status: 'open',
    });
    const detail = matchMemberViewSchema.parse(await expectJson(response, 201));
    expect(detail).toMatchObject({
      projection: 'member',
      teamId: world.teamId,
      status: 'open',
      venue: null,
      venueText: 'Çankaya Halı Saha',
      format: '7v7',
      feeTotalMinor: 140_000,
      slots: 14,
      lockedAt: null,
      mvpVoteClosesAt: null,
      counts: { in: 0, maybe: 0, out: 0, waitlist: 0 },
      myRsvp: null,
      sharePerPlayerMinor: null,
      mvp: null,
      participants: [],
    });
    const reminders = await jobsFor(t, 'match.reminder', detail.id);
    expect(reminders.map((job) => job.singletonKey).sort()).toEqual(
      [
        reminderIdempotencyKey(detail.id, '24h', startsAt),
        reminderIdempotencyKey(detail.id, '2h', startsAt),
      ].sort(),
    );
    for (const job of reminders) {
      const lead = job.data.reminder === '24h' ? 24 * HOUR_MS : 2 * HOUR_MS;
      expect(job.startAfter.getTime()).toBe(startsAt.getTime() - lead);
      expect(Object.keys(job.data).sort()).toEqual(
        ['idempotencyKey', 'matchId', 'reminder', 'startsAt'].sort(),
      );
    }
  });

  it('creates a draft by default without reminders, with a directory venue', async () => {
    const world = await matchWorld(t);
    const venue = await insertVenue(t);
    const response = await matchApi.create(
      world.coCaptain.headers,
      world.teamId,
      createBody({ venueText: undefined, venueId: venue.id }),
    );
    const detail = matchMemberViewSchema.parse(await expectJson(response, 201));
    expect(detail.status).toBe('draft');
    expect(detail.venue).toEqual({ id: venue.id, name: venue.name, slug: venue.slug });
    expect(detail.venueText).toBeNull();
    expect(await jobsFor(t, 'match.reminder', detail.id)).toEqual([]);
  });

  it('accepts the actor’s own unverified venue but not another user’s (footnote 10)', async () => {
    const world = await matchWorld(t);
    const own = await insertVenue(t, { verified: false, createdBy: world.captain.id });
    const foreign = await insertVenue(t, { verified: false, createdBy: world.player.id });
    const ok = await matchApi.create(
      world.captain.headers,
      world.teamId,
      createBody({ venueText: undefined, venueId: own.id }),
    );
    expect(ok.status).toBe(201);
    const refused = await matchApi.create(
      world.captain.headers,
      world.teamId,
      createBody({ venueText: undefined, venueId: foreign.id }),
    );
    const problem = await expectProblem(refused, 400, 'validation_failed');
    expect(problem.errors).toEqual([{ path: 'body.venueId', issue: 'not_found' }]);
  });

  it('refuses a start in the past, both or no venue, ranges and server-only fields', async () => {
    const world = await matchWorld(t);
    const bodies: Record<string, unknown>[] = [
      createBody({ startsAt: new Date(t.harness.runtime.now().getTime() - 1_000).toISOString() }),
      createBody({ venueId: (await insertVenue(t)).id }),
      createBody({ venueText: undefined }),
      createBody({ feeTotalMinor: 100_000_001 }),
      createBody({ feeTotalMinor: -1 }),
      createBody({ slots: 1 }),
      createBody({ slots: 31 }),
      createBody({ format: '11v11' }),
      createBody({ status: 'locked' }),
      createBody({ lockedAt: inDays(t, 1) }),
      createBody({ mvpVoteClosesAt: inDays(t, 1) }),
      createBody({ teamId: world.teamId }),
      createBody({ id: world.matchId }),
    ];
    for (const body of bodies) {
      await expectProblem(
        await matchApi.create(world.captain.headers, world.teamId, body),
        400,
        'validation_failed',
      );
    }
    const created = await t.db.select().from(matches).where(eq(matches.teamId, world.teamId));
    expect(created).toHaveLength(1);
  });

  it('answers every relationship cell (anon 401, outsiders 404, players 403, staff 201)', async () => {
    const cells: Cells = {
      anon: [401, 'unauthenticated'],
      outsider: [404, 'not_found'],
      moderator: [404, 'not_found'],
      guest: [404, 'not_found'],
      player: [403, 'forbidden'],
      modPlayer: [403, 'forbidden'],
      coCaptain: [201],
      captain: [201],
    };
    const world = await matchWorld(t);
    for (const actor of ACTORS) {
      const [status, code] = cells[actor];
      await expectStatus(
        await matchApi.create(headersOf(world, actor), world.teamId, createBody()),
        status,
        code,
      );
    }
  });

  it('answers 401 before validation and 404 before 403 for invalid bodies', async () => {
    const world = await matchWorld(t);
    await expectProblem(
      await matchApi.create(headersOf(world, 'anon'), world.teamId, { bogus: true }),
      401,
      'unauthenticated',
    );
    // A valid body is needed to reach authorization; the outsider never learns the team exists.
    await expectProblem(
      await matchApi.create(world.outsider.headers, world.teamId, createBody()),
      404,
      'not_found',
    );
  });

  it('refuses a Pro-locked team with 403 entitlement_required', async () => {
    const world = await matchWorld(t, { isProLocked: true });
    await expectProblem(
      await matchApi.create(world.captain.headers, world.teamId, createBody()),
      403,
      'entitlement_required',
    );
    await expectProblem(
      await matchApi.create(world.player.headers, world.teamId, createBody()),
      403,
      'forbidden',
    );
  });

  it('requires the CSRF header on the web transport', async () => {
    const world = await matchWorld(t);
    const captain = await webAccount(t);
    await t.db
      .insert(teamMembers)
      .values({ teamId: world.teamId, userId: captain.id, role: 'co_captain' });
    const withoutCsrf = { ...captain.headers };
    delete withoutCsrf['x-csrf-token'];
    await expectProblem(
      await matchApi.create(withoutCsrf, world.teamId, createBody()),
      403,
      'csrf_failed',
    );
    expect((await matchApi.create(captain.headers, world.teamId, createBody())).status).toBe(201);
  });
});

describe('GET /api/v1/teams/[id]/matches', () => {
  it('pages the team’s matches, latest start first, with counts and the own RSVP', async () => {
    const world = await matchWorld(t);
    const base = t.harness.runtime.now().getTime();
    const ids = [world.matchId];
    for (let index = 1; index <= 4; index += 1) {
      ids.push(
        await insertMatchRow(t, world.teamId, { startsAt: new Date(base + (3 + index) * DAY_MS) }),
      );
    }
    const other = await matchWorld(t);
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const response = await matchApi.list(world.player.headers, world.teamId, {
        limit: '2',
        ...(cursor === undefined ? {} : { cursor }),
      });
      const page = listSchema.parse(await expectJson(response, 200));
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor !== undefined);
    expect(pages).toBe(3);
    expect(seen).toEqual([...ids].reverse());
    expect(seen).not.toContain(other.matchId);

    const first = listSchema.parse(
      await expectJson(await matchApi.list(world.player.headers, world.teamId), 200),
    );
    const own = first.items.find((item) => item.id === world.matchId);
    expect(own?.counts).toEqual({ in: 4, maybe: 0, out: 0, waitlist: 0 });
    expect(own?.myRsvp).toBe('in');
    expect(first.items.find((item) => item.id !== world.matchId)?.myRsvp).toBeNull();
  });

  it('filters by status and binds the cursor to its filters and team', async () => {
    const world = await matchWorld(t);
    await insertMatchRow(t, world.teamId, { status: 'draft' });
    await insertMatchRow(t, world.teamId, { status: 'draft' });
    const drafts = listSchema.parse(
      await expectJson(
        await matchApi.list(world.captain.headers, world.teamId, { status: 'draft', limit: '1' }),
        200,
      ),
    );
    expect(drafts.items.map((item) => item.status)).toEqual(['draft']);
    const cursor = drafts.nextCursor ?? '';
    expect(cursor).not.toBe('');
    await expectProblem(
      await matchApi.list(world.captain.headers, world.teamId, { status: 'open', cursor }),
      400,
      'invalid_cursor',
    );
    const other = await matchWorld(t);
    await expectProblem(
      await matchApi.list(other.captain.headers, other.teamId, { status: 'draft', cursor }),
      400,
      'invalid_cursor',
    );
    await expectProblem(
      await matchApi.list(world.captain.headers, world.teamId, { limit: '101' }),
      400,
      'validation_failed',
    );
  });

  it('answers every relationship cell (guests have no team read)', async () => {
    const cells: Cells = {
      anon: [401, 'unauthenticated'],
      outsider: [404, 'not_found'],
      moderator: [404, 'not_found'],
      guest: [404, 'not_found'],
      player: [200],
      modPlayer: [200],
      coCaptain: [200],
      captain: [200],
    };
    const world = await matchWorld(t);
    for (const actor of ACTORS) {
      const [status, code] = cells[actor];
      await expectStatus(await matchApi.list(headersOf(world, actor), world.teamId), status, code);
    }
  });
});

describe('GET /api/v1/matches/[id]', () => {
  it('gives members the member view and guests the guest view without paid flags', async () => {
    const world = await matchWorld(t, { status: 'locked', feeTotalMinor: 100_001 });
    const member = matchMemberViewSchema.parse(
      await expectJson(await matchApi.get(world.player.headers, world.matchId), 200),
    );
    expect(member.participants).toHaveLength(4);
    expect(member.participants.every((row) => typeof row.paid === 'boolean')).toBe(true);
    expect(member.sharePerPlayerMinor).toBe(Math.floor(100_001 / 4));
    expect(member.myRsvp).toBe('in');

    const guestText = await (await matchApi.get(world.guest.headers, world.matchId)).text();
    const guest = matchGuestViewSchema.parse(JSON.parse(guestText));
    expect(guest.projection).toBe('guest');
    expect(guest.myRsvp.status).toBe('in');
    expect(guest.sharePerPlayerMinor).toBe(Math.floor(100_001 / 4));
    expect(guestText).not.toContain('"paid"');
    expect(guestText).not.toContain('feeTotalMinor');
    expect(guestText).not.toContain('"level"');
    expect(guestText).not.toContain('@example.test');
  });

  it('keeps a guest away from the team’s other matches and a former member on played only', async () => {
    const world = await matchWorld(t);
    const second = await insertMatchRow(t, world.teamId);
    await expectProblem(await matchApi.get(world.guest.headers, second), 404, 'not_found');

    // ADR-0005: a former member keeps the guest view of played matches only.
    const played = await insertMatchRow(t, world.teamId, { status: 'played' });
    const locked = await insertMatchRow(t, world.teamId, { status: 'locked' });
    await insertRsvp(t, played, world.player.id, 'in');
    await insertRsvp(t, locked, world.player.id, 'in');
    await t.db
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, world.teamId), eq(teamMembers.userId, world.player.id)));
    const view = matchDetailSchema.parse(
      await expectJson(await matchApi.get(world.player.headers, played), 200),
    );
    expect(view.projection).toBe('guest');
    await expectProblem(await matchApi.get(world.player.headers, locked), 404, 'not_found');
  });

  it('answers every relationship cell and identical 404s for unknown ids', async () => {
    const cells: Cells = {
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
    for (const actor of ACTORS) {
      const [status, code] = cells[actor];
      await expectStatus(await matchApi.get(headersOf(world, actor), world.matchId), status, code);
    }
    const unknown = await matchApi.get(world.captain.headers, newId());
    await expectProblem(unknown, 404, 'not_found');
    await expectProblem(
      await matchApi.get(world.captain.headers, 'not-an-id'),
      400,
      'validation_failed',
    );
  });
});

describe('PATCH /api/v1/matches/[id]', () => {
  it('answers every relationship cell (players and guests 403)', async () => {
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
    const world = await matchWorld(t);
    for (const actor of ACTORS) {
      const [status, code] = cells[actor];
      await expectStatus(
        await matchApi.update(headersOf(world, actor), world.matchId, { venueText: 'Yeni Saha' }),
        status,
        code,
      );
    }
  });

  it('decides relationship before state: 404 / 403 for a frozen fee change, 409 for staff', async () => {
    const world = await matchWorld(t, { status: 'locked' });
    const body = { feeTotalMinor: 1 };
    await expectProblem(
      await matchApi.update(world.outsider.headers, world.matchId, body),
      404,
      'not_found',
    );
    await expectProblem(
      await matchApi.update(world.player.headers, world.matchId, body),
      403,
      'forbidden',
    );
    await expectProblem(
      await matchApi.update(world.guest.headers, world.matchId, body),
      403,
      'forbidden',
    );
    await expectProblem(
      await matchApi.update(world.captain.headers, world.matchId, body),
      409,
      'match_terms_frozen',
    );
  });

  it('ADR-0004: lock sets locked_at once; reopening never unfreezes fee, slots or format', async () => {
    const world = await matchWorld(t);
    const firstLock = t.harness.runtime.now();
    const locked = matchMemberViewSchema.parse(
      await expectJson(
        await matchApi.update(world.captain.headers, world.matchId, { status: 'locked' }),
        200,
      ),
    );
    expect(locked.lockedAt).toBe(firstLock.toISOString());
    t.harness.advance(60_000);
    const reopened = matchMemberViewSchema.parse(
      await expectJson(
        await matchApi.update(world.captain.headers, world.matchId, { status: 'open' }),
        200,
      ),
    );
    expect(reopened.status).toBe('open');
    expect(reopened.lockedAt).toBe(firstLock.toISOString());
    for (const body of [{ feeTotalMinor: 1 }, { slots: 20 }, { format: '5v5' }]) {
      await expectProblem(
        await matchApi.update(world.coCaptain.headers, world.matchId, body),
        409,
        'match_terms_frozen',
      );
    }
    // Same values are not a change; reschedule and venue stay editable.
    const edited = matchMemberViewSchema.parse(
      await expectJson(
        await matchApi.update(world.captain.headers, world.matchId, {
          feeTotalMinor: 140_000,
          startsAt: inDays(t, 4),
          venueText: 'Başka Saha',
        }),
        200,
      ),
    );
    expect(edited.venueText).toBe('Başka Saha');
    t.harness.advance(60_000);
    await expectJson(
      await matchApi.update(world.captain.headers, world.matchId, { status: 'locked' }),
      200,
    );
    const row = await matchRow(t, world.matchId);
    expect(row?.lockedAt?.toISOString()).toBe(firstLock.toISOString());
    expect(row?.feeTotalMinor).toBe(140_000);
    expect(row?.slots).toBe(10);
    expect(row?.format).toBe('7v7');
    // Reopen and change the fee in one request: still frozen, and nothing of it is applied.
    await expectProblem(
      await matchApi.update(world.captain.headers, world.matchId, {
        status: 'open',
        feeTotalMinor: 5,
      }),
      409,
      'match_terms_frozen',
    );
    expect((await matchRow(t, world.matchId))?.status).toBe('locked');
  });

  it('the matches_terms_frozen trigger guards the database behind the API', async () => {
    const world = await matchWorld(t, { status: 'locked' });
    const error = await t.db
      .update(matches)
      .set({ feeTotalMinor: 1 })
      .where(eq(matches.id, world.matchId))
      .then(
        () => null,
        (failure: unknown) => failure,
      );
    expect(findPgError(error)).toEqual({ code: '23514', constraint: 'matches_terms_frozen' });
    expect(apiErrorFromDatabase(error)?.code).toBe('match_terms_frozen');
  });

  it('a concurrent lock and fee change never leave a changed fee after the first lock', async () => {
    for (let round = 0; round < 4; round += 1) {
      const world = await matchWorld(t);
      const [lock, fee] = await Promise.all([
        matchApi.update(world.captain.headers, world.matchId, { status: 'locked' }),
        matchApi.update(world.coCaptain.headers, world.matchId, { feeTotalMinor: 99_000 }),
      ]);
      expect(lock.status).toBe(200);
      const row = await matchRow(t, world.matchId);
      expect(row?.lockedAt).not.toBeNull();
      if (fee.status === 200) {
        expect(row?.feeTotalMinor).toBe(99_000);
      } else {
        await expectProblem(fee, 409, 'match_terms_frozen');
        expect(row?.feeTotalMinor).toBe(140_000);
      }
    }
  });

  it('follows the transition table (footnote 12)', async () => {
    const cases: readonly [string, string, number][] = [
      ['draft', 'open', 200],
      ['draft', 'cancelled', 200],
      ['draft', 'locked', 409],
      ['draft', 'played', 409],
      ['open', 'locked', 200],
      ['open', 'cancelled', 200],
      ['locked', 'open', 200],
      ['locked', 'cancelled', 200],
      ['played', 'open', 409],
      ['played', 'cancelled', 409],
      ['cancelled', 'open', 409],
      ['cancelled', 'locked', 409],
    ];
    for (const [from, to, status] of cases) {
      const world = await matchWorld(t, { status: from as 'draft' });
      const response = await matchApi.update(world.captain.headers, world.matchId, { status: to });
      if (status === 200) {
        expect(response.status, `${from} → ${to}`).toBe(200);
        expect((await matchRow(t, world.matchId))?.status).toBe(to);
      } else {
        await expectProblem(response, 409, 'invalid_status_transition');
        expect((await matchRow(t, world.matchId))?.status).toBe(from);
      }
    }
    const world = await matchWorld(t);
    await expectProblem(
      await matchApi.update(world.captain.headers, world.matchId, { status: 'draft' }),
      400,
      'validation_failed',
    );
  });

  it('marks played only after the start and opens the 24-hour MVP window', async () => {
    const world = await matchWorld(t);
    await expectProblem(
      await matchApi.update(world.captain.headers, world.matchId, { status: 'played' }),
      409,
      'invalid_status_transition',
    );
    const started = await matchWorld(t, {
      status: 'locked',
      startsAt: new Date(t.harness.runtime.now().getTime() - HOUR_MS),
    });
    const view = matchMemberViewSchema.parse(
      await expectJson(
        await matchApi.update(started.captain.headers, started.matchId, { status: 'played' }),
        200,
      ),
    );
    expect(view.mvpVoteClosesAt).toBe(
      new Date(t.harness.runtime.now().getTime() + 24 * HOUR_MS).toISOString(),
    );
    expect(view.mvp).toEqual({ myVoteeId: null, winnerIds: null });
    // Terminal: nothing changes any more.
    await expectProblem(
      await matchApi.update(started.captain.headers, started.matchId, { venueText: 'Başka' }),
      409,
      'invalid_status_transition',
    );
  });

  it('reschedule replans reminders and notifies in / maybe / waitlist, not out or the actor', async () => {
    const world = await matchWorld(t);
    const maybe = await account(t);
    const out = await account(t);
    const waiting = await account(t);
    for (const [user, status] of [
      [maybe, 'maybe'],
      [out, 'out'],
      [waiting, 'waitlist'],
    ] as const) {
      await t.db
        .insert(teamMembers)
        .values({ teamId: world.teamId, userId: user.id, role: 'player' });
      await insertRsvp(t, world.matchId, user.id, status);
    }
    const startsAt = new Date(t.harness.runtime.now().getTime() + 5 * DAY_MS);
    await expectJson(
      await matchApi.update(world.coCaptain.headers, world.matchId, {
        startsAt: startsAt.toISOString(),
      }),
      200,
    );
    const pushes = (await jobsFor(t, 'push.send', world.matchId)).filter(
      (job) => job.data.type === 'match.updated',
    );
    expect(pushes.map((job) => job.data.userId).sort()).toEqual(
      [world.captain.id, world.player.id, world.guest.id, maybe.id, waiting.id].sort(),
    );
    for (const job of pushes) {
      expect(Object.keys(job.data).sort()).toEqual(['idempotencyKey', 'refId', 'type', 'userId']);
    }
    const reminders = await jobsFor(t, 'match.reminder', world.matchId);
    expect(reminders.map((job) => job.singletonKey).sort()).toEqual(
      [
        reminderIdempotencyKey(world.matchId, '24h', startsAt),
        reminderIdempotencyKey(world.matchId, '2h', startsAt),
      ].sort(),
    );
    await expectProblem(
      await matchApi.update(world.coCaptain.headers, world.matchId, {
        startsAt: new Date(t.harness.runtime.now().getTime() - 1).toISOString(),
      }),
      400,
      'validation_failed',
    );
  });

  it('draft → open plans the reminders; more slots promote the waitlist oldest first', async () => {
    const draft = await matchWorld(t, { status: 'draft' });
    await expectJson(
      await matchApi.update(draft.captain.headers, draft.matchId, { status: 'open' }),
      200,
    );
    expect(await jobsFor(t, 'match.reminder', draft.matchId)).toHaveLength(2);

    const world = await matchWorld(t, { slots: 4 });
    const base = t.harness.runtime.now().getTime();
    const waiting = [];
    for (let index = 0; index < 3; index += 1) {
      const member = await account(t);
      await t.db
        .insert(teamMembers)
        .values({ teamId: world.teamId, userId: member.id, role: 'player' });
      // Inserted newest first, so the id order disagrees with the queue order.
      await insertRsvp(t, world.matchId, member.id, 'waitlist', {
        waitlistedAt: new Date(base - (index + 1) * 60_000),
      });
      waiting.push(member);
    }
    await expectJson(
      await matchApi.update(world.captain.headers, world.matchId, { slots: 6 }),
      200,
    );
    expect((await rsvpRow(t, world.matchId, waiting[2]?.id ?? ''))?.status).toBe('in');
    expect((await rsvpRow(t, world.matchId, waiting[1]?.id ?? ''))?.status).toBe('in');
    expect((await rsvpRow(t, world.matchId, waiting[0]?.id ?? ''))?.status).toBe('waitlist');
    const promoted = (await jobsFor(t, 'push.send', world.matchId)).filter(
      (job) => job.data.type === 'rsvp.promoted',
    );
    expect(promoted.map((job) => job.data.userId).sort()).toEqual(
      [waiting[1]?.id, waiting[2]?.id].sort(),
    );
    await expectProblem(
      await matchApi.update(world.captain.headers, world.matchId, { slots: 5 }),
      409,
      'slots_below_confirmed',
    );
  });

  it('refuses server-only fields with 400 and leaves the row unchanged', async () => {
    const world = await matchWorld(t);
    const before = await matchRow(t, world.matchId);
    for (const body of [
      { lockedAt: null },
      { mvpVoteClosesAt: inDays(t, 1) },
      { teamId: world.teamId },
      { id: world.matchId },
      { status: 'draft' },
      {},
      { venueText: 'A Saha', venueId: (await insertVenue(t)).id },
    ]) {
      await expectProblem(
        await matchApi.update(world.captain.headers, world.matchId, body),
        400,
        'validation_failed',
      );
    }
    expect(await matchRow(t, world.matchId)).toEqual(before);
  });

  it('leaving open closes the open call, rejects pending applications and notifies them', async () => {
    const world = await matchWorld(t);
    const [call] = await t.db
      .insert(openCalls)
      .values({
        matchId: world.matchId,
        missingCount: 2,
        level: 'casual',
        districtId: t.districtId,
        expiresAt: new Date(t.harness.runtime.now().getTime() + DAY_MS),
      })
      .returning({ id: openCalls.id });
    const applicant = await account(t);
    const [application] = await t.db
      .insert(openCallApplications)
      .values({ openCallId: call?.id ?? '', userId: applicant.id })
      .returning({ id: openCallApplications.id });
    await expectJson(
      await matchApi.update(world.captain.headers, world.matchId, { status: 'locked' }),
      200,
    );
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
});

describe('DELETE /api/v1/matches/[id]', () => {
  it('deletes a draft and cancels open or locked matches with notifications (footnote 13)', async () => {
    const draft = await matchWorld(t, { status: 'draft' });
    expect(
      await expectJson(await matchApi.remove(draft.captain.headers, draft.matchId), 200),
    ).toEqual({ outcome: 'deleted' });
    expect(await matchRow(t, draft.matchId)).toBeUndefined();

    for (const status of ['open', 'locked'] as const) {
      const world = await matchWorld(t, { status });
      expect(
        await expectJson(await matchApi.remove(world.coCaptain.headers, world.matchId), 200),
      ).toEqual({ outcome: 'cancelled' });
      expect((await matchRow(t, world.matchId))?.status).toBe('cancelled');
      const pushes = (await jobsFor(t, 'push.send', world.matchId)).filter(
        (job) => job.data.type === 'match.updated',
      );
      expect(pushes.map((job) => job.data.userId).sort()).toEqual(
        [world.captain.id, world.player.id, world.guest.id].sort(),
      );
    }
    for (const status of ['played', 'cancelled'] as const) {
      const world = await matchWorld(t, { status });
      await expectProblem(
        await matchApi.remove(world.captain.headers, world.matchId),
        409,
        'match_state_conflict',
      );
      expect((await matchRow(t, world.matchId))?.status).toBe(status);
    }
  });

  it('answers every relationship cell', async () => {
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
    for (const actor of ACTORS) {
      const world = await matchWorld(t, { status: 'draft' });
      const [status, code] = cells[actor];
      await expectStatus(
        await matchApi.remove(headersOf(world, actor), world.matchId),
        status,
        code,
      );
      expect((await matchRow(t, world.matchId)) === undefined).toBe(status === 200);
    }
  });
});

describe('group G rate limit and logs', () => {
  it('counts mutations only and answers the 121st with 429 and Retry-After', async () => {
    const world = await matchWorld(t);
    const rule = RATE_LIMIT_GROUPS.G;
    const [key] = groupLimitKeys(t.harness.runtime, 'G', {
      userId: world.captain.id,
      ipSubject: world.captain.ip,
    });
    const counted = () => t.harness.runtime.limiter.count(key ?? '', rule);
    expect(await counted()).toBe(0);
    await expectJson(await matchApi.get(world.captain.headers, world.matchId), 200);
    await expectJson(await matchApi.list(world.captain.headers, world.teamId), 200);
    expect(await counted()).toBe(0);
    await expectJson(
      await matchApi.update(world.captain.headers, world.matchId, { venueText: 'X Saha' }),
      200,
    );
    await expectJson(await matchApi.rsvp(world.captain.headers, world.matchId, 'maybe'), 200);
    expect(await counted()).toBe(2);
    for (let index = 2; index < rule.max; index += 1) {
      await t.harness.runtime.limiter.record(key ?? '', rule);
    }
    const limited = await matchApi.rsvp(world.captain.headers, world.matchId, 'in');
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/);
    await expectProblem(limited, 429, 'rate_limited');
    expect((await rsvpRow(t, world.matchId, world.captain.id))?.status).toBe('maybe');
    // Reads are not limited per group, and another user keeps their own budget.
    await expectJson(await matchApi.get(world.captain.headers, world.matchId), 200);
    await expectJson(await matchApi.rsvp(world.player.headers, world.matchId, 'maybe'), 200);
  });

  it('logs one line per request without names, emails or tokens', async () => {
    const world = await matchWorld(t);
    const from = t.harness.logLines.length;
    const created: MatchDetail = matchDetailSchema.parse(
      await expectJson(
        await matchApi.create(world.captain.headers, world.teamId, {
          ...createBody(),
          status: 'open',
        }),
        201,
      ),
    );
    await matchApi.rsvp(world.player.headers, created.id, 'in');
    await matchApi.get(world.guest.headers, world.matchId);
    await matchApi.update(world.player.headers, world.matchId, { feeTotalMinor: 1 });
    const lines = t.harness.logLines.slice(from);
    expect(lines.length).toBeGreaterThanOrEqual(4);
    const text = lines.join('\n');
    expect(text).not.toContain('@example.test');
    expect(text).not.toContain('Bearer');
    expect(text).not.toContain('Oyuncu ');
    for (const line of lines) {
      const entry = JSON.parse(line) as Record<string, unknown>;
      expect(Object.keys(entry)).not.toContain('body');
      expect(String(entry.route ?? '')).not.toContain(world.matchId);
    }
  });
});

describe('a guest of the match never sees other teams', () => {
  it('a guest RSVP elsewhere grants nothing on an unrelated match', async () => {
    const world = await matchWorld(t);
    const other = await matchWorld(t);
    const guest = await insertGuest(t, other.matchId);
    await expectProblem(await matchApi.get(guest.headers, world.matchId), 404, 'not_found');
  });
});
