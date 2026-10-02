import { randomBytes } from 'node:crypto';

import { type Application, applicationSchema, paginatedResponseSchema } from '@kadro/contracts';
import { auditLogs, matchRsvps, matches, openCallApplications, users } from '@kadro/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COALESCE_DELAY_MS } from '../../lib/server/jobs/notify';
import { expectProblem } from '../support/http';
import {
  account,
  type Account,
  addMember,
  anonymous,
  DAY_MS,
  expectJson,
  teamFixture,
  type TeamFixture,
} from '../teams/support';
import {
  api,
  applicationStatus,
  callRow,
  type CallsHarness,
  fillSlots,
  insertApplication,
  insertCall,
  insertMatch,
  insertRsvp,
  label,
  decidedJobs,
  pushJobs,
  rsvpOf,
  setRsvp,
  setupCallsHarness,
  statuses,
} from './support';

/**
 * Applications to open calls: create (footnote 20), list (footnote 33, ADR-0041) and decide /
 * withdraw (footnotes 21, 22, ADR-0003, ADR-0013), with the notification jobs of ADR-0031 checked
 * in the job table and the races of the acceptance rules run against real row locks.
 */

let t: CallsHarness;

beforeAll(async () => {
  t = await setupCallsHarness('web_calls_apps');
});

afterAll(async () => {
  await t.dispose();
});

beforeEach(() => {
  t.harness.setNow(new Date());
});

function now(): number {
  return t.harness.runtime.now().getTime();
}

interface CallWorld {
  readonly team: TeamFixture;
  readonly matchId: string;
  readonly callId: string;
}

async function callWorld(
  options: { missingCount?: number; slots?: number } = {},
): Promise<CallWorld> {
  const team = await teamFixture(t);
  const matchId = await insertMatch(t, team.id, { slots: options.slots ?? 14 });
  const callId = await insertCall(t, matchId, { missingCount: options.missingCount ?? 2 });
  return { team, matchId, callId };
}

/** An applicant with a pending application created through the API. */
async function applied(world: CallWorld, message?: string): Promise<{ user: Account; id: string }> {
  const user = await account(t);
  const body = await expectJson<Application>(
    await api.apply(user.headers, world.callId, message === undefined ? {} : { message }),
    201,
  );
  return { user, id: body.id };
}

