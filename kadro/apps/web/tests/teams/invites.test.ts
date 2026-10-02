import { createHash, randomBytes } from 'node:crypto';

import {
  acceptInviteResponseSchema,
  createInviteResponseSchema,
  invitePreviewSchema,
  LIMITS,
  paginatedResponseSchema,
  RATE_LIMIT_GROUPS,
  teamInviteSchema,
} from '@kadro/contracts';
import { auditLogs, teamInvites, teamMembers } from '@kadro/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { groupLimitKeys } from '../../lib/server/group-limits';
import { generateInviteCode, inviteCodeHash } from '../../lib/server/teams/invites';
import { expectProblem } from '../support/http';
import { storedJobs } from '../support/jobs';
import {
  type Account,
  account,
  addMember,
  anonymous,
  api,
  expectJson,
  insertInvite,
  memberRole,
  type TeamsHarness,
  setupTeamsHarness,
  teamFixture,
  uniqueIp,
  webAccount,
} from './support';

/**
 * Invite endpoints (ADR-0011, ADR-0034; matrix §3.3 footnotes 7, 28, 29): the code is shown once
 * and stored only as a hash, list and preview never reveal it, every unusable code is the same
 * 404, acceptance is atomic under concurrency, and group I limits code probing.
 */

let t: TeamsHarness;

beforeAll(async () => {
  t = await setupTeamsHarness('web_teams_invites');
});

afterAll(async () => {
  await t.database.dispose();
});

const listSchema = paginatedResponseSchema(teamInviteSchema);

/** `team.member_joined` push jobs of one team. */
async function joinedJobs(teamId: string) {
  return (await storedJobs(t.database.url, 'push.send')).filter(
    (job) => job.data.type === 'team.member_joined' && job.data.refId === teamId,
  );
}

/** `team_members.id` of the current membership of `userId` in `teamId`. */
async function membershipId(teamId: string, userId: string): Promise<string> {
  const [row] = await t.db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  if (row === undefined) {
    throw new Error('membership not found');
  }
  return row.id;
}

