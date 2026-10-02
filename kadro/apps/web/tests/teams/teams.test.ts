import {
  paginatedResponseSchema,
  RATE_LIMIT_GROUPS,
  teamDetailSchema,
  teamSummarySchema,
  type TeamDetail,
} from '@kadro/contracts';
import {
  auditLogs,
  matches,
  subscriptions,
  teamInvites,
  teamMembers,
  teams,
  users,
} from '@kadro/db';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DELETE } from '../../app/api/v1/teams/[id]/route';
import { groupLimitKeys } from '../../lib/server/group-limits';
import { teamSlug } from '../../lib/server/teams/teams';
import { call, expectProblem } from '../support/http';
import {
  account,
  addMember,
  anonymous,
  api,
  expectJson,
  insertInvite,
  insertMatch,
  insertRsvp,
  insertTeam,
  memberRole,
  rsvpStatus,
  type TeamsHarness,
  setupTeamsHarness,
  teamFixture,
  teamRow,
  webAccount,
} from './support';

/**
 * Teams endpoints (matrix §3.3 rows `team.*`, §4.2 field rules, §7 free-tier gate): success,
 * the role × relationship cells in the order 401 → 404 → 403 → 409, strict bodies and immutable
 * server fields, and cursor pagination over the actor's memberships.
 */

let t: TeamsHarness;

beforeAll(async () => {
  t = await setupTeamsHarness('web_teams_teams');
});

afterAll(async () => {
  await t.database.dispose();
});

const listSchema = paginatedResponseSchema(teamSummarySchema);

async function matchIds(teamId: string): Promise<string[]> {
  const rows = await t.db
    .select({ id: matches.id })
    .from(matches)
    .where(eq(matches.teamId, teamId));
  return rows.map((row) => row.id).sort();
}

/**
 * Resolves once another backend of this database waits on a heavyweight lock held by `holderPid`
 * (`pg_blocking_pids`) while running a statement that matches `statement`. Rejects when the
 * request settles first, or after a generous bound that only limits a failing run.
 */
