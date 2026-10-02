import { randomBytes } from 'node:crypto';

import {
  type OpenCall,
  type OpenCallPublic,
  openCallPublicSchema,
  openCallSchema,
  paginatedResponseSchema,
} from '@kadro/contracts';
import { auditLogs, districts, openCallApplications, openCalls, teams } from '@kadro/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { expectProblem } from '../support/http';
import { account, anonymous, DAY_MS, expectJson, teamFixture } from '../teams/support';
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
  insertVenue,
  label,
  pushJobs,
  setupCallsHarness,
  statuses,
} from './support';

/**
 * Open calls: publish and close (matrix §3.5 footnotes 19 and 30, ADR-0037) and the public list
 * (footnote 18, ADR-0039), against a real database and real job queues.
 */

let t: CallsHarness;
const HOUR_MS = 3_600_000;

beforeAll(async () => {
  t = await setupCallsHarness('web_calls_open');
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

function publishBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    missingCount: 2,
    position: null,
    level: 'regular',
    expiresAt: new Date(now() + 2 * HOUR_MS).toISOString(),
    ...overrides,
  };
}

/** A district of its own (and province), so list assertions see only this test's calls. */
async function freshDistrict(province = `il-${label()}`): Promise<string> {
  const [row] = await t.db
    .insert(districts)
    .values({
      il: `Il ${label()}`,
      ilce: `Ilce ${label()}`,
      ilSlug: province,
      slug: `ilce-${label()}`,
      centroid: { lng: 30, lat: 40 },
    })
    .returning({ id: districts.id });
  return row?.id ?? '';
}

/** A user who is a guest of the match: accepted application on its call plus RSVP `in`. */
async function guestOf(matchId: string) {
  const guest = await account(t);
  const callId = await insertCall(t, matchId, { status: 'closed' });
  await insertApplication(t, callId, guest.id, 'accepted');
  await insertRsvp(t, matchId, guest.id, 'in');
  return guest;
}