async function inviteRow(id: string) {
  const [row] = await t.db.select().from(teamInvites).where(eq(teamInvites.id, id));
  return row;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('POST /api/v1/teams/:id/invites (invite.create)', () => {
  it('returns the code once, stores only its SHA-256 and audits without the code', async () => {
    const team = await teamFixture(t);
    const created = createInviteResponseSchema.parse(
      await expectJson(await api.createInvite(team.coCaptain.headers, team.id, {}), 201),
    );
    expect(created.code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(Buffer.from(created.code, 'base64url')).toHaveLength(16);
    expect(created.url).toBe(`${t.harness.env.WEB_ORIGIN}/mac/${created.code}`);
    expect(created.maxUses).toBe(LIMITS.inviteMaxUses.default);
    expect(new Date(created.expiresAt).getTime()).toBe(
      t.harness.runtime.now().getTime() + LIMITS.inviteExpiresInSeconds.default * 1_000,
    );

    const row = await inviteRow(created.inviteId);
    expect(row?.codeHash).toBe(sha256(created.code));
    expect(JSON.stringify(row)).not.toContain(created.code);
    const audit = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'invite.created'), eq(auditLogs.targetId, created.inviteId)));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorId).toBe(team.coCaptain.id);
    expect(JSON.stringify(audit)).not.toContain(created.code);
    expect(audit[0]?.metadata).toEqual({
      teamId: team.id,
      maxUses: LIMITS.inviteMaxUses.default,
      expiresInSeconds: LIMITS.inviteExpiresInSeconds.default,
    });
  });

  it('keeps the code out of every log line of the create, preview and accept flow', async () => {
    const team = await teamFixture(t);
    const joiner = await account(t);
    const linesBefore = t.harness.logLines.length;
    const created = createInviteResponseSchema.parse(
      await expectJson(await api.createInvite(team.captain.headers, team.id, { maxUses: 2 }), 201),
    );
    await expectJson(await api.previewInvite(anonymous(), created.code), 200);
    await expectJson(await api.acceptInvite(joiner.headers, created.code), 200);
    await expectProblem(
      await api.acceptInvite(joiner.headers, created.code),
      409,
      'already_participant',
    );
    const lines = t.harness.logLines.slice(linesBefore);
    expect(lines.length).toBeGreaterThanOrEqual(4);
    const sample = lines.join('\n');
    expect(sample).toContain('/api/v1/invites/[code]/accept');
    expect(sample).not.toContain(created.code);
    expect(sample).not.toContain(sha256(created.code));
  });

  it('accepts the documented ranges and rejects values outside them', async () => {
    const team = await teamFixture(t);
    const created = createInviteResponseSchema.parse(
      await expectJson(
        await api.createInvite(team.captain.headers, team.id, {
          expiresInSeconds: LIMITS.inviteExpiresInSeconds.min,
          maxUses: LIMITS.inviteMaxUses.max,
        }),
        201,
      ),
    );
    expect(created.maxUses).toBe(LIMITS.inviteMaxUses.max);
    for (const body of [
      { expiresInSeconds: LIMITS.inviteExpiresInSeconds.min - 1 },
      { expiresInSeconds: LIMITS.inviteExpiresInSeconds.max + 1 },
      { maxUses: 0 },
      { maxUses: LIMITS.inviteMaxUses.max + 1 },
      { maxUses: 1.5 },
      { code: generateInviteCode() },
      { uses: 0 },
      { codeHash: sha256('x') },
      { teamId: team.id },
    ]) {
      await expectProblem(
        await api.createInvite(team.captain.headers, team.id, body),
        400,
        'validation_failed',
      );
    }
  });

  it('answers player 403, outsider 404, unverified staff 403 email_unverified, Pro lock 403', async () => {
    const team = await teamFixture(t);
    const stranger = await account(t);
    await expectProblem(await api.createInvite(team.player.headers, team.id), 403, 'forbidden');
    await expectProblem(await api.createInvite(stranger.headers, team.id), 404, 'not_found');
    const unverified = await account(t, { verified: false });
    await addMember(t, team.id, unverified.id, 'co_captain');
    await expectProblem(
      await api.createInvite(unverified.headers, team.id),
      403,
      'email_unverified',
    );
    const locked = await teamFixture(t, { isProLocked: true });
    await expectProblem(
      await api.createInvite(locked.captain.headers, locked.id),
      403,
      'entitlement_required',
    );
    await expectProblem(await api.createInvite(anonymous(), team.id), 401, 'unauthenticated');
    expect(await t.db.select().from(teamInvites).where(eq(teamInvites.teamId, team.id))).toEqual(
      [],
    );
  });

  it('allows at most 10 live invites per team (409 invite_limit); spent ones do not count', async () => {
    const team = await teamFixture(t);
    await insertInvite(t, team.id, { expiresAt: new Date(t.harness.runtime.now().getTime() - 1) });
    await insertInvite(t, team.id, { maxUses: 1, uses: 1 });
    for (let index = 0; index < LIMITS.activeInvitesPerTeam; index += 1) {
      await expectJson(await api.createInvite(team.captain.headers, team.id), 201);
    }
    await expectProblem(
      await api.createInvite(team.coCaptain.headers, team.id),
      409,
      'invite_limit',
    );
  });
});

describe('GET /api/v1/teams/:id/invites (invite.list)', () => {
  it('lists every invite of the team, newest first, without codes, by cursor', async () => {
    const team = await teamFixture(t);
    const other = await teamFixture(t);
    await insertInvite(t, other.id);
    const codes: string[] = [];
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const created = createInviteResponseSchema.parse(
        await expectJson(await api.createInvite(team.captain.headers, team.id), 201),
      );
      codes.push(created.code);
      ids.push(created.inviteId);
      t.harness.advance(1);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: Record<string, string> =
        cursor === null ? { limit: '2' } : { limit: '2', cursor };
      const response = await api.listInvites(team.coCaptain.headers, team.id, query);
      const text = await response.clone().text();
      for (const code of codes) {
        expect(text).not.toContain(code);
      }
      const page = listSchema.parse(await expectJson(response, 200));
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual([...ids].reverse());
  });

  it('answers player 403 and outsider 404; a cursor of another team is refused', async () => {
    const team = await teamFixture(t);
    const other = await teamFixture(t);
    await insertInvite(t, team.id);
    await insertInvite(t, team.id);
    await expectProblem(await api.listInvites(team.player.headers, team.id), 403, 'forbidden');
    await expectProblem(await api.listInvites(other.captain.headers, team.id), 404, 'not_found');
    const first = listSchema.parse(
      await expectJson(await api.listInvites(team.captain.headers, team.id, { limit: '1' }), 200),
    );
    await addMember(t, other.id, team.captain.id, 'co_captain');
    await expectProblem(
      await api.listInvites(team.captain.headers, other.id, {
        limit: '1',
        cursor: first.nextCursor ?? '',
      }),
      400,
      'invalid_cursor',
    );
  });
});

