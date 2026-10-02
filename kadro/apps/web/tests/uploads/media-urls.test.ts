import { randomUUID } from 'node:crypto';

import {
  invitePreviewSchema,
  matchDetailSchema,
  meResponseSchema,
  paginatedResponseSchema,
  teamDetailSchema,
  teamMemberSchema,
  teamSummarySchema,
} from '@kadro/contracts';
import { teams, users } from '@kadro/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GET as getMe } from '../../app/api/v1/me/route';
import { GET as getMatchRoute } from '../../app/api/v1/matches/[id]/route';
import { call } from '../support/http';
import {
  type Account,
  account,
  addMember,
  api,
  expectJson,
  insertInvite,
  insertMatch,
  insertRsvp,
  insertTeam,
} from '../teams/support';
import { MEDIA_BASE_URL, setupUploadsHarness, type UploadsHarness } from './support';

/**
 * Public image URLs in API responses (ADR-0030): with `MEDIA_PUBLIC_BASE_URL` configured, every
 * `avatarUrl` / `badgeUrl` is the base URL plus the stored key; a stored value that is not a key
 * the upload worker writes still yields `null`. Without the base URL (the other suites) the
 * fields stay `null`.
 */

let t: UploadsHarness;

beforeAll(async () => {
  t = await setupUploadsHarness('web_media_urls');
});

afterAll(async () => {
  await t.dispose();
});

function avatarKeyOf(userId: string): string {
  return `avatars/${userId}/${randomUUID()}.webp`;
}

async function withAvatar(user: Account, key: string = avatarKeyOf(user.id)): Promise<string> {
  await t.db.update(users).set({ avatarKey: key }).where(eq(users.id, user.id));
  return key;
}

async function teamWithBadge(captain: Account): Promise<{ id: string; badgeKey: string }> {
  const id = await insertTeam(t, captain.id);
  const badgeKey = `badges/${id}/${randomUUID()}.webp`;
  await t.db.update(teams).set({ badgeKey }).where(eq(teams.id, id));
  return { id, badgeKey };
}

const urlOf = (key: string): string => `${MEDIA_BASE_URL}/${key}`;

describe('GET me', () => {
  it('returns the public avatar URL of the stored key', async () => {
    const user = await account(t);
    const key = await withAvatar(user);
    const body = meResponseSchema.parse(
      await expectJson(await call(getMe, { headers: user.headers, path: '/api/v1/me' }), 200),
    );
    expect(body.avatarUrl).toBe(urlOf(key));
  });

  it('returns null without an avatar and for a key the worker never writes', async () => {
    const plain = await account(t);
    const odd = await account(t);
    await withAvatar(odd, `avatars/${odd.id}/not-a-uuid.png`);
    for (const user of [plain, odd]) {
      const body = meResponseSchema.parse(
        await expectJson(await call(getMe, { headers: user.headers, path: '/api/v1/me' }), 200),
      );
      expect(body.avatarUrl).toBeNull();
    }
  });
});

describe('teams', () => {
  it('returns badge and member avatar URLs in the list, the detail and member updates', async () => {
    const captain = await account(t);
    const player = await account(t);
    const avatar = await withAvatar(player);
    const team = await teamWithBadge(captain);
    await addMember(t, team.id, player.id, 'player');

    const list = paginatedResponseSchema(teamSummarySchema).parse(
      await expectJson(await api.listTeams(captain.headers), 200),
    );
    expect(list.items.find((item) => item.id === team.id)?.badgeUrl).toBe(urlOf(team.badgeKey));

    const detail = teamDetailSchema.parse(
      await expectJson(await api.getTeam(captain.headers, team.id), 200),
    );
    expect(detail.badgeUrl).toBe(urlOf(team.badgeKey));
    const avatars = new Map(
      detail.members.map((member) => [member.user.id, member.user.avatarUrl]),
    );
    expect(avatars.get(player.id)).toBe(urlOf(avatar));
    expect(avatars.get(captain.id)).toBeNull();

    const member = teamMemberSchema.parse(
      await expectJson(
        await api.updateMember(captain.headers, team.id, player.id, { role: 'co_captain' }),
        200,
      ),
    );
    expect(member.user.avatarUrl).toBe(urlOf(avatar));
  });

  it('returns the badge URL in the invite preview and the accept response', async () => {
    const captain = await account(t);
    const joiner = await account(t);
    const team = await teamWithBadge(captain);
    const invite = await insertInvite(t, team.id);

    const preview = invitePreviewSchema.parse(
      await expectJson(await api.previewInvite(joiner.headers, invite.code), 200),
    );
    expect(preview.team.badgeUrl).toBe(urlOf(team.badgeKey));

    const accepted = await expectJson<{ team: { badgeUrl: string | null } }>(
      await api.acceptInvite(joiner.headers, invite.code),
      200,
    );
    expect(teamSummarySchema.parse(accepted.team).badgeUrl).toBe(urlOf(team.badgeKey));
  });
});

describe('GET matches/:id', () => {
  it('returns participant avatar URLs', async () => {
    const captain = await account(t);
    const player = await account(t);
    const avatar = await withAvatar(player);
    const teamId = await insertTeam(t, captain.id);
    await addMember(t, teamId, player.id, 'player');
    const matchId = await insertMatch(t, teamId, 'open');
    await insertRsvp(t, matchId, player.id, 'in');

    const body = matchDetailSchema.parse(
      await expectJson(
        await call(getMatchRoute, {
          method: 'GET',
          path: `/api/v1/matches/${matchId}`,
          headers: captain.headers,
          params: { id: matchId },
        }),
        200,
      ),
    );
    const participant = body.participants.find((entry) => entry.user.id === player.id);
    expect(participant?.user.avatarUrl).toBe(urlOf(avatar));
  });
});
