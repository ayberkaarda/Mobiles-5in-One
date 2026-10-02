import { teamMemberSchema } from '@kadro/contracts';
import { auditLogs, matchRsvps, teamMembers } from '@kadro/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type MatchesHarness, setupMatchesHarness } from '../matches/support';
import { expectProblem } from '../support/http';
import { storedJobs } from '../support/jobs';
import {
  account,
  addMember,
  anonymous,
  api,
  expectJson,
  insertMatch,
  insertRsvp,
  insertTeam,
  memberRole,
  rsvpStatus,
  teamFixture,
  teamRow,
} from './support';

/**
 * Member endpoints (ADR-0005, ADR-0008; matrix §3.3 footnotes 8 and 9): only the captain changes
 * roles, captaincy transfer is atomic and keeps `owner_id` in step, the last captain can neither
 * leave nor demote themselves, and removal deletes upcoming RSVPs while keeping played history.
 */

let t: MatchesHarness;

beforeAll(async () => {
  // With the job queues: removal enqueues pushes in its transaction (ADR-0031).
  t = await setupMatchesHarness('web_teams_members');
});

afterAll(async () => {
  await t.dispose();
});

/** `push.send` jobs about `refId`, as `type:userId` pairs. */
async function pushesAbout(refId: string): Promise<string[]> {
  return (await storedJobs(t.adminUrl, 'push.send'))
    .filter((job) => job.data.refId === refId)
    .map((job) => `${String(job.data.type)}:${String(job.data.userId)}`)
    .sort();
}

async function auditRows(action: string, actorId: string) {
  return t.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), eq(auditLogs.actorId, actorId)));
}

async function captainsOf(teamId: string): Promise<string[]> {
  const rows = await t.db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, 'captain')));
  return rows.map((row) => row.userId);
}