describe('DELETE /api/v1/teams/:id/invites/:inviteId (invite.revoke)', () => {
  it('ends the invite now and audits; the code then answers 404', async () => {
    const team = await teamFixture(t);
    const invite = await insertInvite(t, team.id);
    const joiner = await account(t);
    const response = await api.revokeInvite(team.coCaptain.headers, team.id, invite.id);
    expect(response.status).toBe(204);
    expect((await inviteRow(invite.id))?.expiresAt.getTime()).toBe(
      t.harness.runtime.now().getTime(),
    );
    const audit = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'invite.revoked'), eq(auditLogs.targetId, invite.id)));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorId).toBe(team.coCaptain.id);
    t.harness.advance(1);
    await expectProblem(await api.previewInvite(anonymous(), invite.code), 404, 'not_found');
    await expectProblem(await api.acceptInvite(joiner.headers, invite.code), 404, 'not_found');
    // Revoking again is a no-op without a second audit row.
    expect((await api.revokeInvite(team.captain.headers, team.id, invite.id)).status).toBe(204);
    const again = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'invite.revoked'), eq(auditLogs.targetId, invite.id)));
    expect(again).toHaveLength(1);
  });

  it('answers player 403, outsider 404 and an invite of another team 404 (nested id)', async () => {
    const team = await teamFixture(t);
    const other = await teamFixture(t);
    const invite = await insertInvite(t, team.id);
    const foreign = await insertInvite(t, other.id);
    await expectProblem(
      await api.revokeInvite(team.player.headers, team.id, invite.id),
      403,
      'forbidden',
    );
    await expectProblem(
      await api.revokeInvite(other.captain.headers, team.id, invite.id),
      404,
      'not_found',
    );
    await expectProblem(
      await api.revokeInvite(team.captain.headers, team.id, foreign.id),
      404,
      'not_found',
    );
    for (const id of [invite.id, foreign.id]) {
      expect((await inviteRow(id))?.expiresAt.getTime()).toBeGreaterThan(
        t.harness.runtime.now().getTime(),
      );
    }
  });
});