describe('POST matches/:id/open-call (publish)', () => {
  it('captain publishes; district defaults to the team district; audit row without personal data', async () => {
    const team = await teamFixture(t);
    const matchId = await insertMatch(t, team.id);
    const body = await expectJson<OpenCall>(
      await api.publish(team.captain.headers, matchId, publishBody({ position: 'GK' })),
      201,
    );
    expect(openCallSchema.parse(body)).toMatchObject({
      matchId,
      missingCount: 2,
      position: 'GK',
      level: 'regular',
      districtId: t.districtId,
      status: 'open',
    });
    const audits = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'opencall.published'), eq(auditLogs.targetId, body.id)));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorId).toBe(team.captain.id);
    expect(audits[0]?.metadata).toEqual({ matchId, missingCount: 2 });
  });

  it("co-captain publishes; the directory venue's district wins over the team's", async () => {
    const team = await teamFixture(t);
    const venue = await insertVenue(t, { districtId: t.otherDistrictId });
    const matchId = await insertMatch(t, team.id, { venueId: venue.id });
    const body = await expectJson<OpenCall>(
      await api.publish(team.coCaptain.headers, matchId, publishBody()),
      201,
    );
    expect(body.districtId).toBe(t.otherDistrictId);
  });

  it('accepts an explicit existing district and refuses an unknown one (400)', async () => {
    const team = await teamFixture(t);
    const matchId = await insertMatch(t, team.id);
    const unknown = '019a0000-0000-7000-8000-000000000000';
    const bad = await api.publish(
      team.captain.headers,
      matchId,
      publishBody({ districtId: unknown }),
    );
    expect((await expectProblem(bad, 400, 'validation_failed')).errors).toEqual([
      { path: 'body.districtId', issue: 'not_found' },
    ]);
    const body = await expectJson<OpenCall>(
      await api.publish(
        team.captain.headers,
        matchId,
        publishBody({ districtId: t.otherDistrictId }),
      ),
      201,
    );
    expect(body.districtId).toBe(t.otherDistrictId);
  });

  it('answers 401, then 404 for outsiders and staff of no team, then 403 for players and guests', async () => {
    const team = await teamFixture(t);
    const matchId = await insertMatch(t, team.id);
    const outsider = await account(t);
    const moderator = await account(t, { role: 'moderator' });
    const admin = await account(t, { role: 'admin' });
    const guest = await guestOf(matchId);
    await expectProblem(
      await api.publish(anonymous(), matchId, publishBody()),
      401,
      'unauthenticated',
    );
    for (const actor of [outsider, moderator, admin]) {
      await expectProblem(
        await api.publish(actor.headers, matchId, publishBody()),
        404,
        'not_found',
      );
    }
    for (const actor of [team.player, guest]) {
      await expectProblem(
        await api.publish(actor.headers, matchId, publishBody()),
        403,
        'forbidden',
      );
    }
    await expectProblem(
      await api.publish(
        team.captain.headers,
        '019a0000-0000-7000-8000-000000000001',
        publishBody(),
      ),
      404,
      'not_found',
    );
    await expectProblem(
      await api.publish(team.captain.headers, 'not-a-uuid', publishBody()),
      400,
      'validation_failed',
    );
    const calls = await t.db.select().from(openCalls).where(eq(openCalls.matchId, matchId));
    expect(calls.filter((call) => call.status === 'open')).toEqual([]);
  });

  it('a Pro-locked team cannot publish (403 entitlement_required)', async () => {
    const team = await teamFixture(t, { isProLocked: true });
    const matchId = await insertMatch(t, team.id);
    await expectProblem(
      await api.publish(team.captain.headers, matchId, publishBody()),
      403,
      'entitlement_required',
    );
  });

  it('rejects server-only and unknown fields (matrix §4.4) without writing', async () => {
    const team = await teamFixture(t);
    const matchId = await insertMatch(t, team.id);
    for (const extra of [
      { status: 'closed' },
      { matchId },
      { id: '019a0000-0000-7000-8000-000000000002' },
      { createdAt: new Date().toISOString() },
    ]) {
      await expectProblem(
        await api.publish(team.captain.headers, matchId, publishBody(extra)),
        400,
        'validation_failed',
      );
    }
    for (const invalid of [{ missingCount: 0 }, { missingCount: 30 }, { level: 'pro' }]) {
      await expectProblem(
        await api.publish(team.captain.headers, matchId, publishBody(invalid)),
        400,
        'validation_failed',
      );
    }
    expect(await t.db.select().from(openCalls).where(eq(openCalls.matchId, matchId))).toEqual([]);
  });

  it('requires an open match in the future (409 match_not_open)', async () => {
    const team = await teamFixture(t);
    for (const status of ['draft', 'locked', 'played', 'cancelled'] as const) {
      const matchId = await insertMatch(t, team.id, { status });
      await expectProblem(
        await api.publish(team.captain.headers, matchId, publishBody()),
        409,
        'match_not_open',
      );
    }
    const started = await insertMatch(t, team.id, { startsAt: new Date(now() - 60_000) });
    await expectProblem(
      await api.publish(team.captain.headers, started, publishBody()),
      409,
      'match_not_open',
    );
  });

  it('allows one live call per match (409 open_call_exists)', async () => {
    const team = await teamFixture(t);
    const matchId = await insertMatch(t, team.id);
    await expectJson(await api.publish(team.captain.headers, matchId, publishBody()), 201);
    await expectProblem(
      await api.publish(team.coCaptain.headers, matchId, publishBody()),
      409,
      'open_call_exists',
    );
  });

  it('five concurrent publishes for one match store exactly one call', async () => {
    const team = await teamFixture(t);
    const matchId = await insertMatch(t, team.id);
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        api.publish(
          index % 2 === 0 ? team.captain.headers : team.coCaptain.headers,
          matchId,
          publishBody(),
        ),
      ),
    );
    expect(statuses(responses)).toEqual([201, 409, 409, 409, 409]);
    for (const response of responses.filter((candidate) => candidate.status === 409)) {
      await expectProblem(response, 409, 'open_call_exists');
    }
    const live = await t.db
      .select()
      .from(openCalls)
      .where(and(eq(openCalls.matchId, matchId), eq(openCalls.status, 'open')));
    expect(live).toHaveLength(1);
  });

  it('ends a stored-open but expired call as expired, answers its applicants, then publishes', async () => {
    const team = await teamFixture(t);
    const matchId = await insertMatch(t, team.id);
    const stale = await insertCall(t, matchId, { expiresAt: new Date(now() - 60_000) });
    const applicant = await account(t);
    const pending = await insertApplication(t, stale, applicant.id);
    const body = await expectJson<OpenCall>(
      await api.publish(team.captain.headers, matchId, publishBody()),
      201,
    );
    expect(body.id).not.toBe(stale);
    expect((await callRow(t, stale))?.status).toBe('expired');
    expect(await applicationStatus(t, pending)).toBe('rejected');
    const jobs = await pushJobs(t, pending);
    expect(jobs.map((job) => job.data)).toEqual([
      {
        type: 'application.decided',
        userId: applicant.id,
        refId: pending,
        idempotencyKey: `push:decided:${pending}`,
      },
    ]);
  });

  it('bounds the missing count by the free slots (409 invalid_missing_count)', async () => {
    const team = await teamFixture(t);
    const matchId = await insertMatch(t, team.id, { slots: 10 });
    await fillSlots(t, matchId, 7);
    await insertRsvp(t, matchId, team.player.id, 'maybe');
    await expectProblem(
      await api.publish(team.captain.headers, matchId, publishBody({ missingCount: 4 })),
      409,
      'invalid_missing_count',
    );
    const body = await expectJson<OpenCall>(
      await api.publish(team.captain.headers, matchId, publishBody({ missingCount: 3 })),
      201,
    );
    expect(body.missingCount).toBe(3);
  });

  it('a full match cannot publish any count', async () => {
    const team = await teamFixture(t);
    const matchId = await insertMatch(t, team.id, { slots: 4 });
    await fillSlots(t, matchId, 4);
    await expectProblem(
      await api.publish(team.captain.headers, matchId, publishBody({ missingCount: 1 })),
      409,
      'invalid_missing_count',
    );
  });

  it('expiry must lie between now + 15 min and the match start (409 invalid_call_expiry)', async () => {
    const team = await teamFixture(t);
    const startsAt = new Date(now() + 6 * HOUR_MS);
    const matchId = await insertMatch(t, team.id, { startsAt });
    for (const expiresAt of [
      new Date(now() + 14 * 60_000),
      new Date(now() - HOUR_MS),
      new Date(startsAt.getTime() + 1_000),
    ]) {
      await expectProblem(
        await api.publish(
          team.captain.headers,
          matchId,
          publishBody({ expiresAt: expiresAt.toISOString() }),
        ),
        409,
        'invalid_call_expiry',
      );
    }
    await expectJson(
      await api.publish(
        team.captain.headers,
        matchId,
        publishBody({ expiresAt: startsAt.toISOString() }),
      ),
      201,
    );
  });

  it('group C: the 11th publish of a user within a day is 429, others are unaffected', async () => {
    const limited = await account(t);
    const other = await account(t);
    const missing = () => `019a0000-0000-7000-8000-${randomBytes(6).toString('hex')}`;
    for (let index = 0; index < 10; index += 1) {
      await expectProblem(
        await api.publish(limited.headers, missing(), publishBody()),
        404,
        'not_found',
      );
    }
    const denied = await api.publish(limited.headers, missing(), publishBody());
    await expectProblem(denied.clone(), 429, 'rate_limited');
    expect(Number(denied.headers.get('retry-after'))).toBeGreaterThan(0);
    await expectProblem(
      await api.publish(other.headers, missing(), publishBody()),
      404,
      'not_found',
    );
    // Reads and other groups are not charged against C.
    await expectJson(await api.listOpenCalls(limited.headers), 200);
    await expectProblem(await api.close(limited.headers, missing()), 404, 'not_found');
  });
});