async function waitForLockWaiter(
  holderPid: number,
  settled: () => boolean,
  statement: RegExp,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const waiting = await t.database.client.pool.query<{ query: string }>(
      `select query from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'
          and $1::int = any(pg_blocking_pids(pid))`,
      [holderPid],
    );
    if (waiting.rows.some((row) => statement.test(row.query))) {
      return;
    }
    if (settled()) {
      throw new Error('the request finished without waiting on the team lock');
    }
    if (Date.now() > deadline) {
      throw new Error(
        `no backend waits on the team lock; waiting statements: ${JSON.stringify(waiting.rows)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function deletedAudit(teamId: string) {
  return t.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, 'team.deleted'), eq(auditLogs.targetId, teamId)));
}

describe('POST /api/v1/teams', () => {
  it('creates the team with the caller as captain and owner', async () => {
    const actor = await account(t);
    const response = await api.createTeam(actor.headers, {
      name: 'Kadıköy Şimşekleri',
      districtId: t.districtId,
    });
    const detail = teamDetailSchema.parse(await expectJson(response, 201));
    expect(detail).toMatchObject({
      name: 'Kadıköy Şimşekleri',
      districtId: t.districtId,
      myRole: 'captain',
      memberCount: 1,
      isProLocked: false,
      badgeUrl: null,
    });
    expect(detail.slug).toMatch(/^kadikoy-simsekleri-[0-9a-f]{8}$/);
    expect(detail.members).toEqual([
      expect.objectContaining({ role: 'captain', user: expect.objectContaining({ id: actor.id }) }),
    ]);
    expect(JSON.stringify(detail)).not.toContain('@example.test');
    const row = await teamRow(t, detail.id);
    expect(row?.ownerId).toBe(actor.id);
    expect(await memberRole(t, detail.id, actor.id)).toBe('captain');
  });

  it('works over the web transport with CSRF', async () => {
    const actor = await webAccount(t);
    const response = await api.createTeam(actor.headers, {
      name: 'Web Kadro',
      districtId: t.districtId,
    });
    await expectJson(response, 201);
    const { 'x-csrf-token': _omitted, ...withoutCsrf } = actor.headers;
    await expectProblem(
      await api.createTeam(withoutCsrf, { name: 'Web Kadro', districtId: t.districtId }),
      403,
      'csrf_failed',
    );
  });

  it('answers 401 to anonymous callers before validating the body', async () => {
    await expectProblem(await api.createTeam(anonymous(), { nope: true }), 401, 'unauthenticated');
  });

  it('requires a verified email (403 email_unverified)', async () => {
    const actor = await account(t, { verified: false });
    await expectProblem(
      await api.createTeam(actor.headers, { name: 'Doğrulanmamış', districtId: t.districtId }),
      403,
      'email_unverified',
    );
    const owned = await t.db.select().from(teams).where(eq(teams.ownerId, actor.id));
    expect(owned).toHaveLength(0);
  });

  it('limits the free tier to one owned team (403 entitlement_required)', async () => {
    const actor = await account(t);
    await expectJson(
      await api.createTeam(actor.headers, { name: 'Birinci', districtId: t.districtId }),
      201,
    );
    await expectProblem(
      await api.createTeam(actor.headers, { name: 'İkinci', districtId: t.districtId }),
      403,
      'entitlement_required',
    );
  });

  it('lets a Pro user own more teams, from the real POST teams route (matrix §7)', async () => {
    const actor = await account(t);
    await t.db.insert(subscriptions).values({
      userId: actor.id,
      rcAppUserId: actor.id,
      productId: 'kadro_pro_yearly',
      status: 'grace_period',
      expiresAt: new Date(t.harness.runtime.now().getTime() + 86_400_000),
      environment: 'production',
      store: 'play_store',
    });
    for (const name of ['Birinci', 'İkinci', 'Üçüncü']) {
      await expectJson(
        await api.createTeam(actor.headers, { name, districtId: t.districtId }),
        201,
      );
    }
    const owned = await t.db.select().from(teams).where(eq(teams.ownerId, actor.id));
    expect(owned).toHaveLength(3);
  });

  it('memberships of other teams do not count against the owned-team limit', async () => {
    const actor = await account(t);
    const other = await teamFixture(t);
    await addMember(t, other.id, actor.id, 'co_captain');
    await expectJson(
      await api.createTeam(actor.headers, { name: 'Kendi Kadrom', districtId: t.districtId }),
      201,
    );
  });

  it('lets exactly one of five concurrent creates pass the free-tier limit', async () => {
    const actor = await account(t);
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        api.createTeam(actor.headers, { name: `Yarış ${index}`, districtId: t.districtId }),
      ),
    );
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 403, 403, 403, 403]);
    const owned = await t.db.select().from(teams).where(eq(teams.ownerId, actor.id));
    expect(owned).toHaveLength(1);
  });

  it('rejects an unknown district with 400 and no team', async () => {
    const actor = await account(t);
    const body = await expectProblem(
      await api.createTeam(actor.headers, {
        name: 'Hayalet İlçe',
        districtId: '01900000-0000-7000-8000-000000000000',
      }),
      400,
      'validation_failed',
    );
    expect(body.errors).toEqual([{ path: 'body.districtId', issue: 'not_found' }]);
    expect(await t.db.select().from(teams).where(eq(teams.ownerId, actor.id))).toHaveLength(0);
  });

  it.each([
    ['slug', 'el-yapimi'],
    ['ownerId', '01900000-0000-7000-8000-000000000001'],
    ['isProLocked', true],
    ['badgeKey', 'badges/x/y.webp'],
    ['id', '01900000-0000-7000-8000-000000000002'],
  ])('rejects the server-only field %s with 400 (strict body)', async (field, value) => {
    const actor = await account(t);
    await expectProblem(
      await api.createTeam(actor.headers, {
        name: 'Sızma',
        districtId: t.districtId,
        [field]: value,
      }),
      400,
      'validation_failed',
    );
    expect(await t.db.select().from(teams).where(eq(teams.ownerId, actor.id))).toHaveLength(0);
  });

  it('builds a slug from any name', () => {
    expect(teamSlug('ÇİĞDEM Spor')).toMatch(/^cigdem-spor-[0-9a-f]{8}$/);
    expect(teamSlug('---')).toMatch(/^kadro-[0-9a-f]{8}$/);
    expect(teamSlug('Ⅻ ★★')).toMatch(/^kadro-[0-9a-f]{8}$/);
  });
});

describe('GET /api/v1/teams', () => {
  it('lists only the caller’s memberships, with its own role, and pages by cursor', async () => {
    const actor = await account(t);
    const outsider = await teamFixture(t);
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const fixture = await teamFixture(t);
      await addMember(t, fixture.id, actor.id, index % 2 === 0 ? 'player' : 'co_captain');
      t.harness.advance(1);
      ids.push(fixture.id);
    }
    const seen: string[] = [];
    const roles: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: Record<string, string> =
        cursor === null ? { limit: '2' } : { limit: '2', cursor };
      const page = listSchema.parse(
        await expectJson(await api.listTeams(actor.headers, query), 200),
      );
      seen.push(...page.items.map((item) => item.id));
      roles.push(...page.items.map((item) => item.myRole));
      expect(page.items.every((item) => item.memberCount === 4)).toBe(true);
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null);
    expect(pages).toBe(3);
    expect(seen).toEqual(ids);
    expect(roles).toEqual(['player', 'co_captain', 'player', 'co_captain', 'player']);
    expect(seen).not.toContain(outsider.id);
  });

  it('returns an empty page for a user without teams', async () => {
    const actor = await account(t);
    const page = listSchema.parse(await expectJson(await api.listTeams(actor.headers), 200));
    expect(page).toEqual({ items: [], nextCursor: null });
  });

  it('refuses a cursor issued to another user or altered (400 invalid_cursor)', async () => {
    const owner = await account(t);
    for (let index = 0; index < 2; index += 1) {
      const fixture = await teamFixture(t);
      await addMember(t, fixture.id, owner.id, 'player');
    }
    const first = listSchema.parse(
      await expectJson(await api.listTeams(owner.headers, { limit: '1' }), 200),
    );
    expect(first.nextCursor).not.toBeNull();
    const cursor = first.nextCursor ?? '';
    const other = await account(t);
    await expectProblem(
      await api.listTeams(other.headers, { limit: '1', cursor }),
      400,
      'invalid_cursor',
    );
    const tampered = `${cursor.slice(0, -2)}${cursor.endsWith('AA') ? 'BB' : 'AA'}`;
    await expectProblem(
      await api.listTeams(owner.headers, { limit: '1', cursor: tampered }),
      400,
      'invalid_cursor',
    );
  });

  it('rejects unknown query keys and out-of-range limits', async () => {
    const actor = await account(t);
    await expectProblem(
      await api.listTeams(actor.headers, { userId: actor.id }),
      400,
      'validation_failed',
    );
    await expectProblem(
      await api.listTeams(actor.headers, { limit: '101' }),
      400,
      'validation_failed',
    );
  });

  it('answers 401 without credentials', async () => {
    await expectProblem(await api.listTeams(anonymous()), 401, 'unauthenticated');
  });
});

describe('GET /api/v1/teams/:id (team.read)', () => {
  it('returns the roster as public cards to every member', async () => {
    const team = await teamFixture(t);
    for (const member of [team.captain, team.coCaptain, team.player]) {
      const detail = teamDetailSchema.parse(
        await expectJson(await api.getTeam(member.headers, team.id), 200),
      );
      expect(detail.members.map((entry) => entry.role)).toEqual([
        'captain',
        'co_captain',
        'player',
      ]);
      const text = JSON.stringify(detail);
      expect(text).not.toContain('@example.test');
      expect(text).not.toContain('email');
    }
  });

  it('answers non-members, staff without membership and unknown ids with the same 404', async () => {
    const team = await teamFixture(t);
    const stranger = await account(t);
    const moderator = await account(t, { role: 'moderator' });
    const admin = await account(t, { role: 'admin' });
    const missing = await expectProblem(
      await api.getTeam(stranger.headers, '01900000-0000-7000-8000-00000000abcd'),
      404,
      'not_found',
    );
    for (const actor of [stranger, moderator, admin]) {
      const body = await expectProblem(await api.getTeam(actor.headers, team.id), 404, 'not_found');
      expect(Object.keys(body).sort()).toEqual(Object.keys(missing).sort());
      expect(body.title).toBe(missing.title);
    }
  });

  it('a former member keeps no access to the team (ADR-0005)', async () => {
    const team = await teamFixture(t);
    const former = await account(t);
    await addMember(t, team.id, former.id, 'player');
    await expectJson(await api.getTeam(former.headers, team.id), 200);
    expect((await api.removeMember(former.headers, team.id, former.id)).status).toBe(204);
    expect(await memberRole(t, team.id, former.id)).toBeNull();
    await expectProblem(await api.getTeam(former.headers, team.id), 404, 'not_found');
  });

  it('answers 401 for a deactivated account and 400 for a malformed id', async () => {
    const team = await teamFixture(t);
    await t.db.update(users).set({ deactivatedAt: new Date() }).where(eq(users.id, team.player.id));
    await expectProblem(
      await api.getTeam(team.player.headers, team.id),
      401,
      'account_deactivated',
    );
    await expectProblem(
      await api.getTeam(team.captain.headers, 'not-a-uuid'),
      400,
      'validation_failed',
    );
    await expectProblem(await api.getTeam(anonymous(), team.id), 401, 'unauthenticated');
  });
});

describe('PATCH /api/v1/teams/:id (team.update)', () => {
  it('lets captain and co-captain change name, district and remove the badge', async () => {
    const team = await teamFixture(t);
    await t.db
      .update(teams)
      .set({ badgeKey: `badges/${team.id}/old.webp` })
      .where(eq(teams.id, team.id));
    const before = await teamRow(t, team.id);
    const byCaptain = teamDetailSchema.parse(
      await expectJson(
        await api.updateTeam(team.captain.headers, team.id, { name: 'Yeni Ad', badge: null }),
        200,
      ),
    );
    expect(byCaptain.name).toBe('Yeni Ad');
    const byCo = teamDetailSchema.parse(
      await expectJson(
        await api.updateTeam(team.coCaptain.headers, team.id, { districtId: t.otherDistrictId }),
        200,
      ),
    );
    expect(byCo.districtId).toBe(t.otherDistrictId);
    const after = await teamRow(t, team.id);
    expect(after?.badgeKey).toBeNull();
    expect(after?.slug).toBe(before?.slug);
    expect(after?.ownerId).toBe(team.captain.id);
  });

  it('answers 403 to a player and 404 to a non-member, leaving the team unchanged', async () => {
    const team = await teamFixture(t);
    const stranger = await account(t);
    const before = await teamRow(t, team.id);
    await expectProblem(
      await api.updateTeam(team.player.headers, team.id, { name: 'Oyuncu' }),
      403,
      'forbidden',
    );
    await expectProblem(
      await api.updateTeam(stranger.headers, team.id, { name: 'Yabancı' }),
      404,
      'not_found',
    );
    expect((await teamRow(t, team.id))?.name).toBe(before?.name);
  });

  it('answers 403 entitlement_required on a Pro-locked team', async () => {
    const team = await teamFixture(t, { isProLocked: true });
    await expectProblem(
      await api.updateTeam(team.captain.headers, team.id, { name: 'Kilitli' }),
      403,
      'entitlement_required',
    );
    // Reads keep working on a locked team (matrix §7).
    await expectJson(await api.getTeam(team.player.headers, team.id), 200);
  });

  it.each([
    ['slug', 'yeni-slug'],
    ['ownerId', '01900000-0000-7000-8000-000000000003'],
    ['isProLocked', false],
    ['badgeKey', 'badges/a/b.webp'],
    ['badge', 'badges/a/b.webp'],
    ['memberCount', 99],
  ])(
    'rejects %s (server-only or not writable) with 400 and changes nothing',
    async (field, value) => {
      const team = await teamFixture(t, { isProLocked: true });
      const before = await teamRow(t, team.id);
      await expectProblem(
        await api.updateTeam(team.captain.headers, team.id, { name: 'Ad', [field]: value }),
        400,
        'validation_failed',
      );
      expect(await teamRow(t, team.id)).toEqual(before);
    },
  );

  it('rejects an empty body and an unknown district', async () => {
    const team = await teamFixture(t);
    await expectProblem(
      await api.updateTeam(team.captain.headers, team.id, {}),
      400,
      'validation_failed',
    );
    await expectProblem(
      await api.updateTeam(team.captain.headers, team.id, {
        districtId: '01900000-0000-7000-8000-00000000beef',
      }),
      400,
      'validation_failed',
    );
  });
});

describe('rate limit group G (authenticated mutations, 120 per minute per user)', () => {
  it('counts every team mutation and answers 429 with Retry-After once the window is full', async () => {
    const team = await teamFixture(t);
    const rule = RATE_LIMIT_GROUPS.G;
    const keys = groupLimitKeys(t.harness.runtime, 'G', {
      userId: team.captain.id,
      ipSubject: 'unused',
    });
    expect(keys).toHaveLength(1);
    const key = keys[0] ?? '';
    const windowRule = { max: rule.max, windowSeconds: rule.windowSeconds };
    await expectJson(await api.updateTeam(team.captain.headers, team.id, { name: 'Bir' }), 200);
    expect(await t.harness.runtime.limiter.count(key, windowRule)).toBe(1);
    // Reads are not counted (matrix §8).
    await expectJson(await api.getTeam(team.captain.headers, team.id), 200);
    expect(await t.harness.runtime.limiter.count(key, windowRule)).toBe(1);
    for (let index = 1; index < rule.max; index += 1) {
      await t.harness.runtime.limiter.hit(key, windowRule);
    }
    const limited = await api.updateTeam(team.captain.headers, team.id, { name: 'İki' });
    await expectProblem(limited.clone(), 429, 'rate_limited');
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await teamRow(t, team.id))?.name).toBe('Bir');
    // Another user of the same team is not affected.
    await expectJson(await api.updateTeam(team.coCaptain.headers, team.id, { name: 'Üç' }), 200);
    t.harness.advance(rule.windowSeconds * 1_000 + 5_000);
    await expectJson(await api.updateTeam(team.captain.headers, team.id, { name: 'Dört' }), 200);
  });
});

describe('DELETE /api/v1/teams/:id (team.delete)', () => {
  it('lets only the captain delete; co-captain and player 403, outsider 404', async () => {
    const team = await teamFixture(t);
    const stranger = await account(t);
    await expectProblem(await api.deleteTeam(team.coCaptain.headers, team.id), 403, 'forbidden');
    await expectProblem(await api.deleteTeam(team.player.headers, team.id), 403, 'forbidden');
    await expectProblem(await api.deleteTeam(stranger.headers, team.id), 404, 'not_found');
    expect(await teamRow(t, team.id)).toBeDefined();
  });

  it('removes the team with memberships, invites and matches and writes one audit row', async () => {
    const team = await teamFixture(t);
    await insertInvite(t, team.id);
    const match = await insertMatch(t, team.id, 'open');
    const response = await api.deleteTeam(team.captain.headers, team.id);
    expect(response.status).toBe(204);
    expect(await teamRow(t, team.id)).toBeUndefined();
    expect(await t.db.select().from(teamMembers).where(eq(teamMembers.teamId, team.id))).toEqual(
      [],
    );
    expect(await t.db.select().from(teamInvites).where(eq(teamInvites.teamId, team.id))).toEqual(
      [],
    );
    expect(await t.db.select().from(matches).where(eq(matches.id, match))).toEqual([]);
    const audit = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'team.deleted'), eq(auditLogs.targetId, team.id)));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorId).toBe(team.captain.id);
    expect(audit[0]?.ipHash).toMatch(/^[0-9a-f]+$/);
    // The former captain may create a team again (no owned team left).
    await expectJson(
      await api.createTeam(team.captain.headers, { name: 'Yeniden', districtId: t.districtId }),
      201,
    );
  });

  it('refuses a team with a played match and other members (409) and keeps every row', async () => {
    const team = await teamFixture(t);
    const played = await insertMatch(t, team.id, 'played');
    await insertRsvp(t, played, team.player.id, 'in');
    const upcoming = await insertMatch(t, team.id, 'open');
    await expectProblem(
      await api.deleteTeam(team.captain.headers, team.id),
      409,
      'team_has_history',
    );
    expect(await teamRow(t, team.id)).toBeDefined();
    expect(await memberRole(t, team.id, team.captain.id)).toBe('captain');
    expect(await memberRole(t, team.id, team.coCaptain.id)).toBe('co_captain');
    expect(await memberRole(t, team.id, team.player.id)).toBe('player');
    expect(await matchIds(team.id)).toEqual([played, upcoming].sort());
    expect(await rsvpStatus(t, played, team.player.id)).toBe('in');
    expect(await deletedAudit(team.id)).toHaveLength(0);
  });

  it('checks the role before the history: co-captain and player 403, outsider and ex-member 404', async () => {
    const team = await teamFixture(t);
    await insertMatch(t, team.id, 'played');
    const former = await account(t);
    await addMember(t, team.id, former.id, 'player');
    expect((await api.removeMember(former.headers, team.id, former.id)).status).toBe(204);
    const stranger = await account(t);
    await expectProblem(await api.deleteTeam(team.coCaptain.headers, team.id), 403, 'forbidden');
    await expectProblem(await api.deleteTeam(team.player.headers, team.id), 403, 'forbidden');
    await expectProblem(await api.deleteTeam(stranger.headers, team.id), 404, 'not_found');
    await expectProblem(await api.deleteTeam(former.headers, team.id), 404, 'not_found');
    expect(await teamRow(t, team.id)).toBeDefined();
  });

  it('deletes a solo team with played history, matches included', async () => {
    const captain = await account(t);
    const id = await insertTeam(t, captain.id);
    const played = await insertMatch(t, id, 'played');
    await insertRsvp(t, played, captain.id, 'in');
    expect((await api.deleteTeam(captain.headers, id)).status).toBe(204);
    expect(await teamRow(t, id)).toBeUndefined();
    expect(await matchIds(id)).toEqual([]);
    expect(await deletedAudit(id)).toHaveLength(1);
  });

  it('does not count cancelled matches as history (ADR-0032): the shared team is deleted', async () => {
    const team = await teamFixture(t);
    const cancelled = await insertMatch(t, team.id, 'cancelled');
    await insertRsvp(t, cancelled, team.player.id, 'out');
    expect((await api.deleteTeam(team.captain.headers, team.id)).status).toBe(204);
    expect(await teamRow(t, team.id)).toBeUndefined();
    expect(await t.db.select().from(matches).where(eq(matches.id, cancelled))).toEqual([]);
    expect(await t.db.select().from(teamMembers).where(eq(teamMembers.teamId, team.id))).toEqual(
      [],
    );
  });

  it('deletes a shared team without matches', async () => {
    const team = await teamFixture(t);
    expect((await api.deleteTeam(team.captain.headers, team.id)).status).toBe(204);
    expect(await teamRow(t, team.id)).toBeUndefined();
  });

  it('lets the captain transfer and leave; deletion then follows the same rule for the new captain', async () => {
    const team = await teamFixture(t);
    await insertMatch(t, team.id, 'played');
    await expectJson(
      await api.updateMember(team.captain.headers, team.id, team.coCaptain.id, {
        role: 'captain',
      }),
      200,
    );
    expect((await api.removeMember(team.captain.headers, team.id, team.captain.id)).status).toBe(
      204,
    );
    expect(await memberRole(t, team.id, team.captain.id)).toBeNull();
    expect((await teamRow(t, team.id))?.ownerId).toBe(team.coCaptain.id);
    // The former captain is no longer a member; the new captain is still blocked by the player.
    await expectProblem(await api.deleteTeam(team.captain.headers, team.id), 404, 'not_found');
    await expectProblem(
      await api.deleteTeam(team.coCaptain.headers, team.id),
      409,
      'team_has_history',
    );
    // Known limit: a captain who removes every other member may delete the now solo team.
    expect((await api.removeMember(team.coCaptain.headers, team.id, team.player.id)).status).toBe(
      204,
    );
    expect((await api.deleteTeam(team.coCaptain.headers, team.id)).status).toBe(204);
    expect(await teamRow(t, team.id)).toBeUndefined();
  });

  it('re-checks the history under the team lock, so a match played meanwhile blocks the delete', async () => {
    const team = await teamFixture(t);
    const match = await insertMatch(t, team.id, 'locked');
    let pending: Promise<Response> | undefined;
    await t.db.transaction(async (tx) => {
      await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, team.id)).for('update');
      const holder = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      const holderPid = holder.rows[0]?.pid;
      if (holderPid === undefined) {
        throw new Error('no backend pid');
      }
      pending = api.deleteTeam(team.captain.headers, team.id);
      let settled = false;
      void pending.then(
        () => (settled = true),
        () => (settled = true),
      );
      // Proof from the database, not from elapsed time: the request's backend waits on a lock held
      // by this transaction, and the statement it waits in is the team row lock (`for update`).
      await waitForLockWaiter(holderPid, () => settled, /from "teams".* for update/i);
      await tx.update(matches).set({ status: 'played' }).where(eq(matches.id, match));
    });
    if (pending === undefined) {
      throw new Error('delete request was not started');
    }
    await expectProblem(await pending, 409, 'team_has_history');
    expect(await teamRow(t, team.id)).toBeDefined();
    expect(await matchIds(team.id)).toEqual([match]);
  });

  it('rejects a body on DELETE and keeps the team', async () => {
    const owner = await account(t);
    const id = await insertTeam(t, owner.id);
    const response = await call(DELETE, {
      method: 'DELETE',
      path: `/api/v1/teams/${id}`,
      headers: owner.headers,
      json: { force: true },
      params: { id },
    });
    await expectProblem(response, 400, 'validation_failed');
    const detail: TeamDetail = teamDetailSchema.parse(
      await expectJson(await api.getTeam(owner.headers, id), 200),
    );
    expect(detail.id).toBe(id);
  });
});