describe('GET /api/v1/invites/:code (invite.preview)', () => {
  it('shows team name, badge, district and member count only, to anyone holding the code', async () => {
    const team = await teamFixture(t);
    const invite = await insertInvite(t, team.id);
    for (const headers of [
      anonymous(),
      (await account(t)).headers,
      (await webAccount(t)).headers,
    ]) {
      const response = await api.previewInvite(headers, invite.code);
      const text = await response.clone().text();
      const preview = invitePreviewSchema.parse(await expectJson(response, 200));
      expect(preview.team.memberCount).toBe(3);
      expect(preview.team.districtId).toBe(t.districtId);
      expect(text).not.toContain(team.captain.id);
      expect(text).not.toContain(team.id);
      expect(text).not.toContain('Oyuncu');
    }
  });

  it('answers unknown, expired, revoked and exhausted codes with one identical 404', async () => {
    const team = await teamFixture(t);
    const now = t.harness.runtime.now().getTime();
    const expired = await insertInvite(t, team.id, { expiresAt: new Date(now - 1) });
    const exactlyNow = await insertInvite(t, team.id, { expiresAt: new Date(now) });
    const exhausted = await insertInvite(t, team.id, { maxUses: 3, uses: 3 });
    const revoked = await insertInvite(t, team.id);
    await api.revokeInvite(team.captain.headers, team.id, revoked.id);
    const unknown = generateInviteCode();
    const bodies = [];
    for (const code of [unknown, expired.code, exactlyNow.code, exhausted.code, revoked.code]) {
      const body = await expectProblem(
        await api.previewInvite(anonymous(), code),
        404,
        'not_found',
      );
      const { requestId: _requestId, ...rest } = body;
      bodies.push(rest);
    }
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
  });

  it('rejects malformed codes by schema (400) without a lookup', async () => {
    for (const code of [
      'short',
      `${generateInviteCode()}x`,
      'a'.repeat(21) + '=',
      'ü'.repeat(22),
    ]) {
      await expectProblem(await api.previewInvite(anonymous(), code), 400, 'validation_failed');
    }
  });

  it('limits code probing per address (group I: 20 per hour → 429 with Retry-After)', async () => {
    const team = await teamFixture(t);
    const invite = await insertInvite(t, team.id);
    const ip = uniqueIp();
    for (let index = 0; index < RATE_LIMIT_GROUPS.I.max; index += 1) {
      const code = index === 0 ? invite.code : generateInviteCode();
      const response = await api.previewInvite(anonymous(ip), code);
      expect([200, 404]).toContain(response.status);
    }
    const limited = await api.previewInvite(anonymous(ip), invite.code);
    await expectProblem(limited.clone(), 429, 'rate_limited');
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    // Another address is not affected.
    await expectJson(await api.previewInvite(anonymous(), invite.code), 200);
    t.harness.advance(RATE_LIMIT_GROUPS.I.windowSeconds * 1_000 + 300_000);
    await expectJson(await api.previewInvite(anonymous(ip), invite.code), 200);
  });
});