describe('PATCH matches/:id/open-call (close)', () => {
  it('closes the call, rejects only pending applications and notifies those applicants', async () => {
    const team = await teamFixture(t);
    const matchId = await insertMatch(t, team.id);
    const callId = await insertCall(t, matchId, { missingCount: 3 });
    const [waiting, other, accepted, withdrawn] = await Promise.all(
      Array.from({ length: 4 }, () => account(t)),
    );
    if (!waiting || !other || !accepted || !withdrawn) {
      throw new Error('accounts missing');
    }
    const pendingA = await insertApplication(t, callId, waiting.id);
    const pendingB = await insertApplication(t, callId, other.id);
    const acceptedId = await insertApplication(t, callId, accepted.id, 'accepted');
    const withdrawnId = await insertApplication(t, callId, withdrawn.id, 'withdrawn');

    const body = await expectJson<OpenCall>(await api.close(team.coCaptain.headers, matchId), 200);
    expect(openCallSchema.parse(body)).toMatchObject({ id: callId, status: 'closed' });
    expect(await applicationStatus(t, pendingA)).toBe('rejected');
    expect(await applicationStatus(t, pendingB)).toBe('rejected');
    expect(await applicationStatus(t, acceptedId)).toBe('accepted');
    expect(await applicationStatus(t, withdrawnId)).toBe('withdrawn');
    for (const [id, user] of [
      [pendingA, waiting.id],
      [pendingB, other.id],
    ] as const) {
      expect((await pushJobs(t, id)).map((job) => job.data)).toEqual([
        {
          type: 'application.decided',
          userId: user,
          refId: id,
          idempotencyKey: `push:decided:${id}`,
        },
      ]);
    }
    expect(await pushJobs(t, acceptedId)).toEqual([]);
    expect(await pushJobs(t, withdrawnId)).toEqual([]);
    const audits = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'opencall.closed'), eq(auditLogs.targetId, callId)));
    expect(audits.map((row) => row.metadata)).toEqual([{ matchId, rejected: 2 }]);
    await expectProblem(await api.close(team.captain.headers, matchId), 404, 'not_found');
  });

  it('matrix: anon 401, outsider 404, player and guest 403; nothing changes', async () => {
    const team = await teamFixture(t);
    const matchId = await insertMatch(t, team.id);
    const guest = await guestOf(matchId);
    const callId = await insertCall(t, matchId);
    const outsider = await account(t);
    await expectProblem(await api.close(anonymous(), matchId), 401, 'unauthenticated');
    await expectProblem(await api.close(outsider.headers, matchId), 404, 'not_found');
    await expectProblem(await api.close(team.player.headers, matchId), 403, 'forbidden');
    await expectProblem(await api.close(guest.headers, matchId), 403, 'forbidden');
    expect((await callRow(t, callId))?.status).toBe('open');
  });

  it('accepts only status "closed" and no other field', async () => {
    const team = await teamFixture(t);
    const matchId = await insertMatch(t, team.id);
    const callId = await insertCall(t, matchId);
    for (const json of [
      { status: 'open' },
      { status: 'expired' },
      { status: 'closed', missingCount: 1 },
      {},
    ]) {
      await expectProblem(
        await api.close(team.captain.headers, matchId, json),
        400,
        'validation_failed',
      );
    }
    expect((await callRow(t, callId))?.status).toBe('open');
  });

  it('a failing write after the notifications rolls back the close and its jobs', async () => {
    const team = await teamFixture(t);
    const matchId = await insertMatch(t, team.id);
    const callId = await insertCall(t, matchId);
    const applicant = await account(t);
    const pending = await insertApplication(t, callId, applicant.id);
    const fn = `fail_audit_${label()}`;
    await t.database.client.pool.query(
      `create function ${fn}() returns trigger language plpgsql as $$ begin if new.target_id = '${callId}' then raise exception 'forced failure'; end if; return new; end $$`,
    );
    await t.database.client.pool.query(
      `create trigger ${fn} before insert on audit_logs for each row execute function ${fn}()`,
    );
    try {
      await expectProblem(await api.close(team.captain.headers, matchId), 500, 'internal_error');
    } finally {
      await t.database.client.pool.query(`drop trigger ${fn} on audit_logs`);
      await t.database.client.pool.query(`drop function ${fn}()`);
    }
    expect((await callRow(t, callId))?.status).toBe('open');
    expect(await applicationStatus(t, pending)).toBe('pending');
    expect(await pushJobs(t, pending)).toEqual([]);
  });
});