describe('PATCH /api/v1/teams/:id/members/:userId (member.updateRole)', () => {
  it('lets the captain promote and demote, with one audit row per change', async () => {
    const team = await teamFixture(t);
    const promoted = teamMemberSchema.parse(
      await expectJson(
        await api.updateMember(team.captain.headers, team.id, team.player.id, {
          role: 'co_captain',
        }),
        200,
      ),
    );
    expect(promoted).toMatchObject({ role: 'co_captain', user: { id: team.player.id } });
    await expectJson(
      await api.updateMember(team.captain.headers, team.id, team.coCaptain.id, { role: 'player' }),
      200,
    );
    expect(await memberRole(t, team.id, team.player.id)).toBe('co_captain');
    expect(await memberRole(t, team.id, team.coCaptain.id)).toBe('player');
    const audit = await auditRows('member.roleChanged', team.captain.id);
    expect(audit.map((row) => row.metadata)).toEqual([
      { teamId: team.id, from: 'player', to: 'co_captain' },
      { teamId: team.id, from: 'co_captain', to: 'player' },
    ]);
    expect(JSON.stringify(audit)).not.toContain('@example.test');
    // Setting the current role again changes nothing and is not audited.
    await expectJson(
      await api.updateMember(team.captain.headers, team.id, team.coCaptain.id, { role: 'player' }),
      200,
    );
    expect(await auditRows('member.roleChanged', team.captain.id)).toHaveLength(2);
  });

  it('refuses co-captains and players (403), outsiders (404), anonymous (401)', async () => {
    const team = await teamFixture(t);
    const other = await account(t);
    await addMember(t, team.id, other.id, 'co_captain');
    const stranger = await account(t);
    for (const role of ['captain', 'co_captain', 'player'] as const) {
      await expectProblem(
        await api.updateMember(team.coCaptain.headers, team.id, other.id, { role }),
        403,
        'forbidden',
      );
      await expectProblem(
        await api.updateMember(team.coCaptain.headers, team.id, team.coCaptain.id, { role }),
        403,
        'forbidden',
      );
      await expectProblem(
        await api.updateMember(team.player.headers, team.id, team.player.id, { role }),
        403,
        'forbidden',
      );
      await expectProblem(
        await api.updateMember(stranger.headers, team.id, team.player.id, { role }),
        404,
        'not_found',
      );
    }
    await expectProblem(
      await api.updateMember(anonymous(), team.id, team.player.id, { role: 'player' }),
      401,
      'unauthenticated',
    );
    expect(await memberRole(t, team.id, other.id)).toBe('co_captain');
    expect(await captainsOf(team.id)).toEqual([team.captain.id]);
  });

  it('a target outside the team: 404 for the captain, still 403 for a player', async () => {
    const team = await teamFixture(t);
    const outsider = await account(t);
    await expectProblem(
      await api.updateMember(team.captain.headers, team.id, outsider.id, { role: 'co_captain' }),
      404,
      'not_found',
    );
    await expectProblem(
      await api.updateMember(team.player.headers, team.id, outsider.id, { role: 'co_captain' }),
      403,
      'forbidden',
    );
    expect(await memberRole(t, team.id, outsider.id)).toBeNull();
  });

  it('the captain cannot change their own role; the team keeps its captain', async () => {
    const team = await teamFixture(t);
    for (const role of ['co_captain', 'player', 'captain'] as const) {
      await expectProblem(
        await api.updateMember(team.captain.headers, team.id, team.captain.id, { role }),
        403,
        'forbidden',
      );
    }
    expect(await captainsOf(team.id)).toEqual([team.captain.id]);
  });

  it('transfers captaincy atomically: roles swap, owner_id follows, one audit row', async () => {
    const team = await teamFixture(t);
    const response = await api.updateMember(team.captain.headers, team.id, team.player.id, {
      role: 'captain',
    });
    expect(teamMemberSchema.parse(await expectJson(response, 200)).role).toBe('captain');
    expect(await memberRole(t, team.id, team.player.id)).toBe('captain');
    expect(await memberRole(t, team.id, team.captain.id)).toBe('co_captain');
    expect(await captainsOf(team.id)).toEqual([team.player.id]);
    expect((await teamRow(t, team.id))?.ownerId).toBe(team.player.id);
    const audit = await auditRows('team.captaincyTransfer', team.captain.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.targetId).toBe(team.id);
    expect(audit[0]?.metadata).toEqual({
      previousCaptainId: team.captain.id,
      newCaptainId: team.player.id,
      previousRole: 'player',
    });
    // The new captain is in charge, the former captain is not any more.
    await expectJson(
      await api.updateMember(team.player.headers, team.id, team.coCaptain.id, { role: 'player' }),
      200,
    );
    await expectProblem(
      await api.updateMember(team.captain.headers, team.id, team.player.id, { role: 'player' }),
      403,
      'forbidden',
    );
    // The former captain owns no team now and may create one.
    await expectJson(
      await api.createTeam(team.captain.headers, { name: 'Yeni Takım', districtId: t.districtId }),
      201,
    );
  });

  it('refuses a transfer to a free-tier user who already owns a team (403 entitlement_required)', async () => {
    const team = await teamFixture(t);
    await insertTeam(t, team.coCaptain.id);
    await expectProblem(
      await api.updateMember(team.captain.headers, team.id, team.coCaptain.id, { role: 'captain' }),
      403,
      'entitlement_required',
    );
    expect(await captainsOf(team.id)).toEqual([team.captain.id]);
    expect((await teamRow(t, team.id))?.ownerId).toBe(team.captain.id);
    expect(await auditRows('team.captaincyTransfer', team.captain.id)).toHaveLength(0);
  });

  it('concurrent transfers to two members leave exactly one captain who owns the team', async () => {
    for (let round = 0; round < 3; round += 1) {
      const team = await teamFixture(t);
      const responses = await Promise.all([
        api.updateMember(team.captain.headers, team.id, team.player.id, { role: 'captain' }),
        api.updateMember(team.captain.headers, team.id, team.coCaptain.id, { role: 'captain' }),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([200, 403]);
      const captains = await captainsOf(team.id);
      expect(captains).toHaveLength(1);
      expect((await teamRow(t, team.id))?.ownerId).toBe(captains[0]);
      expect(await auditRows('team.captaincyTransfer', team.captain.id)).toHaveLength(1);
    }
  });

  it('a transfer racing a removal of the target never leaves the team without a captain', async () => {
    const team = await teamFixture(t);
    const responses = await Promise.all([
      api.updateMember(team.captain.headers, team.id, team.player.id, { role: 'captain' }),
      api.removeMember(team.player.headers, team.id, team.player.id),
    ]);
    const statuses = responses.map((response) => response.status);
    const captains = await captainsOf(team.id);
    expect(captains).toHaveLength(1);
    expect((await teamRow(t, team.id))?.ownerId).toBe(captains[0]);
    if (statuses[0] === 200) {
      // Transfer first: the new captain may not leave.
      expect(statuses[1]).toBe(409);
      expect(captains[0]).toBe(team.player.id);
    } else {
      expect(statuses).toEqual([404, 204]);
      expect(captains[0]).toBe(team.captain.id);
    }
  });

  it('rejects unknown roles and extra fields with 400', async () => {
    const team = await teamFixture(t);
    for (const body of [
      { role: 'owner' },
      { role: 'admin' },
      {},
      { role: 'player', userId: team.captain.id },
      { role: 'player', joinedAt: new Date().toISOString() },
    ]) {
      await expectProblem(
        await api.updateMember(team.captain.headers, team.id, team.player.id, body),
        400,
        'validation_failed',
      );
    }
    expect(await memberRole(t, team.id, team.player.id)).toBe('player');
  });
});

describe('DELETE /api/v1/teams/:id/members/:userId (member.remove)', () => {
  it('lets every non-captain member leave; the captain must transfer first (409)', async () => {
    const team = await teamFixture(t);
    expect((await api.removeMember(team.player.headers, team.id, team.player.id)).status).toBe(204);
    expect(
      (await api.removeMember(team.coCaptain.headers, team.id, team.coCaptain.id)).status,
    ).toBe(204);
    await expectProblem(
      await api.removeMember(team.captain.headers, team.id, team.captain.id),
      409,
      'captain_must_transfer',
    );
    expect(await captainsOf(team.id)).toEqual([team.captain.id]);
    expect(await auditRows('member.left', team.player.id)).toHaveLength(1);
  });

  it('player removes nobody else (403); co-captain removes players only; captain anyone', async () => {
    const team = await teamFixture(t);
    const secondPlayer = await account(t);
    const secondCo = await account(t);
    await addMember(t, team.id, secondPlayer.id, 'player');
    await addMember(t, team.id, secondCo.id, 'co_captain');
    await expectProblem(
      await api.removeMember(team.player.headers, team.id, secondPlayer.id),
      403,
      'forbidden',
    );
    await expectProblem(
      await api.removeMember(team.player.headers, team.id, team.captain.id),
      403,
      'forbidden',
    );
    await expectProblem(
      await api.removeMember(team.coCaptain.headers, team.id, secondCo.id),
      403,
      'forbidden',
    );
    await expectProblem(
      await api.removeMember(team.coCaptain.headers, team.id, team.captain.id),
      403,
      'forbidden',
    );
    expect((await api.removeMember(team.coCaptain.headers, team.id, secondPlayer.id)).status).toBe(
      204,
    );
    expect((await api.removeMember(team.captain.headers, team.id, secondCo.id)).status).toBe(204);
    expect(await memberRole(t, team.id, secondPlayer.id)).toBeNull();
    expect(await memberRole(t, team.id, secondCo.id)).toBeNull();
    const audit = await auditRows('member.removed', team.coCaptain.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.targetId).toBe(secondPlayer.id);
    expect(audit[0]?.metadata).toMatchObject({ teamId: team.id, role: 'player' });
  });

  it('answers outsiders 404 and a non-member target 404 (403 for a player)', async () => {
    const team = await teamFixture(t);
    const stranger = await account(t);
    await expectProblem(
      await api.removeMember(stranger.headers, team.id, team.player.id),
      404,
      'not_found',
    );
    await expectProblem(
      await api.removeMember(stranger.headers, team.id, stranger.id),
      404,
      'not_found',
    );
    await expectProblem(
      await api.removeMember(team.captain.headers, team.id, stranger.id),
      404,
      'not_found',
    );
    await expectProblem(
      await api.removeMember(team.player.headers, team.id, stranger.id),
      403,
      'forbidden',
    );
    expect(await memberRole(t, team.id, team.player.id)).toBe('player');
  });

  it('deletes upcoming RSVPs, keeps played history and promotes the waitlist (ADR-0005)', async () => {
    const team = await teamFixture(t);
    const leaver = await account(t);
    const waiting = await account(t);
    const waitingLater = await account(t);
    await addMember(t, team.id, leaver.id, 'player');
    await addMember(t, team.id, waiting.id, 'player');
    await addMember(t, team.id, waitingLater.id, 'player');
    const open = await insertMatch(t, team.id, 'open', 2);
    const locked = await insertMatch(t, team.id, 'locked', 2);
    const draft = await insertMatch(t, team.id, 'draft');
    const played = await insertMatch(t, team.id, 'played');
    const other = await teamFixture(t);
    const otherOpen = await insertMatch(t, other.id, 'open');
    await insertRsvp(t, open, team.player.id, 'in');
    await insertRsvp(t, open, leaver.id, 'in');
    await insertRsvp(t, open, waitingLater.id, 'waitlist', new Date(Date.now() - 1_000));
    await insertRsvp(t, open, waiting.id, 'waitlist', new Date(Date.now() - 60_000));
    await insertRsvp(t, locked, leaver.id, 'maybe');
    await insertRsvp(t, draft, leaver.id, 'in');
    await insertRsvp(t, played, leaver.id, 'in');
    await insertRsvp(t, otherOpen, leaver.id, 'in');

    expect((await api.removeMember(team.captain.headers, team.id, leaver.id)).status).toBe(204);

    expect(await rsvpStatus(t, open, leaver.id)).toBeNull();
    expect(await rsvpStatus(t, locked, leaver.id)).toBeNull();
    expect(await rsvpStatus(t, draft, leaver.id)).toBeNull();
    expect(await rsvpStatus(t, played, leaver.id)).toBe('in');
    expect(await rsvpStatus(t, otherOpen, leaver.id)).toBe('in');
    // Oldest waitlisted RSVP takes the freed slot; the later one keeps waiting.
    expect(await rsvpStatus(t, open, waiting.id)).toBe('in');
    expect(await rsvpStatus(t, open, waitingLater.id)).toBe('waitlist');
    const [promoted] = await t.db
      .select({ waitlistedAt: matchRsvps.waitlistedAt })
      .from(matchRsvps)
      .where(and(eq(matchRsvps.matchId, open), eq(matchRsvps.userId, waiting.id)));
    expect(promoted?.waitlistedAt).toBeNull();
    const audit = await auditRows('member.removed', team.captain.id);
    expect(audit[0]?.metadata).toEqual({
      teamId: team.id,
      role: 'player',
      rsvpsRemoved: 3,
      waitlistPromoted: 1,
    });
    // The former member reads nothing of the team any more.
    await expectProblem(await api.getTeam(leaver.headers, team.id), 404, 'not_found');
    // Pushes (ADR-0031): the promoted player, and staff other than the acting captain for every
    // match that lost an RSVP; nothing about other teams' matches or played history.
    const staffChange = [`rsvp.changed:${team.coCaptain.id}`];
    expect(await pushesAbout(open)).toEqual([...staffChange, `rsvp.promoted:${waiting.id}`].sort());
    expect(await pushesAbout(locked)).toEqual(staffChange);
    expect(await pushesAbout(draft)).toEqual(staffChange);
    expect(await pushesAbout(played)).toEqual([]);
    expect(await pushesAbout(otherOpen)).toEqual([]);
  });

  it('a confirmed player leaving a locked match frees a slot: captain and staff are told', async () => {
    const team = await teamFixture(t);
    const waiting = await account(t);
    await addMember(t, team.id, waiting.id, 'player');
    const locked = await insertMatch(t, team.id, 'locked', 2);
    await insertRsvp(t, locked, team.coCaptain.id, 'in');
    await insertRsvp(t, locked, team.player.id, 'in');
    await insertRsvp(t, locked, waiting.id, 'waitlist', new Date(Date.now() - 60_000));

    expect((await api.removeMember(team.player.headers, team.id, team.player.id)).status).toBe(204);

    expect(await rsvpStatus(t, locked, waiting.id)).toBe('in');
    expect(await pushesAbout(locked)).toEqual(
      [
        `lineup.slot_free:${team.captain.id}`,
        `rsvp.changed:${team.captain.id}`,
        `rsvp.changed:${team.coCaptain.id}`,
        `rsvp.promoted:${waiting.id}`,
      ].sort(),
    );
  });

  it('the captain removing a confirmed player gets no slot-free push of their own action', async () => {
    const team = await teamFixture(t);
    const locked = await insertMatch(t, team.id, 'locked', 2);
    await insertRsvp(t, locked, team.player.id, 'in');

    expect((await api.removeMember(team.captain.headers, team.id, team.player.id)).status).toBe(
      204,
    );

    expect(await pushesAbout(locked)).toEqual([`rsvp.changed:${team.coCaptain.id}`]);
  });

  it('the removed member cannot act on the team afterwards', async () => {
    const team = await teamFixture(t);
    expect((await api.removeMember(team.captain.headers, team.id, team.coCaptain.id)).status).toBe(
      204,
    );
    await expectProblem(await api.createInvite(team.coCaptain.headers, team.id), 404, 'not_found');
    await expectProblem(
      await api.updateTeam(team.coCaptain.headers, team.id, { name: 'Geri' }),
      404,
      'not_found',
    );
  });
});