describe('POST /api/v1/invites/:code/accept (invite.accept)', () => {
  it('joins as player, counts one use and returns the team summary', async () => {
    const team = await teamFixture(t);
    const invite = await insertInvite(t, team.id, { maxUses: 5 });
    const joiner = await account(t);
    const body = acceptInviteResponseSchema.parse(
      await expectJson(await api.acceptInvite(joiner.headers, invite.code), 200),
    );
    expect(body.team).toMatchObject({ id: team.id, myRole: 'player', memberCount: 4 });
    expect(await memberRole(t, team.id, joiner.id)).toBe('player');
    expect((await inviteRow(invite.id))?.uses).toBe(1);
    const audit = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'invite.accepted'), eq(auditLogs.actorId, joiner.id)));
    expect(audit).toHaveLength(1);
  });

  it('enqueues team.member_joined for the captain only, in the accept transaction', async () => {
    const team = await teamFixture(t);
    const invite = await insertInvite(t, team.id);
    const joiner = await account(t);
    await expectJson(await api.acceptInvite(joiner.headers, invite.code), 200);
    const membership = await membershipId(team.id, joiner.id);
    const jobs = await joinedJobs(team.id);
    expect(jobs.map((job) => job.data)).toEqual([
      {
        type: 'team.member_joined',
        userId: team.captain.id,
        refId: team.id,
        idempotencyKey: `push:joined:${membership}`,
      },
    ]);
    expect(jobs[0]?.singletonKey).toBe(jobs[0]?.data.idempotencyKey);
  });

  it('accept, leave and accept again within one second are two member_joined events', async () => {
    const team = await teamFixture(t);
    const invite = await insertInvite(t, team.id);
    const joiner = await account(t);
    // The test clock does not move between the three requests: all of them share one second.
    const at = t.harness.runtime.now().getTime();
    await expectJson(await api.acceptInvite(joiner.headers, invite.code), 200);
    const first = await membershipId(team.id, joiner.id);
    expect((await api.removeMember(joiner.headers, team.id, joiner.id)).status).toBe(204);
    await expectJson(await api.acceptInvite(joiner.headers, invite.code), 200);
    const second = await membershipId(team.id, joiner.id);
    expect(t.harness.runtime.now().getTime()).toBe(at);
    expect(second).not.toBe(first);
    const jobs = await joinedJobs(team.id);
    expect(jobs.map((job) => job.data.idempotencyKey)).toEqual([
      `push:joined:${first}`,
      `push:joined:${second}`,
    ]);
    expect(jobs.every((job) => job.data.userId === team.captain.id)).toBe(true);
  });

  it('enqueues no job for a rejected accept', async () => {
    const team = await teamFixture(t);
    const invite = await insertInvite(t, team.id, { maxUses: 1 });
    await expectProblem(
      await api.acceptInvite(team.player.headers, invite.code),
      409,
      'already_participant',
    );
    const unverified = await account(t, { verified: false });
    await expectProblem(
      await api.acceptInvite(unverified.headers, invite.code),
      403,
      'email_unverified',
    );
    const joiner = await account(t);
    await expectProblem(
      await api.acceptInvite(joiner.headers, generateInviteCode()),
      404,
      'not_found',
    );
    const exhausted = await insertInvite(t, team.id, { maxUses: 1, uses: 1 });
    await expectProblem(await api.acceptInvite(joiner.headers, exhausted.code), 404, 'not_found');
    expect(await joinedJobs(team.id)).toEqual([]);
  });

  it('a failure at commit rolls back the membership, the use and the notification job', async () => {
    const team = await teamFixture(t);
    const invite = await insertInvite(t, team.id);
    const joiner = await account(t);
    const fn = `fail_join_${randomBytes(4).toString('hex')}`;
    const pool = t.database.client.pool;
    await pool.query(
      `create function ${fn}() returns trigger language plpgsql as $$ begin if new.user_id = '${joiner.id}' then raise exception 'forced failure'; end if; return new; end $$`,
    );
    await pool.query(
      `create constraint trigger ${fn} after insert on team_members deferrable initially deferred for each row execute function ${fn}()`,
    );
    try {
      await expectProblem(
        await api.acceptInvite(joiner.headers, invite.code),
        500,
        'internal_error',
      );
    } finally {
      await pool.query(`drop trigger ${fn} on team_members`);
      await pool.query(`drop function ${fn}()`);
    }
    expect(await memberRole(t, team.id, joiner.id)).toBeNull();
    expect((await inviteRow(invite.id))?.uses).toBe(0);
    expect(await joinedJobs(team.id)).toEqual([]);
  });

  it('answers existing members 409 already_participant without consuming a use', async () => {
    const team = await teamFixture(t);
    const invite = await insertInvite(t, team.id, { maxUses: 1 });
    for (const member of [team.player, team.coCaptain, team.captain]) {
      await expectProblem(
        await api.acceptInvite(member.headers, invite.code),
        409,
        'already_participant',
      );
    }
    expect((await inviteRow(invite.id))?.uses).toBe(0);
    const joiner = await account(t);
    await expectJson(await api.acceptInvite(joiner.headers, invite.code), 200);
  });

  it('answers 401 anonymous, 403 unverified (no use consumed) and 404 for every unusable code', async () => {
    const team = await teamFixture(t);
    const invite = await insertInvite(t, team.id);
    await expectProblem(await api.acceptInvite(anonymous(), invite.code), 401, 'unauthenticated');
    const unverified = await account(t, { verified: false });
    await expectProblem(
      await api.acceptInvite(unverified.headers, invite.code),
      403,
      'email_unverified',
    );
    expect((await inviteRow(invite.id))?.uses).toBe(0);
    expect(await memberRole(t, team.id, unverified.id)).toBeNull();

    const now = t.harness.runtime.now().getTime();
    const expired = await insertInvite(t, team.id, { expiresAt: new Date(now - 1) });
    const exhausted = await insertInvite(t, team.id, { maxUses: 2, uses: 2 });
    const joiner = await account(t);
    for (const code of [generateInviteCode(), expired.code, exhausted.code]) {
      await expectProblem(await api.acceptInvite(joiner.headers, code), 404, 'not_found');
    }
    expect(await memberRole(t, team.id, joiner.id)).toBeNull();
    // An invite that expires between two requests stops working.
    const shortLived = await insertInvite(t, team.id, { expiresAt: new Date(now + 60_000) });
    t.harness.advance(60_000);
    await expectProblem(await api.acceptInvite(joiner.headers, shortLived.code), 404, 'not_found');
  });

  it('rejects any body field (the code in the path is the only input)', async () => {
    const team = await teamFixture(t);
    const invite = await insertInvite(t, team.id);
    const joiner = await account(t);
    for (const body of [{ role: 'captain' }, { teamId: team.id }, { userId: team.captain.id }]) {
      await expectProblem(
        await api.acceptInvite(joiner.headers, invite.code, body),
        400,
        'validation_failed',
      );
    }
    expect(await memberRole(t, team.id, joiner.id)).toBeNull();
  });

  it('a former member rejoins as player', async () => {
    const team = await teamFixture(t);
    expect(
      (await api.removeMember(team.coCaptain.headers, team.id, team.coCaptain.id)).status,
    ).toBe(204);
    const invite = await insertInvite(t, team.id);
    await expectJson(await api.acceptInvite(team.coCaptain.headers, invite.code), 200);
    expect(await memberRole(t, team.id, team.coCaptain.id)).toBe('player');
  });

  it('two concurrent accepts of a single-use invite: exactly one joins, the other gets 404', async () => {
    for (let round = 0; round < 5; round += 1) {
      const team = await teamFixture(t);
      const invite = await insertInvite(t, team.id, { maxUses: 1 });
      const joiners = [await account(t), await account(t)];
      const responses = await Promise.all(
        joiners.map((joiner) => api.acceptInvite(joiner.headers, invite.code)),
      );
      expect(responses.map((response) => response.status).sort()).toEqual([200, 404]);
      expect((await inviteRow(invite.id))?.uses).toBe(1);
      const members = await t.db.select().from(teamMembers).where(eq(teamMembers.teamId, team.id));
      expect(members).toHaveLength(4);
    }
  });

  it('never exceeds max_uses under a burst of concurrent accepts', async () => {
    const team = await teamFixture(t);
    const maxUses = 3;
    const invite = await insertInvite(t, team.id, { maxUses });
    const joiners: Account[] = [];
    for (let index = 0; index < 8; index += 1) {
      joiners.push(await account(t));
    }
    const responses = await Promise.all(
      joiners.map((joiner) => api.acceptInvite(joiner.headers, invite.code)),
    );
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(maxUses);
    expect(statuses.filter((status) => status === 404)).toHaveLength(joiners.length - maxUses);
    expect((await inviteRow(invite.id))?.uses).toBe(maxUses);
    const members = await t.db.select().from(teamMembers).where(eq(teamMembers.teamId, team.id));
    expect(members).toHaveLength(3 + maxUses);
  });

  it('the same user accepting twice at once joins once and spends one use', async () => {
    const team = await teamFixture(t);
    const invite = await insertInvite(t, team.id, { maxUses: 5 });
    const joiner = await account(t);
    const responses = await Promise.all([
      api.acceptInvite(joiner.headers, invite.code),
      api.acceptInvite(joiner.headers, invite.code),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await inviteRow(invite.id))?.uses).toBe(1);
  });

  it('limits accepts per user across addresses (group I)', async () => {
    const team = await teamFixture(t);
    const joiner = await account(t);
    const rule = RATE_LIMIT_GROUPS.I;
    const [userKey] = groupLimitKeys(t.harness.runtime, 'I', {
      userId: joiner.id,
      ipSubject: 'unused',
    });
    for (let index = 0; index < rule.max; index += 1) {
      await t.harness.runtime.limiter.hit(userKey ?? '', {
        max: rule.max,
        windowSeconds: rule.windowSeconds,
      });
    }
    const invite = await insertInvite(t, team.id);
    const fromNewAddress = { ...joiner.headers, 'x-forwarded-for': `${uniqueIp()}, 10.0.0.5` };
    await expectProblem(await api.acceptInvite(fromNewAddress, invite.code), 429, 'rate_limited');
    expect(await memberRole(t, team.id, joiner.id)).toBeNull();
    expect((await inviteRow(invite.id))?.uses).toBe(0);
  });

  it('stores codes only as lowercase SHA-256 hex', () => {
    const code = generateInviteCode();
    expect(inviteCodeHash(code)).toBe(sha256(code));
    expect(inviteCodeHash(code)).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(Array.from({ length: 50 }, generateInviteCode)).size).toBe(50);
  });
});