describe('GET open-calls (public list)', () => {
  async function publicCalls(
    headers: Record<string, string>,
    query: Record<string, string>,
  ): Promise<{ items: OpenCallPublic[]; nextCursor: string | null }> {
    return paginatedResponseSchema(openCallPublicSchema).parse(
      await expectJson(await api.listOpenCalls(headers, query), 200),
    );
  }

  it('lists only open, unexpired calls of open future matches, as the public projection', async () => {
    const district = await freshDistrict();
    const team = await teamFixture(t);
    const verified = await insertVenue(t, { verified: true });
    const unverified = await insertVenue(t, { verified: false, createdBy: team.captain.id });
    const visibleA = await insertCall(t, await insertMatch(t, team.id, { venueId: verified.id }), {
      districtId: district,
    });
    const visibleB = await insertCall(
      t,
      await insertMatch(t, team.id, { venueId: unverified.id }),
      {
        districtId: district,
      },
    );
    const visibleC = await insertCall(t, await insertMatch(t, team.id), { districtId: district });
    for (const status of ['closed', 'expired', 'removed'] as const) {
      await insertCall(t, await insertMatch(t, team.id), { districtId: district, status });
    }
    await insertCall(t, await insertMatch(t, team.id), {
      districtId: district,
      expiresAt: new Date(now() - 1_000),
    });
    await insertCall(t, await insertMatch(t, team.id, { status: 'locked' }), {
      districtId: district,
    });
    await insertCall(t, await insertMatch(t, team.id, { startsAt: new Date(now() - 60_000) }), {
      districtId: district,
      expiresAt: new Date(now() + HOUR_MS),
    });

    for (const headers of [anonymous(), team.player.headers]) {
      const page = await publicCalls(headers, { district });
      expect(page.items.map((item) => item.id).sort()).toEqual(
        [visibleA, visibleB, visibleC].sort(),
      );
      const byId = new Map(page.items.map((item) => [item.id, item]));
      expect(byId.get(visibleA)?.venue).toEqual({ name: verified.name, slug: verified.slug });
      expect(byId.get(visibleB)?.venue).toBeNull();
      expect(byId.get(visibleC)?.venue).toBeNull();
      const [teamRow] = await t.db.select().from(teams).where(eq(teams.id, team.id));
      for (const item of page.items) {
        expect(Object.keys(item).sort()).toEqual(
          [
            'districtId',
            'expiresAt',
            'format',
            'id',
            'level',
            'missingCount',
            'position',
            'startsAt',
            'teamName',
            'venue',
          ].sort(),
        );
        expect(item.teamName).toBe(teamRow?.name);
      }
      const text = JSON.stringify(page);
      expect(text).not.toContain(team.captain.id);
      expect(text).not.toContain(unverified.name);
    }
  });

  it('filters by district, province, level, position (any-position calls included) and time window', async () => {
    const province = `il-${label()}`;
    const first = await freshDistrict(province);
    const second = await freshDistrict(province);
    const elsewhere = await freshDistrict();
    const team = await teamFixture(t);
    const soon = new Date(now() + 3 * DAY_MS);
    const later = new Date(now() + 10 * DAY_MS);
    const gk = await insertCall(t, await insertMatch(t, team.id, { startsAt: soon }), {
      districtId: first,
      position: 'GK',
      level: 'casual',
    });
    const any = await insertCall(t, await insertMatch(t, team.id, { startsAt: later }), {
      districtId: second,
      position: null,
      level: 'competitive',
    });
    const fwd = await insertCall(t, await insertMatch(t, team.id, { startsAt: later }), {
      districtId: second,
      position: 'FWD',
      level: 'casual',
    });
    await insertCall(t, await insertMatch(t, team.id), { districtId: elsewhere });

    const ids = async (query: Record<string, string>) =>
      (await publicCalls(anonymous(), query)).items.map((item) => item.id).sort();
    expect(await ids({ province })).toEqual([gk, any, fwd].sort());
    expect(await ids({ district: first })).toEqual([gk]);
    expect(await ids({ province, level: 'casual' })).toEqual([gk, fwd].sort());
    expect(await ids({ province, position: 'GK' })).toEqual([gk, any].sort());
    expect(await ids({ province, position: 'DEF' })).toEqual([any]);
    expect(
      await ids({
        province,
        from: new Date(soon.getTime() - HOUR_MS).toISOString(),
        to: new Date(soon.getTime() + HOUR_MS).toISOString(),
      }),
    ).toEqual([gk]);

    const unknownDistrict = await api.listOpenCalls(anonymous(), {
      district: '019a0000-0000-7000-8000-000000000003',
    });
    expect((await expectProblem(unknownDistrict, 400, 'validation_failed')).errors).toEqual([
      { path: 'query.district', issue: 'not_found' },
    ]);
    await expectProblem(
      await api.listOpenCalls(anonymous(), { province: `yok-${label()}` }),
      400,
      'validation_failed',
    );
    await expectProblem(
      await api.listOpenCalls(anonymous(), { province, district: first }),
      400,
      'validation_failed',
    );
    await expectProblem(
      await api.listOpenCalls(anonymous(), {
        from: new Date(now()).toISOString(),
        to: new Date(now() + 32 * DAY_MS).toISOString(),
      }),
      400,
      'validation_failed',
    );
    await expectProblem(
      await api.listOpenCalls(anonymous(), { teamId: team.id }),
      400,
      'validation_failed',
    );
  });

  it('pages by match start then id; every call exactly once; cursors bound to their filters', async () => {
    const district = await freshDistrict();
    const team = await teamFixture(t);
    const startsAt = new Date(now() + 4 * DAY_MS);
    const created: { id: string; startsAt: number }[] = [];
    for (let index = 0; index < 7; index += 1) {
      // Three calls share one start time, so the id tie-breaker is exercised.
      const at = index < 3 ? startsAt : new Date(startsAt.getTime() + index * HOUR_MS);
      const id = await insertCall(t, await insertMatch(t, team.id, { startsAt: at }), {
        districtId: district,
      });
      created.push({ id, startsAt: at.getTime() });
    }
    const expected = [...created]
      .sort((a, b) => a.startsAt - b.startsAt || (a.id < b.id ? -1 : 1))
      .map((call) => call.id);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await publicCalls(anonymous(), {
        district,
        limit: '3',
        ...(cursor === null ? {} : { cursor }),
      });
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      pages += 1;
      if (pages === 1 && cursor !== null) {
        await expectProblem(
          await api.listOpenCalls(anonymous(), { district, level: 'casual', cursor }),
          400,
          'invalid_cursor',
        );
        const tampered = `${cursor.slice(0, -2)}${cursor.endsWith('A') ? 'B' : 'A'}A`;
        await expectProblem(
          await api.listOpenCalls(anonymous(), { district, cursor: tampered }),
          400,
          'invalid_cursor',
        );
      }
    } while (cursor !== null);
    expect(pages).toBe(3);
    expect(seen).toEqual(expected);
  });

  it('keeps applicant and member data out of the list after applications exist', async () => {
    const district = await freshDistrict();
    const team = await teamFixture(t);
    const matchId = await insertMatch(t, team.id);
    const callId = await insertCall(t, matchId, { districtId: district });
    const applicant = await account(t);
    await insertApplication(t, callId, applicant.id, 'pending', `Mesaj ${label()}`);
    const text = JSON.stringify(await publicCalls(anonymous(), { district }));
    expect(text).toContain(callId);
    expect(text).not.toContain(applicant.id);
    expect(text).not.toContain('Mesaj');
    expect(text).not.toContain(matchId);
    const rows = await t.db
      .select()
      .from(openCallApplications)
      .where(eq(openCallApplications.openCallId, callId));
    expect(rows).toHaveLength(1);
  });
});