async function failAuditFor(targetId: string, run: () => Promise<void>): Promise<void> {
  const fn = `fail_audit_${label()}`;
  const pool = t.database.client.pool;
  await pool.query(
    `create function ${fn}() returns trigger language plpgsql as $$ begin if new.target_id = '${targetId}' then raise exception 'forced failure'; end if; return new; end $$`,
  );
  await pool.query(
    `create trigger ${fn} before insert on audit_logs for each row execute function ${fn}()`,
  );
  try {
    await run();
  } finally {
    await pool.query(`drop trigger ${fn} on audit_logs`);
    await pool.query(`drop function ${fn}()`);
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

describe('POST open-calls/:id/applications', () => {
  it('creates a pending application with the public card and notifies the staff only', async () => {
    const world = await callWorld();
    const user = await account(t);
    const response = await api.apply(user.headers, world.callId, {
      message: '  Kaleci olabilirim\r\nGelirim ',
    });
    const body = applicationSchema.parse(await expectJson(response, 201));
    expect(body).toMatchObject({
      openCallId: world.callId,
      status: 'pending',
      message: 'Kaleci olabilirim\nGelirim',
      applicant: { id: user.id, avatarUrl: null },
    });
    expect(Object.keys(body.applicant).sort()).toEqual(
      ['avatarUrl', 'displayName', 'id', 'level', 'position'].sort(),
    );
    const jobs = await pushJobs(t, body.id);
    expect(jobs.map((job) => job.data.userId).sort()).toEqual(
      [world.team.captain.id, world.team.coCaptain.id].sort(),
    );
    for (const job of jobs) {
      const singletonKey = `application:${world.callId}:${String(job.data.userId)}`;
      expect(job.singletonKey).toBe(singletonKey);
      expect(job.data).toEqual({
        type: 'application.received',
        userId: job.data.userId,
        refId: body.id,
        idempotencyKey: expect.stringMatching(/^application:[\w-]+:[\w-]+:\d+$/) as unknown,
      });
      expect(String(job.data.idempotencyKey).startsWith(`${singletonKey}:`)).toBe(true);
      expect(job.startAfter.getTime()).toBeGreaterThanOrEqual(now() + COALESCE_DELAY_MS - 1_000);
    }
  });

  it('a second application inside the coalescing window adds no second push per recipient', async () => {
    const world = await callWorld();
    const first = await applied(world);
    const second = await applied(world);
    expect(await pushJobs(t, first.id)).toHaveLength(2);
    expect(await pushJobs(t, second.id)).toHaveLength(0);
  });

  it('401 anonymous, 403 unverified, 404 unknown call, 400 malformed id', async () => {
    const world = await callWorld();
    const unverified = await account(t, { verified: false });
    await expectProblem(await api.apply(anonymous(), world.callId), 401, 'unauthenticated');
    await expectProblem(await api.apply(unverified.headers, world.callId), 403, 'email_unverified');
    const user = await account(t);
    await expectProblem(
      await api.apply(user.headers, '019a0000-0000-7000-8000-000000000010'),
      404,
      'not_found',
    );
    await expectProblem(await api.apply(user.headers, 'x'), 400, 'validation_failed');
  });

  it('members, guests and other RSVP holders are already participants (409)', async () => {
    const world = await callWorld();
    for (const member of [world.team.captain, world.team.coCaptain, world.team.player]) {
      await expectProblem(
        await api.apply(member.headers, world.callId),
        409,
        'already_participant',
      );
    }
    const guest = await account(t);
    const otherCall = await insertCall(t, world.matchId, { status: 'closed' });
    await insertApplication(t, otherCall, guest.id, 'accepted');
    await insertRsvp(t, world.matchId, guest.id, 'in');
    await expectProblem(await api.apply(guest.headers, world.callId), 409, 'already_participant');
    const stray = await account(t);
    await insertRsvp(t, world.matchId, stray.id, 'maybe');
    await expectProblem(await api.apply(stray.headers, world.callId), 409, 'already_participant');
    const rows = await t.db
      .select()
      .from(openCallApplications)
      .where(eq(openCallApplications.openCallId, world.callId));
    expect(rows).toEqual([]);
  });

  it('ADR-0003 rules 2 and 3: closed or expired call, match not open or started', async () => {
    const team = await teamFixture(t);
    const user = await account(t);
    const closed = await insertCall(t, await insertMatch(t, team.id), { status: 'closed' });
    const expired = await insertCall(t, await insertMatch(t, team.id), {
      expiresAt: new Date(now() - 1_000),
    });
    await expectProblem(await api.apply(user.headers, closed), 409, 'call_closed');
    await expectProblem(await api.apply(user.headers, expired), 409, 'call_closed');
    for (const status of ['cancelled', 'locked', 'played'] as const) {
      const callId = await insertCall(t, await insertMatch(t, team.id, { status }));
      await expectProblem(await api.apply(user.headers, callId), 409, 'match_not_open');
    }
    const started = await insertCall(
      t,
      await insertMatch(t, team.id, { startsAt: new Date(now() - 60_000) }),
    );
    await expectProblem(await api.apply(user.headers, started), 409, 'match_not_open');
  });

  it('one application per user and call, whatever the first one became (409 already_applied)', async () => {
    const world = await callWorld();
    for (const status of ['pending', 'rejected', 'withdrawn'] as const) {
      const user = await account(t);
      await insertApplication(t, world.callId, user.id, status);
      await expectProblem(await api.apply(user.headers, world.callId), 409, 'already_applied');
    }
  });

  it('two concurrent applications of one user store one row', async () => {
    for (let round = 0; round < 3; round += 1) {
      const world = await callWorld();
      const user = await account(t);
      const responses = await Promise.all([
        api.apply(user.headers, world.callId),
        api.apply(user.headers, world.callId),
      ]);
      expect(statuses(responses)).toEqual([201, 409]);
      const loser = responses.find((response) => response.status === 409);
      if (loser !== undefined) {
        await expectProblem(loser, 409, 'already_applied');
      }
      const rows = await t.db
        .select()
        .from(openCallApplications)
        .where(eq(openCallApplications.openCallId, world.callId));
      expect(rows).toHaveLength(1);
    }
  });

  it('rejects server-only fields and invalid messages (matrix §4.4)', async () => {
    const world = await callWorld();
    const user = await account(t);
    for (const json of [
      { status: 'accepted' },
      { userId: world.team.captain.id },
      { openCallId: world.callId },
      { message: 'x'.repeat(281) },
      { message: 'ok\u0007' },
      { message: `gizli${String.fromCodePoint(0x202e)}metin` },
    ]) {
      await expectProblem(
        await api.apply(user.headers, world.callId, json),
        400,
        'validation_failed',
      );
    }
    const plain = await expectJson<Application>(
      await api.apply(user.headers, world.callId, { message: '<img src=x onerror=alert(1)>' }),
      201,
    );
    expect(plain.message).toBe('<img src=x onerror=alert(1)>');
  });

  it('a failure at commit rolls back the application and its notification jobs', async () => {
    const world = await callWorld();
    const user = await account(t);
    const marker = `geri-al-${label()}`;
    const fn = `fail_commit_${label()}`;
    const pool = t.database.client.pool;
    await pool.query(
      `create function ${fn}() returns trigger language plpgsql as $$ begin if new.message = '${marker}' then raise exception 'forced failure'; end if; return new; end $$`,
    );
    await pool.query(
      `create constraint trigger ${fn} after insert on open_call_applications deferrable initially deferred for each row execute function ${fn}()`,
    );
    const before = await t.db.select().from(openCallApplications);
    try {
      await expectProblem(
        await api.apply(user.headers, world.callId, { message: marker }),
        500,
        'internal_error',
      );
    } finally {
      await pool.query(`drop trigger ${fn} on open_call_applications`);
      await pool.query(`drop function ${fn}()`);
    }
    const after = await t.db.select().from(openCallApplications);
    expect(after).toHaveLength(before.length);
    const pushes = await t.database.client.pool.query(
      "select count(*)::int as n from pgboss.job where name = 'push.send' and data->>'idempotencyKey' like $1",
      [`application:${world.callId}:%`],
    );
    expect(pushes.rows[0]).toEqual({ n: 0 });
  });

  it('group O: the 31st application of a user within a day is 429', async () => {
    const user = await account(t);
    const missing = () => `019a0000-0000-7000-8000-${randomBytes(6).toString('hex')}`;
    for (let index = 0; index < 30; index += 1) {
      await expectProblem(await api.apply(user.headers, missing()), 404, 'not_found');
    }
    const denied = await api.apply(user.headers, missing());
    await expectProblem(denied.clone(), 429, 'rate_limited');
    expect(denied.headers.get('retry-after')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

describe('GET open-calls/:id/applications', () => {
  const page = paginatedResponseSchema(applicationSchema);

  it('staff list every application; an applicant only the own row; everyone else 404', async () => {
    const world = await callWorld({ missingCount: 5 });
    const a = await applied(world, 'birinci');
    const b = await applied(world, 'ikinci');
    await expectJson(
      await api.decide(world.team.captain.headers, world.callId, b.id, 'rejected'),
      200,
    );

    for (const staff of [world.team.captain, world.team.coCaptain]) {
      const all = page.parse(
        await expectJson(await api.listApplications(staff.headers, world.callId), 200),
      );
      expect(all.items.map((item) => item.id)).toEqual([a.id, b.id]);
      const rejected = page.parse(
        await expectJson(
          await api.listApplications(staff.headers, world.callId, { status: 'rejected' }),
          200,
        ),
      );
      expect(rejected.items.map((item) => item.id)).toEqual([b.id]);
    }
    const own = page.parse(
      await expectJson(await api.listApplications(a.user.headers, world.callId), 200),
    );
    expect(own).toEqual({
      items: [expect.objectContaining({ id: a.id, message: 'birinci' })],
      nextCursor: null,
    });

    const guest = await account(t);
    const otherCall = await insertCall(t, world.matchId, { status: 'closed' });
    await insertApplication(t, otherCall, guest.id, 'accepted');
    await insertRsvp(t, world.matchId, guest.id, 'in');
    const moderator = await account(t, { role: 'moderator' });
    for (const actor of [world.team.player, await account(t), guest, moderator]) {
      await expectProblem(
        await api.listApplications(actor.headers, world.callId),
        404,
        'not_found',
      );
    }
    await expectProblem(
      await api.listApplications(anonymous(), world.callId),
      401,
      'unauthenticated',
    );
    await expectProblem(
      await api.listApplications(
        world.team.captain.headers,
        '019a0000-0000-7000-8000-000000000011',
      ),
      404,
      'not_found',
    );
  });

  it('never exposes email or district and works in every call state', async () => {
    const world = await callWorld();
    const a = await applied(world);
    await expectJson(await api.close(world.team.captain.headers, world.matchId), 200);
    const [applicant] = await t.db.select().from(users).where(eq(users.id, a.user.id));
    const response = await api.listApplications(world.team.captain.headers, world.callId);
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain(applicant?.email ?? 'missing');
    expect(text).not.toContain('districtId');
    expect(text).not.toContain('email');
    expect(page.parse(JSON.parse(text)).items[0]).toMatchObject({ id: a.id, status: 'rejected' });
  });

  it('lists in each call state (open, closed, expired, removed, open but past expiry) for staff and applicant', async () => {
    const team = await teamFixture(t);
    const cases = [
      { status: 'open' as const },
      { status: 'closed' as const },
      { status: 'expired' as const },
      { status: 'removed' as const },
      { status: 'open' as const, expiresAt: new Date(now() - 60_000) },
    ];
    for (const options of cases) {
      const callId = await insertCall(t, await insertMatch(t, team.id), options);
      const mine = await account(t);
      const other = await account(t);
      const mineId = await insertApplication(t, callId, mine.id, 'rejected');
      const otherId = await insertApplication(t, callId, other.id, 'pending');
      const where = `${options.status}${options.expiresAt === undefined ? '' : ' (past expiry)'}`;
      const staffView = page.parse(
        await expectJson(await api.listApplications(team.coCaptain.headers, callId), 200),
      );
      expect(staffView.items.map((item) => item.id).sort(), where).toEqual(
        [mineId, otherId].sort(),
      );
      const ownView = page.parse(
        await expectJson(await api.listApplications(mine.headers, callId), 200),
      );
      expect(
        ownView.items.map((item) => item.id),
        where,
      ).toEqual([mineId]);
      await expectProblem(
        await api.listApplications(team.player.headers, callId),
        404,
        'not_found',
      );
    }
  });

  describe('an applicant who later became staff of the team (ADR-0041: staff see every row)', () => {
    for (const status of ['pending', 'rejected', 'withdrawn'] as const) {
      it(`own application ${status}: lists every application of the call`, async () => {
        const world = await callWorld({ missingCount: 4 });
        const turncoat = await account(t);
        const ownId = await insertApplication(t, world.callId, turncoat.id, status);
        const other = await applied(world);
        await addMember(t, world.team.id, turncoat.id, 'co_captain');
        const view = page.parse(
          await expectJson(await api.listApplications(turncoat.headers, world.callId), 200),
        );
        expect(view.items.map((item) => item.id).sort()).toEqual([ownId, other.id].sort());
      });
    }

    it('decides the other applications as staff but never accepts the own one', async () => {
      const world = await callWorld({ missingCount: 4 });
      const turncoat = await account(t);
      const ownId = await insertApplication(t, world.callId, turncoat.id, 'pending');
      const other = await applied(world);
      await addMember(t, world.team.id, turncoat.id, 'co_captain');
      await expectJson(await api.decide(turncoat.headers, world.callId, other.id, 'accepted'), 200);
      const own = await api.decide(turncoat.headers, world.callId, ownId, 'accepted');
      // Applicant cell (403) today; staff cell then rule 4 (409) once staff take precedence.
      expect([403, 409]).toContain(own.status);
      expect(await applicationStatus(t, ownId)).toBe('pending');
      expect(await rsvpOf(t, world.matchId, turncoat.id)).toBeNull();
    });
  });

  it('pages oldest first; a cursor works only for the actor scope and filters it was issued for', async () => {
    const world = await callWorld({ missingCount: 9 });
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      ids.push((await applied(world)).id);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let first: string | null = null;
    do {
      const result = page.parse(
        await expectJson(
          await api.listApplications(world.team.captain.headers, world.callId, {
            limit: '2',
            ...(cursor === null ? {} : { cursor }),
          }),
          200,
        ),
      );
      seen.push(...result.items.map((item) => item.id));
      cursor = result.nextCursor;
      first ??= cursor;
    } while (cursor !== null);
    expect(seen).toEqual(ids);
    if (first === null) {
      throw new Error('expected a second page');
    }
    await expectProblem(
      await api.listApplications(world.team.captain.headers, world.callId, {
        limit: '2',
        cursor: first,
        status: 'pending',
      }),
      400,
      'invalid_cursor',
    );
    const other = await callWorld();
    await expectProblem(
      await api.listApplications(other.team.captain.headers, other.callId, { cursor: first }),
      400,
      'invalid_cursor',
    );
    await expectProblem(
      await api.listApplications(world.team.captain.headers, world.callId, { limit: '0' }),
      400,
      'validation_failed',
    );
  });
});

// ---------------------------------------------------------------------------
// Decide / withdraw
// ---------------------------------------------------------------------------

describe('PATCH open-calls/:id/applications/:appId', () => {
  it('accept: RSVP in, missing count down, applicant notified, audit row', async () => {
    const world = await callWorld({ missingCount: 2 });
    const a = await applied(world);
    const body = applicationSchema.parse(
      await expectJson(
        await api.decide(world.team.coCaptain.headers, world.callId, a.id, 'accepted'),
        200,
      ),
    );
    expect(body.status).toBe('accepted');
    expect(await rsvpOf(t, world.matchId, a.user.id)).toBe('in');
    const call = await callRow(t, world.callId);
    expect(call).toMatchObject({ missingCount: 1, status: 'open' });
    expect((await decidedJobs(t, a.id)).map((job) => job.data)).toEqual([
      {
        type: 'application.decided',
        userId: a.user.id,
        refId: a.id,
        idempotencyKey: `push:decided:${a.id}`,
      },
    ]);
    const [audit] = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'application.accepted'), eq(auditLogs.targetId, a.id)));
    expect(audit?.metadata).toEqual({
      openCallId: world.callId,
      matchId: world.matchId,
      callClosed: false,
      rejected: 0,
    });
    // The accepted applicant is now a match guest: applying again is a participant conflict.
    await expectProblem(await api.apply(a.user.headers, world.callId), 409, 'already_participant');
  });

  it('the last missing player closes the call and rejects the remaining pending applications', async () => {
    const world = await callWorld({ missingCount: 1 });
    const a = await applied(world);
    const b = await applied(world);
    await expectJson(
      await api.decide(world.team.captain.headers, world.callId, a.id, 'accepted'),
      200,
    );
    expect(await callRow(t, world.callId)).toMatchObject({ missingCount: 0, status: 'closed' });
    expect(await applicationStatus(t, b.id)).toBe('rejected');
    expect((await decidedJobs(t, b.id)).map((job) => job.data.type)).toEqual([
      'application.decided',
    ]);
  });

  it('a full match closes the call even when missing players remain', async () => {
    const world = await callWorld({ missingCount: 3, slots: 6 });
    await fillSlots(t, world.matchId, 5);
    const a = await applied(world);
    const b = await applied(world);
    await expectJson(
      await api.decide(world.team.captain.headers, world.callId, a.id, 'accepted'),
      200,
    );
    expect(await callRow(t, world.callId)).toMatchObject({ missingCount: 2, status: 'closed' });
    expect(await applicationStatus(t, b.id)).toBe('rejected');
  });

  it('reject: no RSVP, applicant notified; withdraw: applicant only, no push', async () => {
    const world = await callWorld();
    const a = await applied(world);
    const b = await applied(world);
    await expectJson(
      await api.decide(world.team.captain.headers, world.callId, a.id, 'rejected'),
      200,
    );
    expect(await rsvpOf(t, world.matchId, a.user.id)).toBeNull();
    expect((await decidedJobs(t, a.id)).map((job) => job.data.type)).toEqual([
      'application.decided',
    ]);
    const withdrawn = await expectJson<Application>(
      await api.decide(b.user.headers, world.callId, b.id, 'withdrawn'),
      200,
    );
    expect(withdrawn.status).toBe('withdrawn');
    expect(await decidedJobs(t, b.id)).toEqual([]);
  });

  it('decide matrix: 401, 404 outsider / player / guest / other applicant, 403 own applicant', async () => {
    const world = await callWorld();
    const a = await applied(world);
    const other = await applied(world);
    const guest = await account(t);
    const otherCall = await insertCall(t, world.matchId, { status: 'closed' });
    await insertApplication(t, otherCall, guest.id, 'accepted');
    await insertRsvp(t, world.matchId, guest.id, 'in');
    for (const status of ['accepted', 'rejected'] as const) {
      await expectProblem(
        await api.decide(anonymous(), world.callId, a.id, status),
        401,
        'unauthenticated',
      );
      for (const actor of [await account(t), world.team.player, guest, other.user]) {
        await expectProblem(
          await api.decide(actor.headers, world.callId, a.id, status),
          404,
          'not_found',
        );
      }
      await expectProblem(
        await api.decide(a.user.headers, world.callId, a.id, status),
        403,
        'forbidden',
      );
    }
    expect(await applicationStatus(t, a.id)).toBe('pending');
  });

  it('withdraw matrix: staff 403, player / outsider / other applicant 404', async () => {
    const world = await callWorld();
    const a = await applied(world);
    const other = await applied(world);
    for (const staff of [world.team.captain, world.team.coCaptain]) {
      await expectProblem(
        await api.decide(staff.headers, world.callId, a.id, 'withdrawn'),
        403,
        'forbidden',
      );
    }
    for (const actor of [world.team.player, await account(t), other.user]) {
      await expectProblem(
        await api.decide(actor.headers, world.callId, a.id, 'withdrawn'),
        404,
        'not_found',
      );
    }
    expect(await applicationStatus(t, a.id)).toBe('pending');
  });

  it('nested target: an application of another call, or an unknown id, is 404 under this call', async () => {
    const mine = await callWorld();
    const theirs = await callWorld();
    const foreign = await applied(theirs);
    await expectProblem(
      await api.decide(mine.team.captain.headers, mine.callId, foreign.id, 'accepted'),
      404,
      'not_found',
    );
    await expectProblem(
      await api.decide(foreign.user.headers, mine.callId, foreign.id, 'withdrawn'),
      404,
      'not_found',
    );
    const unknown = '019a0000-0000-7000-8000-000000000012';
    await expectProblem(
      await api.decide(mine.team.captain.headers, mine.callId, unknown, 'accepted'),
      404,
      'not_found',
    );
    await expectProblem(
      await api.decide(mine.team.player.headers, mine.callId, unknown, 'accepted'),
      404,
      'not_found',
    );
    // Staff can read the call but may never withdraw: 403 before the missing target (matrix §2).
    await expectProblem(
      await api.decide(mine.team.captain.headers, mine.callId, unknown, 'withdrawn'),
      403,
      'forbidden',
    );
    expect(await applicationStatus(t, foreign.id)).toBe('pending');
  });

  it('only accepted, rejected or withdrawn, and no other field', async () => {
    const world = await callWorld();
    const a = await applied(world);
    for (const status of ['pending', 'ACCEPTED', 1, null]) {
      await expectProblem(
        await api.decide(world.team.captain.headers, world.callId, a.id, status),
        400,
        'validation_failed',
      );
    }
    for (const json of [
      { status: 'accepted', userId: world.team.captain.id },
      { status: 'accepted', openCallId: world.callId },
      { status: 'accepted', message: 'yeni' },
    ]) {
      await expectProblem(
        await api.decideJson(world.team.captain.headers, world.callId, a.id, json),
        400,
        'validation_failed',
      );
    }
    expect(await applicationStatus(t, a.id)).toBe('pending');
  });

  describe('ADR-0003 acceptance preconditions', () => {
    it('1: a decided application cannot be decided again (409 application_not_pending)', async () => {
      const world = await callWorld({ missingCount: 3 });
      const a = await applied(world);
      const b = await applied(world);
      const c = await applied(world);
      await expectJson(
        await api.decide(world.team.captain.headers, world.callId, a.id, 'accepted'),
        200,
      );
      await expectJson(
        await api.decide(world.team.captain.headers, world.callId, b.id, 'rejected'),
        200,
      );
      await expectJson(await api.decide(c.user.headers, world.callId, c.id, 'withdrawn'), 200);
      for (const id of [a.id, b.id, c.id]) {
        for (const status of ['accepted', 'rejected'] as const) {
          await expectProblem(
            await api.decide(world.team.captain.headers, world.callId, id, status),
            409,
            'application_not_pending',
          );
        }
      }
      await expectProblem(
        await api.decide(c.user.headers, world.callId, c.id, 'withdrawn'),
        409,
        'application_not_pending',
      );
      expect(await applicationStatus(t, b.id)).toBe('rejected');
      expect(await rsvpOf(t, world.matchId, b.user.id)).toBeNull();
    });

    it('2: closed or expired call (409 call_closed) for accept and reject', async () => {
      const team = await teamFixture(t);
      const user = await account(t);
      const closedCall = await insertCall(t, await insertMatch(t, team.id), { status: 'closed' });
      const closedApp = await insertApplication(t, closedCall, user.id);
      const expiredMatch = await insertMatch(t, team.id);
      const expiredCall = await insertCall(t, expiredMatch, {
        expiresAt: new Date(now() + 60_000),
      });
      const expiredApp = await insertApplication(t, expiredCall, user.id);
      t.harness.advance(120_000);
      for (const [callId, appId] of [
        [closedCall, closedApp],
        [expiredCall, expiredApp],
      ] as const) {
        for (const status of ['accepted', 'rejected'] as const) {
          await expectProblem(
            await api.decide(team.captain.headers, callId, appId, status),
            409,
            'call_closed',
          );
        }
      }
      expect(await rsvpOf(t, expiredMatch, user.id)).toBeNull();
    });

    it('3: cancelled, played, locked or started match (409 match_not_open); reject still works', async () => {
      const team = await teamFixture(t);
      for (const options of [
        { status: 'cancelled' as const },
        { status: 'played' as const },
        { status: 'locked' as const },
        { startsAt: new Date(now() - 60_000) },
      ]) {
        const matchId = await insertMatch(t, team.id, options);
        const callId = await insertCall(t, matchId, { expiresAt: new Date(now() + DAY_MS) });
        const user = await account(t);
        const appId = await insertApplication(t, callId, user.id);
        await expectProblem(
          await api.decide(team.captain.headers, callId, appId, 'accepted'),
          409,
          'match_not_open',
        );
        expect(await rsvpOf(t, matchId, user.id)).toBeNull();
        expect(await applicationStatus(t, appId)).toBe('pending');
      }
      const matchId = await insertMatch(t, team.id, { status: 'cancelled' });
      const callId = await insertCall(t, matchId);
      const user = await account(t);
      const appId = await insertApplication(t, callId, user.id);
      await expectJson(await api.decide(team.captain.headers, callId, appId, 'rejected'), 200);
    });

    it('3: a call that outlives the match start cannot add a player (409 match_not_open)', async () => {
      const team = await teamFixture(t);
      const matchId = await insertMatch(t, team.id, { startsAt: new Date(now() + 60_000) });
      const callId = await insertCall(t, matchId, { expiresAt: new Date(now() + DAY_MS) });
      const user = await account(t);
      const appId = await insertApplication(t, callId, user.id);
      t.harness.advance(120_000);
      const freshCaptain = await account(t);
      await addMember(t, team.id, freshCaptain.id, 'co_captain');
      await expectProblem(
        await api.decide(freshCaptain.headers, callId, appId, 'accepted'),
        409,
        'match_not_open',
      );
    });

    it('4: an applicant who joined the team or holds an RSVP meanwhile (409 already_participant)', async () => {
      const world = await callWorld({ missingCount: 3 });
      const joined = await applied(world);
      const rsvp = await applied(world);
      await addMember(t, world.team.id, joined.user.id, 'player');
      await insertRsvp(t, world.matchId, rsvp.user.id, 'out');
      for (const target of [joined, rsvp]) {
        await expectProblem(
          await api.decide(world.team.captain.headers, world.callId, target.id, 'accepted'),
          409,
          'already_participant',
        );
        expect(await applicationStatus(t, target.id)).toBe('pending');
      }
      expect(await rsvpOf(t, world.matchId, rsvp.user.id)).toBe('out');
    });

    it('5: no free slot (409 match_full)', async () => {
      const world = await callWorld({ missingCount: 2, slots: 4 });
      const a = await applied(world);
      await fillSlots(t, world.matchId, 4);
      await expectProblem(
        await api.decide(world.team.captain.headers, world.callId, a.id, 'accepted'),
        409,
        'match_full',
      );
      expect(await rsvpOf(t, world.matchId, a.user.id)).toBeNull();
    });
  });

  describe('races (row locks: team, match, call, application)', () => {
    it('two accepts for the last missing player: one wins, one 409, one RSVP', async () => {
      for (let round = 0; round < 3; round += 1) {
        const world = await callWorld({ missingCount: 1 });
        const a = await applied(world);
        const b = await applied(world);
        const responses = await Promise.all([
          api.decide(world.team.captain.headers, world.callId, a.id, 'accepted'),
          api.decide(world.team.coCaptain.headers, world.callId, b.id, 'accepted'),
        ]);
        expect(statuses(responses)).toEqual([200, 409]);
        const loser = responses.find((response) => response.status === 409);
        if (loser !== undefined) {
          await expectProblem(loser, 409, 'application_not_pending');
        }
        const rsvps = await t.db
          .select()
          .from(matchRsvps)
          .where(eq(matchRsvps.matchId, world.matchId));
        expect(rsvps).toHaveLength(1);
        expect(await callRow(t, world.callId)).toMatchObject({ status: 'closed', missingCount: 0 });
      }
    });

    it('two accepts for the last free slot: the match never exceeds its slots', async () => {
      for (let round = 0; round < 3; round += 1) {
        const world = await callWorld({ missingCount: 2, slots: 5 });
        await fillSlots(t, world.matchId, 3);
        const a = await applied(world);
        const b = await applied(world);
        const c = await applied(world);
        await t.db.insert(matchRsvps).values({
          matchId: world.matchId,
          userId: world.team.player.id,
          status: 'in',
        });
        const responses = await Promise.all([
          api.decide(world.team.captain.headers, world.callId, a.id, 'accepted'),
          api.decide(world.team.coCaptain.headers, world.callId, b.id, 'accepted'),
          api.decide(world.team.captain.headers, world.callId, c.id, 'accepted'),
        ]);
        expect(statuses(responses)).toEqual([200, 409, 409]);
        const confirmed = await t.db
          .select()
          .from(matchRsvps)
          .where(and(eq(matchRsvps.matchId, world.matchId), eq(matchRsvps.status, 'in')));
        expect(confirmed).toHaveLength(5);
      }
    });

    it('accept racing a member RSVP for the last slot: the match never exceeds its slots', async () => {
      for (let round = 0; round < 8; round += 1) {
        const world = await callWorld({ missingCount: 2, slots: 6 });
        await fillSlots(t, world.matchId, 5);
        const a = await applied(world);
        const [accept, rsvp] = await Promise.all([
          api.decide(world.team.captain.headers, world.callId, a.id, 'accepted'),
          setRsvp(world.team.player.headers, world.matchId, 'in'),
        ]);
        expect(rsvp.status, await rsvp.clone().text()).toBe(200);
        const confirmed = await t.db
          .select()
          .from(matchRsvps)
          .where(and(eq(matchRsvps.matchId, world.matchId), eq(matchRsvps.status, 'in')));
        expect(confirmed, `round ${round}`).toHaveLength(6);
        const playerStatus = await rsvpOf(t, world.matchId, world.team.player.id);
        if (accept.status === 200) {
          expect(playerStatus).toBe('waitlist');
          expect(await rsvpOf(t, world.matchId, a.user.id)).toBe('in');
        } else {
          await expectProblem(accept, 409, 'match_full');
          expect(playerStatus).toBe('in');
          expect(await applicationStatus(t, a.id)).toBe('pending');
        }
      }
    });

    it('accept racing the close: either accepted then closed, or closed and rejected', async () => {
      for (let round = 0; round < 4; round += 1) {
        const world = await callWorld({ missingCount: 2 });
        const a = await applied(world);
        const [accept, close] = await Promise.all([
          api.decide(world.team.captain.headers, world.callId, a.id, 'accepted'),
          api.close(world.team.coCaptain.headers, world.matchId),
        ]);
        expect(close.status).toBe(200);
        expect((await callRow(t, world.callId))?.status).toBe('closed');
        if (accept.status === 200) {
          expect(await applicationStatus(t, a.id)).toBe('accepted');
          expect(await rsvpOf(t, world.matchId, a.user.id)).toBe('in');
        } else {
          await expectProblem(accept, 409, 'application_not_pending');
          expect(await applicationStatus(t, a.id)).toBe('rejected');
          expect(await rsvpOf(t, world.matchId, a.user.id)).toBeNull();
        }
      }
    });

    it('accept racing the withdrawal: exactly one takes effect', async () => {
      for (let round = 0; round < 4; round += 1) {
        const world = await callWorld();
        const a = await applied(world);
        const responses = await Promise.all([
          api.decide(world.team.captain.headers, world.callId, a.id, 'accepted'),
          api.decide(a.user.headers, world.callId, a.id, 'withdrawn'),
        ]);
        expect(statuses(responses)).toEqual([200, 409]);
        const status = await applicationStatus(t, a.id);
        expect(await rsvpOf(t, world.matchId, a.user.id)).toBe(status === 'accepted' ? 'in' : null);
      }
    });

    it('applying racing the close: no pending application survives a closed call', async () => {
      for (let round = 0; round < 4; round += 1) {
        const world = await callWorld();
        const user = await account(t);
        const [apply] = await Promise.all([
          api.apply(user.headers, world.callId),
          api.close(world.team.captain.headers, world.matchId),
        ]);
        const pending = await t.db
          .select()
          .from(openCallApplications)
          .where(
            and(
              eq(openCallApplications.openCallId, world.callId),
              eq(openCallApplications.status, 'pending'),
            ),
          );
        expect(pending).toEqual([]);
        expect([201, 409]).toContain(apply.status);
      }
    });
  });

  it('a failing audit write rolls back the acceptance, the RSVP and the notification', async () => {
    const world = await callWorld({ missingCount: 1 });
    const a = await applied(world);
    const b = await applied(world);
    await failAuditFor(a.id, async () => {
      await expectProblem(
        await api.decide(world.team.captain.headers, world.callId, a.id, 'accepted'),
        500,
        'internal_error',
      );
    });
    expect(await applicationStatus(t, a.id)).toBe('pending');
    expect(await applicationStatus(t, b.id)).toBe('pending');
    expect(await rsvpOf(t, world.matchId, a.user.id)).toBeNull();
    expect(await callRow(t, world.callId)).toMatchObject({ status: 'open', missingCount: 1 });
    expect(await decidedJobs(t, a.id)).toEqual([]);
    expect(await decidedJobs(t, b.id)).toEqual([]);
  });

  it('logs of the whole flow carry no email, display name or message text', async () => {
    t.harness.logLines.length = 0;
    const world = await callWorld({ missingCount: 1 });
    const secretMessage = `ozel-mesaj-${label()}`;
    const a = await applied(world, secretMessage);
    await expectJson(await api.listApplications(world.team.captain.headers, world.callId), 200);
    await expectJson(
      await api.decide(world.team.captain.headers, world.callId, a.id, 'accepted'),
      200,
    );
    const late = await account(t);
    await expectProblem(await api.apply(late.headers, world.callId), 409, 'call_closed');
    const people = await t.db
      .select({ email: users.email, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, a.user.id));
    const log = t.harness.logLines.join('\n');
    expect(log).toContain('/api/v1/open-calls/[id]/applications');
    expect(log).not.toContain(secretMessage);
    for (const person of people) {
      expect(log).not.toContain(person.email);
      expect(log).not.toContain(person.displayName);
    }
    expect(log).not.toContain(a.id);
    const [match] = await t.db.select().from(matches).where(eq(matches.id, world.matchId));
    expect(match?.status).toBe('open');
  });
});
