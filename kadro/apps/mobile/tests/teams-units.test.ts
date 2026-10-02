import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { LIMITS } from '../../../packages/contracts/src/limits';
import { TEAM_ROLES } from '../../../packages/contracts/src/roles';
import { inviteCodeSchema, teamNameSchema } from '../../../packages/contracts/src/teams';
import { type TeamInvite, type TeamRole } from '../src/api/contracts';
import { PERSISTED_QUERY_ROOTS, queryKeys, shouldPersistQuery } from '../src/query';
import { INVITE_CODE_LENGTH, isInviteCode, parseInviteInput } from '../src/teams/invite-code';
import { activeInvites } from '../src/teams/invites';
import {
  canCreateInvite,
  canLeave,
  canManageInvites,
  canRemoveMember,
  roleChoices,
} from '../src/teams/permissions';
import { isShareableInviteUrl } from '../src/teams/share';
import { createTeamsApi } from '../src/teams/teams-api';
import { TEAM_LIMITS, teamNameIssue } from '../src/teams/validation';
import { createTestApi, issueTokens } from './support/api';
import { apiUrl, mswServer } from './support/msw';

const CODE = 'Ab3_-xY9Zq0LmN4pQrS7tU';
const TEAM_ID = '0192a0b0-0000-7000-8000-000000000001';
const USER_ID = '0192a0b0-0000-7000-8000-0000000000f2';

describe('invite input', () => {
  it('uses the contract code length', () => {
    expect(INVITE_CODE_LENGTH).toBe(LIMITS.inviteCode.length);
    expect(CODE).toHaveLength(INVITE_CODE_LENGTH);
  });

  const candidates = [
    CODE,
    `${CODE}x`,
    CODE.slice(1),
    `${CODE.slice(0, 21)}!`,
    `${CODE.slice(0, 21)}=`,
    '',
    ' '.repeat(22),
  ];
  it.each(candidates)('code %j is accepted exactly when the contract accepts it', (input) => {
    expect(isInviteCode(input)).toBe(inviteCodeSchema.safeParse(input).success);
  });

  it('reads the code from a pasted link or the bare code', () => {
    expect(parseInviteInput(`  ${CODE}\n`)).toBe(CODE);
    expect(parseInviteInput(`https://kadro.app/mac/${CODE}`)).toBe(CODE);
    expect(parseInviteInput(`https://kadro.app/mac/${CODE}?utm_source=whatsapp`)).toBe(CODE);
    expect(parseInviteInput(`https://kadro.app/mac/${CODE}/`)).toBe(CODE);
    expect(parseInviteInput(`kadro://mac/${CODE}`)).toBe(CODE);
    expect(parseInviteInput(`Takıma katıl: https://kadro.app/mac/${CODE}`)).toBe(CODE);
  });

  it('rejects anything that does not carry exactly one well-formed code', () => {
    expect(parseInviteInput('')).toBeNull();
    expect(parseInviteInput('merhaba')).toBeNull();
    expect(parseInviteInput(`https://kadro.app/mac/${CODE}x`)).toBeNull();
    expect(parseInviteInput(`https://kadro.app/xmac/${CODE}`)).toBeNull();
    expect(parseInviteInput(`https://kadro.app/saha/${CODE}`)).toBeNull();
    expect(parseInviteInput(`${'a'.repeat(600)}/mac/${CODE}`)).toBeNull();
  });
});

describe('team name check matches the contract schema', () => {
  it('uses the same limits', () => {
    expect(TEAM_LIMITS).toEqual({ nameMin: LIMITS.teamName.min, nameMax: LIMITS.teamName.max });
  });

  const names = [
    '',
    'A',
    'Al',
    ' Al ',
    'Yıldızlar FK',
    'x'.repeat(60),
    'x'.repeat(61),
    `  ${'x'.repeat(60)}  `,
    'bad\u0000name',
    `rtl${String.fromCodePoint(0x202e)}name`,
    'line break',
  ];
  it.each(names)('team name %j', (input) => {
    expect(teamNameIssue(input) === null).toBe(teamNameSchema.safeParse(input).success);
  });
});

describe('controls follow the authorization matrix §3.3', () => {
  const self = (role: TeamRole) => ({ role, isSelf: true });
  const other = (role: TeamRole) => ({ role, isSelf: false });

  it('lets only the captain change roles, never their own, with transfer as `captain`', () => {
    expect(roleChoices('captain', other('player'))).toEqual(['co_captain', 'captain']);
    expect(roleChoices('captain', other('co_captain'))).toEqual(['player', 'captain']);
    expect(roleChoices('captain', self('captain'))).toEqual([]);
    for (const target of TEAM_ROLES) {
      expect(roleChoices('co_captain', other(target))).toEqual([]);
      expect(roleChoices('player', other(target))).toEqual([]);
    }
  });

  it('removal: captain any other member, co-captain players only, player nobody', () => {
    expect(canRemoveMember('captain', other('co_captain'))).toBe(true);
    expect(canRemoveMember('captain', other('player'))).toBe(true);
    expect(canRemoveMember('captain', self('captain'))).toBe(false);
    expect(canRemoveMember('co_captain', other('player'))).toBe(true);
    expect(canRemoveMember('co_captain', other('co_captain'))).toBe(false);
    expect(canRemoveMember('co_captain', other('captain'))).toBe(false);
    for (const target of TEAM_ROLES) {
      expect(canRemoveMember('player', other(target))).toBe(false);
    }
  });

  it('leaving and invites', () => {
    expect(canLeave('captain')).toBe(false);
    expect(canLeave('co_captain')).toBe(true);
    expect(canLeave('player')).toBe(true);
    expect(canManageInvites('player')).toBe(false);
    expect(canManageInvites('co_captain')).toBe(true);
    expect(canCreateInvite({ myRole: 'captain', isProLocked: false })).toBe(true);
    expect(canCreateInvite({ myRole: 'captain', isProLocked: true })).toBe(false);
  });
});

describe('invite helpers', () => {
  const invite = (id: string, expiresAt: string, uses: number, maxUses: number): TeamInvite => ({
    id,
    createdAt: '2026-10-01T10:00:00.000Z',
    expiresAt,
    uses,
    maxUses,
  });

  it('keeps unexpired invites with uses left', () => {
    const now = Date.parse('2026-10-02T12:00:00.000Z');
    const list = [
      invite('a', '2026-10-05T12:00:00.000Z', 3, 20),
      invite('revoked', '2026-10-02T11:59:59.000Z', 0, 20),
      invite('full', '2026-10-05T12:00:00.000Z', 20, 20),
    ];
    expect(activeInvites(list, now).map((entry) => entry.id)).toEqual(['a']);
  });

  it('shares and encodes only an https link carrying the code', () => {
    expect(isShareableInviteUrl(`https://kadro.app/mac/${CODE}`, CODE)).toBe(true);
    expect(isShareableInviteUrl(`http://kadro.app/mac/${CODE}`, CODE)).toBe(false);
    expect(isShareableInviteUrl(`javascript:alert(1)//${CODE}`, CODE)).toBe(false);
    expect(isShareableInviteUrl(`https://user@evil.example/mac/${CODE}`, CODE)).toBe(false);
    expect(isShareableInviteUrl('https://kadro.app/mac/other', CODE)).toBe(false);
  });
});

describe('teams data stays off the device where it must', () => {
  it('persists rosters for offline use but never invite data', () => {
    const cached = (queryKey: readonly unknown[]) =>
      ({ queryKey, state: { status: 'success', data: {} } }) as unknown as Parameters<
        typeof shouldPersistQuery
      >[0];
    expect(shouldPersistQuery(cached(queryKeys.teamDetail(TEAM_ID)))).toBe(true);
    expect(shouldPersistQuery(cached(queryKeys.teamInvites(TEAM_ID)))).toBe(false);
    expect(shouldPersistQuery(cached(queryKeys.invitePreview(CODE)))).toBe(false);
    expect([...PERSISTED_QUERY_ROOTS]).not.toContain('team-invites');
    expect([...PERSISTED_QUERY_ROOTS]).not.toContain('invite-preview');
  });
});

describe('teams api', () => {
  async function client() {
    const test = createTestApi();
    await test.session.establish(issueTokens());
    return createTeamsApi(test.api);
  }

  it('sends each call to its contract path with the contract body', async () => {
    const seen: string[] = [];
    const record = async ({ request }: { request: Request }) => {
      const body =
        request.method === 'GET' || request.method === 'DELETE' ? '' : await request.text();
      seen.push(
        `${request.method} ${new URL(request.url).pathname}${new URL(request.url).search} ${body}`,
      );
      return request.method === 'DELETE'
        ? new HttpResponse(null, { status: 204 })
        : HttpResponse.json({});
    };
    mswServer.use(http.all(apiUrl('/api/v1/*'), record));
    const teams = await client();
    await teams.createTeam({ name: '  Yıldızlar FK ', districtId: TEAM_ID });
    await teams.getTeam(TEAM_ID);
    await teams.createInvite(TEAM_ID);
    await teams.listInvites(TEAM_ID);
    await teams.revokeInvite(TEAM_ID, USER_ID);
    await teams.previewInvite(CODE);
    await teams.acceptInvite(CODE);
    await teams.updateMemberRole(TEAM_ID, USER_ID, 'co_captain');
    await teams.removeMember(TEAM_ID, USER_ID);
    expect(seen).toEqual([
      `POST /api/v1/teams {"name":"Yıldızlar FK","districtId":"${TEAM_ID}"}`,
      `GET /api/v1/teams/${TEAM_ID} `,
      `POST /api/v1/teams/${TEAM_ID}/invites {}`,
      `GET /api/v1/teams/${TEAM_ID}/invites?limit=50 `,
      `DELETE /api/v1/teams/${TEAM_ID}/invites/${USER_ID} `,
      `GET /api/v1/invites/${CODE} `,
      `POST /api/v1/invites/${CODE}/accept {}`,
      `PATCH /api/v1/teams/${TEAM_ID}/members/${USER_ID} {"role":"co_captain"}`,
      `DELETE /api/v1/teams/${TEAM_ID}/members/${USER_ID} `,
    ]);
  });

  it('never sends a malformed invite code or an id that would leave its path segment', async () => {
    let requests = 0;
    mswServer.use(
      http.all(apiUrl('/api/v1/*'), () => {
        requests += 1;
        return HttpResponse.json({});
      }),
    );
    const teams = await client();
    await expect(teams.previewInvite('../../me')).rejects.toThrow(TypeError);
    await expect(teams.acceptInvite(`${CODE}/x`)).rejects.toThrow(TypeError);
    await expect(teams.getTeam('../me')).rejects.toThrow(TypeError);
    expect(requests).toBe(0);
  });
});
