import { describe, expect, it } from 'vitest';

import { accepts, base64url, isoAt, uuidv4, uuidv7 } from './fixtures.test-helper.js';
import {
  acceptInviteRequestSchema,
  applicationSchema,
  createApplicationRequestSchema,
  createInviteRequestSchema,
  createInviteResponseSchema,
  createMatchRequestSchema,
  closeOpenCallRequestSchema,
  completeUploadRequestSchema,
  createReviewRequestSchema,
  createTeamRequestSchema,
  createVenueRequestSchema,
  decideApplicationRequestSchema,
  deleteAccountRequestSchema,
  deleteAccountResponseSchema,
  ERROR_CODES,
  ERROR_STATUS,
  ERROR_TITLES,
  inviteCodeParamsSchema,
  invitePreviewSchema,
  LIMITS,
  listApplicationsQuerySchema,
  listMatchesQuerySchema,
  paginatedResponseSchema,
  problemDetailsSchema,
  listOpenCallsQuerySchema,
  listVenuesQuerySchema,
  markPaymentRequestSchema,
  matchDetailSchema,
  matchGuestViewSchema,
  matchMemberViewSchema,
  matchParamsSchema,
  mvpVoteRequestSchema,
  mvpVoteResponseSchema,
  openCallPublicSchema,
  openCallSchema,
  presignUploadRequestSchema,
  presignUploadResponseSchema,
  publishOpenCallRequestSchema,
  setLineupRequestSchema,
  setRsvpRequestSchema,
  teamDetailSchema,
  teamInviteSchema,
  teamMemberParamsSchema,
  teamSummarySchema,
  updateMatchRequestSchema,
  updateMeRequestSchema,
  updateMemberRoleRequestSchema,
  updateTeamRequestSchema,
  uploadStatusResponseSchema,
  userCardSchema,
  VENUE_FEATURES,
  venueDetailSchema,
  venueReviewSchema,
} from './index.js';

const MIB = 1_048_576;

function badgeKey(teamId = uuidv7()): string {
  return `badges/${teamId}/${uuidv7()}.webp`;
}

function publicUser() {
  return {
    id: uuidv7(),
    displayName: 'Ayşe',
    avatarUrl: null,
    position: 'MID',
    level: 'regular',
  };
}

describe('error codes', () => {
  it('maps every domain conflict of the matrix and ADRs to 409', () => {
    for (const code of [
      'invalid_status_transition',
      'match_state_conflict',
      'slots_below_confirmed',
      'slots_below_lineup',
      'player_not_confirmed',
      'mvp_vote_closed',
      'already_voted',
      'invalid_votee',
      'open_call_exists',
      'invalid_missing_count',
      'invalid_call_expiry',
      'already_reviewed',
      'deletion_pending',
      'invite_limit',
      'lineup_side_full',
      'venue_exists',
      'upload_not_pending',
      'captain_must_transfer',
      'team_has_history',
      'match_terms_frozen',
      'already_applied',
    ] as const) {
      expect(ERROR_CODES).toContain(code);
      expect(ERROR_STATUS[code]).toBe(409);
    }
    expect(ERROR_STATUS.entitlement_required).toBe(403);
    expect(ERROR_STATUS.review_not_eligible).toBe(403);
    expect(ERROR_STATUS.invalid_cursor).toBe(400);
  });

  it('has a fixed title for every code', () => {
    expect(Object.keys(ERROR_TITLES).sort()).toEqual([...ERROR_CODES].sort());
    for (const code of ERROR_CODES) {
      expect(ERROR_TITLES[code].length).toBeGreaterThan(0);
      expect(ERROR_TITLES[code].length).toBeLessThanOrEqual(200);
    }
  });
});

describe('problem details extension', () => {
  const problem = (code: string, status: number) => ({
    type: `https://kadro.app/problems/${code}`,
    title: 'Venue already exists',
    status,
    code,
    requestId: base64url(26),
  });

  it('carries existingSlug only on venue_exists, as a slug', () => {
    const base = problem('venue_exists', 409);
    expect(accepts(problemDetailsSchema, base)).toBe(true);
    expect(accepts(problemDetailsSchema, { ...base, existingSlug: 'moda-hali-saha' })).toBe(true);
    expect(accepts(problemDetailsSchema, { ...base, existingSlug: 'Moda Halı Saha' })).toBe(false);
    expect(accepts(problemDetailsSchema, { ...base, existingSlug: 's'.repeat(81) })).toBe(false);
    expect(
      accepts(problemDetailsSchema, { ...problem('conflict', 409), existingSlug: 'moda' }),
    ).toBe(false);
    expect(accepts(problemDetailsSchema, { ...base, existingId: uuidv7() })).toBe(false);
  });
});

describe('ids', () => {
  it('path parameters accept UUIDv7 only', () => {
    expect(accepts(matchParamsSchema, { id: uuidv7() })).toBe(true);
    expect(accepts(matchParamsSchema, { id: uuidv4() })).toBe(false);
    expect(accepts(matchParamsSchema, { id: uuidv7().toUpperCase() })).toBe(true);
    expect(accepts(matchParamsSchema, { id: '1' })).toBe(false);
    expect(accepts(matchParamsSchema, { id: uuidv7(), extra: 'x' })).toBe(false);
    expect(accepts(teamMemberParamsSchema, { id: uuidv7(), userId: uuidv4() })).toBe(false);
  });

  it('fixtures produce distinct, well-formed ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => uuidv7()));
    expect(ids.size).toBe(50);
  });
});

describe('teams', () => {
  const create = () => ({ name: 'Kadıköy Kartalları', districtId: uuidv7() });

  it('create enforces name bounds after trimming and rejects control characters', () => {
    expect(accepts(createTeamRequestSchema, create())).toBe(true);
    const at = (name: string) => accepts(createTeamRequestSchema, { ...create(), name });
    expect(at('a'.repeat(LIMITS.teamName.min))).toBe(true);
    expect(at('a'.repeat(LIMITS.teamName.max))).toBe(true);
    expect(at('a'.repeat(LIMITS.teamName.min - 1))).toBe(false);
    expect(at(` ${'a'.repeat(LIMITS.teamName.min - 1)} `)).toBe(false);
    expect(at('a'.repeat(LIMITS.teamName.max + 1))).toBe(false);
    expect(at(`Takım${String.fromCodePoint(0x202e)}`)).toBe(false);
    expect(createTeamRequestSchema.parse({ ...create(), name: '  Kartallar ' }).name).toBe(
      'Kartallar',
    );
  });

  it('create rejects server-only fields and non-v7 districts', () => {
    for (const extra of [
      { ownerId: uuidv7() },
      { slug: 'kartallar' },
      { isProLocked: false },
      { badgeKey: badgeKey() },
    ]) {
      expect(accepts(createTeamRequestSchema, { ...create(), ...extra })).toBe(false);
    }
    expect(accepts(createTeamRequestSchema, { ...create(), districtId: uuidv4() })).toBe(false);
  });

  it('update needs a writable field; the badge can only be removed, never set by key', () => {
    expect(accepts(updateTeamRequestSchema, {})).toBe(false);
    expect(accepts(updateTeamRequestSchema, { badge: null })).toBe(true);
    expect(accepts(updateTeamRequestSchema, { badge: badgeKey() })).toBe(false);
    expect(accepts(updateTeamRequestSchema, { badgeKey: badgeKey() })).toBe(false);
    expect(accepts(updateTeamRequestSchema, { name: 'Yeni Ad', ownerId: uuidv7() })).toBe(false);
    expect(accepts(updateTeamRequestSchema, { isProLocked: false })).toBe(false);
  });

  it('member role changes accept team roles only', () => {
    expect(accepts(updateMemberRoleRequestSchema, { role: 'captain' })).toBe(true);
    expect(accepts(updateMemberRoleRequestSchema, { role: 'co_captain' })).toBe(true);
    expect(accepts(updateMemberRoleRequestSchema, { role: 'admin' })).toBe(false);
    expect(accepts(updateMemberRoleRequestSchema, { role: 'player', userId: uuidv7() })).toBe(
      false,
    );
  });

  it('team responses expose the public roster only', () => {
    const summary = {
      id: uuidv7(),
      name: 'Kartallar',
      slug: 'kartallar',
      badgeUrl: null,
      districtId: uuidv7(),
      myRole: 'captain',
      memberCount: 1,
      isProLocked: false,
      createdAt: isoAt(),
    };
    const detail = {
      ...summary,
      members: [{ user: publicUser(), role: 'captain', joinedAt: isoAt() }],
    };
    expect(accepts(teamSummarySchema, summary)).toBe(true);
    expect(accepts(teamDetailSchema, detail)).toBe(true);
    expect(accepts(teamSummarySchema, { ...summary, ownerId: uuidv7() })).toBe(false);
    expect(
      accepts(teamDetailSchema, {
        ...detail,
        members: [
          { user: { ...publicUser(), email: 'a@example.com' }, role: 'player', joinedAt: isoAt() },
        ],
      }),
    ).toBe(false);
    expect(accepts(teamDetailSchema, { ...detail, members: [] })).toBe(false);
  });
});

describe('invites', () => {
  it('defaults to 7 days and 20 uses', () => {
    expect(createInviteRequestSchema.parse({})).toEqual({
      expiresInSeconds: 604_800,
      maxUses: 20,
    });
  });

  it('validity window and use count stay within the matrix bounds', () => {
    const at = (expiresInSeconds: number, maxUses: number) =>
      accepts(createInviteRequestSchema, { expiresInSeconds, maxUses });
    const { min: minSeconds, max: maxSeconds } = LIMITS.inviteExpiresInSeconds;
    expect(at(minSeconds, LIMITS.inviteMaxUses.min)).toBe(true);
    expect(at(maxSeconds, LIMITS.inviteMaxUses.max)).toBe(true);
    expect(at(minSeconds - 1, 1)).toBe(false);
    expect(at(maxSeconds + 1, 1)).toBe(false);
    expect(at(minSeconds, LIMITS.inviteMaxUses.min - 1)).toBe(false);
    expect(at(minSeconds, LIMITS.inviteMaxUses.max + 1)).toBe(false);
    expect(at(minSeconds + 0.5, 1)).toBe(false);
    expect(
      accepts(createInviteRequestSchema, { expiresInSeconds: minSeconds, maxUses: 1, uses: 0 }),
    ).toBe(false);
  });

  it('codes are 22 base64url characters', () => {
    const { length } = LIMITS.inviteCode;
    expect(accepts(inviteCodeParamsSchema, { code: base64url(length) })).toBe(true);
    expect(accepts(inviteCodeParamsSchema, { code: base64url(length - 1) })).toBe(false);
    expect(accepts(inviteCodeParamsSchema, { code: base64url(length + 1) })).toBe(false);
    expect(accepts(inviteCodeParamsSchema, { code: `${base64url(length - 1)}=` })).toBe(false);
  });

  it('the create response carries the plaintext code once and never its hash', () => {
    const response = {
      inviteId: uuidv7(),
      code: base64url(LIMITS.inviteCode.length),
      url: 'https://kadro.app/mac/kod',
      expiresAt: isoAt(3_600_000),
      maxUses: 10,
    };
    expect(accepts(createInviteResponseSchema, response)).toBe(true);
    expect(accepts(createInviteResponseSchema, { ...response, codeHash: 'f'.repeat(64) })).toBe(
      false,
    );
    expect(
      accepts(createInviteResponseSchema, { ...response, url: 'http://kadro.app/mac/kod' }),
    ).toBe(false);
  });

  it('accept takes an empty body', () => {
    expect(accepts(acceptInviteRequestSchema, {})).toBe(true);
    expect(accepts(acceptInviteRequestSchema, { teamId: uuidv7() })).toBe(false);
  });

  it('the staff list never contains a code and the preview never names people', () => {
    const invite = {
      id: uuidv7(),
      createdAt: isoAt(),
      expiresAt: isoAt(3_600_000),
      uses: 0,
      maxUses: 20,
    };
    expect(accepts(teamInviteSchema, invite)).toBe(true);
    expect(accepts(teamInviteSchema, { ...invite, code: base64url(22) })).toBe(false);
    expect(accepts(teamInviteSchema, { ...invite, codeHash: 'f'.repeat(64) })).toBe(false);
    const preview = {
      team: { name: 'Kartallar', badgeUrl: null, districtId: uuidv7(), memberCount: 7 },
    };
    expect(accepts(invitePreviewSchema, preview)).toBe(true);
    expect(accepts(invitePreviewSchema, { team: { ...preview.team, captainName: 'Ayşe' } })).toBe(
      false,
    );
    expect(accepts(invitePreviewSchema, { ...preview, members: [] })).toBe(false);
  });
});

describe('matches', () => {
  const create = () => ({
    venueText: 'Moda Halı Saha',
    startsAt: isoAt(86_400_000),
    format: '7v7',
    feeTotalMinor: 350_000,
    slots: 14,
  });

  it('fee and slots are bounded integers', () => {
    const at = (feeTotalMinor: number, slots: number) =>
      accepts(createMatchRequestSchema, { ...create(), feeTotalMinor, slots });
    expect(at(LIMITS.feeTotalMinor.min, LIMITS.slots.min)).toBe(true);
    expect(at(LIMITS.feeTotalMinor.max, LIMITS.slots.max)).toBe(true);
    expect(at(LIMITS.feeTotalMinor.min - 1, 10)).toBe(false);
    expect(at(LIMITS.feeTotalMinor.max + 1, 10)).toBe(false);
    expect(at(100.5, 10)).toBe(false);
    expect(at(0, LIMITS.slots.min - 1)).toBe(false);
    expect(at(0, LIMITS.slots.max + 1)).toBe(false);
    expect(accepts(createMatchRequestSchema, { ...create(), feeTotalMinor: '100' })).toBe(false);
  });

  it('requires exactly one venue reference', () => {
    const { venueText: _venueText, ...withoutVenue } = create();
    expect(accepts(createMatchRequestSchema, withoutVenue)).toBe(false);
    expect(accepts(createMatchRequestSchema, { ...withoutVenue, venueId: uuidv7() })).toBe(true);
    expect(accepts(createMatchRequestSchema, { ...create(), venueId: uuidv7() })).toBe(false);
    expect(accepts(createMatchRequestSchema, { ...create(), venueText: 'x' })).toBe(false);
    expect(
      accepts(createMatchRequestSchema, {
        ...create(),
        venueText: 'v'.repeat(LIMITS.venueText.max + 1),
      }),
    ).toBe(false);
  });

  it('create accepts draft or open, never server-owned fields', () => {
    expect(accepts(createMatchRequestSchema, { ...create(), status: 'open' })).toBe(true);
    expect(accepts(createMatchRequestSchema, { ...create(), status: 'locked' })).toBe(false);
    for (const extra of [
      { teamId: uuidv7() },
      { lockedAt: isoAt() },
      { mvpVoteClosesAt: isoAt() },
      { id: uuidv7() },
    ]) {
      expect(accepts(createMatchRequestSchema, { ...create(), ...extra })).toBe(false);
    }
    expect(accepts(createMatchRequestSchema, { ...create(), format: '9v9' })).toBe(false);
    expect(
      accepts(createMatchRequestSchema, { ...create(), startsAt: '2026-10-01T10:00:00' }),
    ).toBe(false);
  });

  it('update validates status targets and rejects frozen-state fields', () => {
    expect(accepts(updateMatchRequestSchema, {})).toBe(false);
    expect(accepts(updateMatchRequestSchema, { status: 'locked' })).toBe(true);
    expect(accepts(updateMatchRequestSchema, { status: 'draft' })).toBe(false);
    expect(accepts(updateMatchRequestSchema, { slots: 12, feeTotalMinor: 0 })).toBe(true);
    expect(accepts(updateMatchRequestSchema, { venueId: uuidv7(), venueText: 'Saha' })).toBe(false);
    for (const field of ['lockedAt', 'mvpVoteClosesAt', 'teamId', 'paid', 'side']) {
      expect(accepts(updateMatchRequestSchema, { slots: 12, [field]: null })).toBe(false);
    }
  });

  it('list query paginates and filters by status', () => {
    expect(listMatchesQuerySchema.parse({ status: 'open' })).toEqual({
      status: 'open',
      limit: LIMITS.pageSize.default,
    });
    expect(accepts(listMatchesQuerySchema, { status: 'deleted' })).toBe(false);
    expect(accepts(listMatchesQuerySchema, { teamId: uuidv7() })).toBe(false);
  });

  it('RSVP accepts in, out and maybe from the actor only', () => {
    for (const status of ['in', 'out', 'maybe']) {
      expect(accepts(setRsvpRequestSchema, { status })).toBe(true);
    }
    expect(accepts(setRsvpRequestSchema, { status: 'waitlist' })).toBe(false);
    for (const extra of [{ userId: uuidv7() }, { side: 'A' }, { paid: true }]) {
      expect(accepts(setRsvpRequestSchema, { status: 'in', ...extra })).toBe(false);
    }
  });

  it('lineup lists each user once, with sides A or B, at most one full match', () => {
    const entry = () => ({ userId: uuidv7(), side: 'A' });
    expect(accepts(setLineupRequestSchema, { sides: [] })).toBe(true);
    expect(
      accepts(setLineupRequestSchema, { sides: Array.from({ length: LIMITS.slots.max }, entry) }),
    ).toBe(true);
    expect(
      accepts(setLineupRequestSchema, {
        sides: Array.from({ length: LIMITS.slots.max + 1 }, entry),
      }),
    ).toBe(false);
    const duplicate = entry();
    expect(
      accepts(setLineupRequestSchema, { sides: [duplicate, { ...duplicate, side: 'B' }] }),
    ).toBe(false);
    expect(accepts(setLineupRequestSchema, { sides: [{ ...entry(), side: 'C' }] })).toBe(false);
    expect(accepts(setLineupRequestSchema, { sides: [{ ...entry(), paid: true }] })).toBe(false);
    expect(accepts(setLineupRequestSchema, { assignments: [] })).toBe(false);
  });

  it('payments write only the paid flag and votes only the votee', () => {
    expect(accepts(markPaymentRequestSchema, { paid: true })).toBe(true);
    expect(accepts(markPaymentRequestSchema, { paid: 'yes' })).toBe(false);
    expect(accepts(markPaymentRequestSchema, { paid: true, amountMinor: 100 })).toBe(false);
    expect(accepts(mvpVoteRequestSchema, { voteeId: uuidv7() })).toBe(true);
    expect(accepts(mvpVoteRequestSchema, { voteeId: uuidv4() })).toBe(false);
    expect(accepts(mvpVoteRequestSchema, { voteeId: uuidv7(), voterId: uuidv7() })).toBe(false);
    const vote = { matchId: uuidv7(), voteeId: uuidv7() };
    expect(accepts(mvpVoteResponseSchema, vote)).toBe(true);
    expect(accepts(mvpVoteResponseSchema, { ...vote, votes: 3 })).toBe(false);
  });

  const summary = () => ({
    id: uuidv7(),
    teamId: uuidv7(),
    venue: null,
    venueText: 'Moda Halı Saha',
    startsAt: isoAt(86_400_000),
    format: '7v7',
    feeTotalMinor: 350_000,
    slots: 14,
    status: 'locked',
    lockedAt: isoAt(),
    mvpVoteClosesAt: null,
    counts: { in: 1, maybe: 0, out: 0, waitlist: 0 },
    myRsvp: 'in',
    createdAt: isoAt(),
  });

  it('member projection includes paid flags; guest projection never does', () => {
    const member = {
      projection: 'member',
      ...summary(),
      team: { id: uuidv7(), name: 'Kartallar' },
      sharePerPlayerMinor: 25_000,
      myShareMinor: 25_001,
      mvp: null,
      participants: [{ user: publicUser(), status: 'in', side: 'A', paid: true }],
    };
    expect(accepts(matchMemberViewSchema, member)).toBe(true);
    expect(accepts(matchDetailSchema, member)).toBe(true);

    const { position: _position, level: _level, ...card } = publicUser();
    const guest = {
      projection: 'guest',
      id: uuidv7(),
      team: { id: uuidv7(), name: 'Kartallar' },
      venue: null,
      venueText: 'Moda Halı Saha',
      startsAt: isoAt(86_400_000),
      format: '7v7',
      status: 'locked',
      mvpVoteClosesAt: null,
      sharePerPlayerMinor: 25_000,
      myShareMinor: 25_001,
      myRsvp: { matchId: uuidv7(), status: 'in', side: 'B', updatedAt: isoAt() },
      mvp: { myVoteeId: uuidv7(), winnerIds: null },
      participants: [{ user: { ...card, position: 'GK' }, status: 'in', side: 'A' }],
    };
    expect(accepts(matchGuestViewSchema, guest)).toBe(true);
    expect(accepts(matchDetailSchema, guest)).toBe(true);
    expect(
      accepts(matchGuestViewSchema, {
        ...guest,
        participants: [{ user: { ...card, position: 'GK' }, status: 'in', side: 'A', paid: true }],
      }),
    ).toBe(false);
    expect(accepts(matchGuestViewSchema, { ...guest, feeTotalMinor: 350_000 })).toBe(false);
    expect(accepts(matchGuestViewSchema, { ...guest, myShareMinor: null })).toBe(true);
    expect(accepts(matchGuestViewSchema, { ...guest, myShareMinor: -1 })).toBe(false);
    expect(accepts(matchGuestViewSchema, { ...guest, myShareMinor: 1.5 })).toBe(false);
    const { myShareMinor: _myShare, ...withoutShare } = guest;
    expect(accepts(matchGuestViewSchema, withoutShare)).toBe(false);
    expect(
      accepts(matchGuestViewSchema, {
        ...guest,
        participants: [
          { user: { ...card, position: 'GK' }, status: 'in', side: 'A', shareMinor: 25_000 },
        ],
      }),
    ).toBe(false);
    expect(accepts(matchGuestViewSchema, { ...guest, shares: { [uuidv7()]: 25_000 } })).toBe(false);
    expect(
      accepts(matchGuestViewSchema, {
        ...guest,
        participants: [{ user: publicUser(), status: 'in', side: 'A' }],
      }),
    ).toBe(false);
    expect(accepts(matchDetailSchema, { ...guest, projection: 'admin' })).toBe(false);
    expect(
      accepts(matchGuestViewSchema, {
        ...guest,
        mvp: { myVoteeId: null, winnerIds: null, tally: {} },
      }),
    ).toBe(false);
  });

  it('the user card projection is strict', () => {
    const { level: _level, ...card } = publicUser();
    expect(accepts(userCardSchema, card)).toBe(true);
    expect(accepts(userCardSchema, { ...card, level: 'casual' })).toBe(false);
  });
});

describe('open calls', () => {
  const publish = () => ({
    missingCount: 2,
    position: 'GK',
    level: 'regular',
    districtId: uuidv7(),
    expiresAt: isoAt(3_600_000),
  });

  it('missing count stays within 1..29 and position may be any', () => {
    const at = (missingCount: number) =>
      accepts(publishOpenCallRequestSchema, { ...publish(), missingCount });
    expect(at(LIMITS.missingCount.min)).toBe(true);
    expect(at(LIMITS.missingCount.max)).toBe(true);
    expect(at(LIMITS.missingCount.min - 1)).toBe(false);
    expect(at(LIMITS.missingCount.max + 1)).toBe(false);
    expect(accepts(publishOpenCallRequestSchema, { ...publish(), position: null })).toBe(true);
    expect(accepts(publishOpenCallRequestSchema, { ...publish(), level: 'pro' })).toBe(false);
    const { districtId: _districtId, ...withoutDistrict } = publish();
    expect(accepts(publishOpenCallRequestSchema, withoutDistrict)).toBe(true);
  });

  it('staff can only close a call', () => {
    expect(accepts(closeOpenCallRequestSchema, { status: 'closed' })).toBe(true);
    for (const status of ['open', 'expired', 'removed']) {
      expect(accepts(closeOpenCallRequestSchema, { status })).toBe(false);
    }
    expect(accepts(closeOpenCallRequestSchema, { status: 'closed', missingCount: 0 })).toBe(false);
  });

  it('publish rejects server-owned fields', () => {
    for (const extra of [{ matchId: uuidv7() }, { status: 'open' }, { id: uuidv7() }]) {
      expect(accepts(publishOpenCallRequestSchema, { ...publish(), ...extra })).toBe(false);
    }
    const { expiresAt: _expiresAt, ...withoutExpiry } = publish();
    expect(accepts(publishOpenCallRequestSchema, withoutExpiry)).toBe(false);
  });

  it('list filters are optional enums and v7 ids', () => {
    expect(listOpenCallsQuerySchema.parse({})).toEqual({ limit: LIMITS.pageSize.default });
    expect(
      accepts(listOpenCallsQuerySchema, {
        district: uuidv7(),
        level: 'casual',
        position: 'FWD',
        limit: '50',
      }),
    ).toBe(true);
    expect(accepts(listOpenCallsQuerySchema, { district: uuidv4() })).toBe(false);
    expect(accepts(listOpenCallsQuerySchema, { province: 'istanbul' })).toBe(true);
    expect(accepts(listOpenCallsQuerySchema, { province: 'İstanbul' })).toBe(false);
    expect(accepts(listOpenCallsQuerySchema, { district: uuidv7(), province: 'istanbul' })).toBe(
      false,
    );
    expect(accepts(listOpenCallsQuerySchema, { position: 'ST' })).toBe(false);
    expect(accepts(listOpenCallsQuerySchema, { teamId: uuidv7() })).toBe(false);
  });

  it('the from .. to window spans at most 31 days', () => {
    const day = 86_400_000;
    const from = isoAt();
    const at = (to: string) => accepts(listOpenCallsQuerySchema, { from, to });
    expect(at(new Date(Date.parse(from) + LIMITS.openCallListRangeDays * day).toISOString())).toBe(
      true,
    );
    expect(
      at(new Date(Date.parse(from) + LIMITS.openCallListRangeDays * day + 1).toISOString()),
    ).toBe(false);
    expect(at(new Date(Date.parse(from) - 1).toISOString())).toBe(false);
    expect(accepts(listOpenCallsQuerySchema, { from })).toBe(true);
    expect(accepts(listOpenCallsQuerySchema, { from: '2026-10-01' })).toBe(false);
  });

  it('the public projection carries no people, RSVPs or fees', () => {
    const call = {
      id: uuidv7(),
      districtId: uuidv7(),
      startsAt: isoAt(86_400_000),
      format: '6v6',
      missingCount: 1,
      position: null,
      level: 'casual',
      venue: null,
      teamName: 'Kartallar',
      expiresAt: isoAt(3_600_000),
    };
    expect(accepts(openCallPublicSchema, call)).toBe(true);
    for (const extra of [
      { matchId: uuidv7() },
      { feeTotalMinor: 1000 },
      { captain: publicUser() },
      { address: 'Moda' },
    ]) {
      expect(accepts(openCallPublicSchema, { ...call, ...extra })).toBe(false);
    }
    expect(
      accepts(openCallSchema, {
        id: uuidv7(),
        matchId: uuidv7(),
        missingCount: 0,
        position: null,
        level: 'casual',
        districtId: uuidv7(),
        status: 'closed',
        expiresAt: isoAt(),
        createdAt: isoAt(),
      }),
    ).toBe(true);
  });

  it('application messages are bounded plain text', () => {
    const max = LIMITS.applicationMessage.max;
    expect(accepts(createApplicationRequestSchema, {})).toBe(true);
    expect(accepts(createApplicationRequestSchema, { message: 'm'.repeat(max) })).toBe(true);
    expect(accepts(createApplicationRequestSchema, { message: 'm'.repeat(max + 1) })).toBe(false);
    expect(accepts(createApplicationRequestSchema, { message: 'Geliyorum\u0007' })).toBe(false);
    expect(accepts(createApplicationRequestSchema, { message: '   ' })).toBe(false);
    expect(createApplicationRequestSchema.parse({ message: 'Kaleci\r\nolurum ' }).message).toBe(
      'Kaleci\nolurum',
    );
    expect(accepts(createApplicationRequestSchema, { message: 'x', status: 'accepted' })).toBe(
      false,
    );
  });

  it('the application list filters by status with cursor pagination only', () => {
    expect(listApplicationsQuerySchema.parse({})).toEqual({ limit: LIMITS.pageSize.default });
    for (const status of ['pending', 'accepted', 'rejected', 'withdrawn']) {
      expect(accepts(listApplicationsQuerySchema, { status })).toBe(true);
    }
    expect(accepts(listApplicationsQuerySchema, { status: 'open' })).toBe(false);
    expect(accepts(listApplicationsQuerySchema, { limit: '0' })).toBe(false);
    expect(accepts(listApplicationsQuerySchema, { limit: '101' })).toBe(false);
    expect(accepts(listApplicationsQuerySchema, { limit: '100', cursor: 'abc_-1' })).toBe(true);
    expect(accepts(listApplicationsQuerySchema, { userId: uuidv7() })).toBe(false);
    const page = paginatedResponseSchema(applicationSchema);
    const item = {
      id: uuidv7(),
      openCallId: uuidv7(),
      applicant: publicUser(),
      message: 'Kaleci olurum',
      status: 'pending',
      createdAt: isoAt(),
      updatedAt: isoAt(),
    };
    expect(accepts(page, { items: [item], nextCursor: null })).toBe(true);
    expect(
      accepts(page, {
        items: [{ ...item, applicant: { ...publicUser(), email: 'a@example.com' } }],
        nextCursor: null,
      }),
    ).toBe(false);
  });

  it('decisions accept the three target states only', () => {
    for (const status of ['accepted', 'rejected', 'withdrawn']) {
      expect(accepts(decideApplicationRequestSchema, { status })).toBe(true);
    }
    expect(accepts(decideApplicationRequestSchema, { status: 'pending' })).toBe(false);
    expect(accepts(decideApplicationRequestSchema, { status: 'accepted', userId: uuidv7() })).toBe(
      false,
    );
  });

  it('applications show the applicant’s public profile, never contact data', () => {
    const application = {
      id: uuidv7(),
      openCallId: uuidv7(),
      applicant: publicUser(),
      message: null,
      status: 'pending',
      createdAt: isoAt(),
      updatedAt: isoAt(),
    };
    expect(accepts(applicationSchema, application)).toBe(true);
    expect(
      accepts(applicationSchema, {
        ...application,
        applicant: { ...publicUser(), email: 'a@example.com' },
      }),
    ).toBe(false);
    expect(
      accepts(applicationSchema, {
        ...application,
        applicant: { ...publicUser(), districtId: uuidv7() },
      }),
    ).toBe(false);
  });
});

describe('venues', () => {
  const create = () => ({
    name: 'Moda Halı Saha',
    districtId: uuidv7(),
    location: { latitude: 40.98, longitude: 29.02 },
    indoor: false,
    features: { lighting: true, parking: false },
  });

  it('create validates bounds, features and price order', () => {
    expect(accepts(createVenueRequestSchema, create())).toBe(true);
    const at = (name: string) => accepts(createVenueRequestSchema, { ...create(), name });
    expect(at('a'.repeat(LIMITS.venueName.min))).toBe(true);
    expect(at('a'.repeat(LIMITS.venueName.max))).toBe(true);
    expect(at('a'.repeat(LIMITS.venueName.min - 1))).toBe(false);
    expect(at('a'.repeat(LIMITS.venueName.max + 1))).toBe(false);
    expect(
      accepts(createVenueRequestSchema, { ...create(), features: { sauna: true, lighting: true } }),
    ).toBe(false);
    expect(
      accepts(createVenueRequestSchema, { ...create(), priceMinMinor: 200, priceMaxMinor: 100 }),
    ).toBe(false);
    expect(
      accepts(createVenueRequestSchema, { ...create(), priceMinMinor: 100, priceMaxMinor: 100 }),
    ).toBe(true);
    expect(accepts(createVenueRequestSchema, { ...create(), priceMinMinor: -1 })).toBe(false);
    expect(
      accepts(createVenueRequestSchema, { ...create(), location: { latitude: 91, longitude: 0 } }),
    ).toBe(false);
    expect(accepts(createVenueRequestSchema, { ...create(), phone: '+90 216 000 00 00' })).toBe(
      true,
    );
    expect(accepts(createVenueRequestSchema, { ...create(), phone: 'call me' })).toBe(false);
    expect(VENUE_FEATURES).toEqual(['lighting', 'changingRoom', 'shower', 'parking']);
  });

  it('create can never mark a venue verified, sample or owned by someone else', () => {
    for (const extra of [
      { verified: true },
      { isSample: true },
      { slug: 'moda' },
      { createdBy: uuidv7() },
    ]) {
      expect(accepts(createVenueRequestSchema, { ...create(), ...extra })).toBe(false);
    }
  });

  it('search text has a minimum length and filters are strict', () => {
    expect(accepts(listVenuesQuerySchema, { q: 'Mo' })).toBe(true);
    expect(accepts(listVenuesQuerySchema, { q: 'M' })).toBe(false);
    expect(accepts(listVenuesQuerySchema, { q: 'q'.repeat(LIMITS.searchQuery.max + 1) })).toBe(
      false,
    );
    expect(accepts(listVenuesQuerySchema, { verified: 'false' })).toBe(false);
    expect(accepts(listVenuesQuerySchema, { province: 'ankara' })).toBe(true);
    expect(accepts(listVenuesQuerySchema, { province: 'ankara', district: uuidv7() })).toBe(false);
  });

  it('reviews: integer rating 1..5 and text up to 500 characters', () => {
    const at = (rating: number) => accepts(createReviewRequestSchema, { rating });
    expect(at(LIMITS.reviewRating.min)).toBe(true);
    expect(at(LIMITS.reviewRating.max)).toBe(true);
    expect(at(LIMITS.reviewRating.min - 1)).toBe(false);
    expect(at(LIMITS.reviewRating.max + 1)).toBe(false);
    expect(at(2.5)).toBe(false);
    const max = LIMITS.reviewText.max;
    expect(accepts(createReviewRequestSchema, { rating: 4, text: 't'.repeat(max) })).toBe(true);
    expect(accepts(createReviewRequestSchema, { rating: 4, text: 't'.repeat(max + 1) })).toBe(
      false,
    );
    expect(accepts(createReviewRequestSchema, { rating: 4, userId: uuidv7() })).toBe(false);
  });

  it('readers see the author display name only', () => {
    const review = {
      id: uuidv7(),
      authorDisplayName: 'Ayşe',
      rating: 5,
      text: '<img src=x onerror=alert(1)>',
      createdAt: isoAt(),
    };
    expect(accepts(venueReviewSchema, review)).toBe(true);
    expect(accepts(venueReviewSchema, { ...review, userId: uuidv7() })).toBe(false);
    expect(accepts(venueReviewSchema, { ...review, authorEmail: 'a@example.com' })).toBe(false);
  });

  it('venue detail never exposes the creator', () => {
    const detail = {
      id: uuidv7(),
      name: '[ÖRNEK] Saha',
      slug: 'ornek-saha',
      districtId: uuidv7(),
      location: { latitude: 41, longitude: 29 },
      indoor: true,
      priceMinMinor: null,
      priceMaxMinor: null,
      verified: false,
      isSample: true,
      rating: { average: null, count: 0 },
      address: null,
      phone: null,
      features: {},
      recentReviews: [],
      myReview: null,
    };
    expect(accepts(venueDetailSchema, detail)).toBe(true);
    expect(accepts(venueDetailSchema, { ...detail, createdBy: uuidv7() })).toBe(false);
  });

  it("venue detail carries the caller's own review as a reader-shaped review or null", () => {
    const base = {
      id: uuidv7(),
      name: 'Moda Saha',
      slug: 'moda-saha-kadikoy',
      districtId: uuidv7(),
      location: { latitude: 41, longitude: 29 },
      indoor: false,
      priceMinMinor: null,
      priceMaxMinor: null,
      verified: true,
      isSample: false,
      rating: { average: null, count: 1 },
      address: null,
      phone: null,
      features: {},
      recentReviews: [],
    };
    const review = {
      id: uuidv7(),
      authorDisplayName: 'Ayşe',
      rating: 4,
      text: null,
      createdAt: isoAt(),
    };
    expect(accepts(venueDetailSchema, { ...base, myReview: review })).toBe(true);
    expect(accepts(venueDetailSchema, { ...base, myReview: null })).toBe(true);
    expect(accepts(venueDetailSchema, base)).toBe(false);
    expect(accepts(venueDetailSchema, { ...base, myReview: { ...review, userId: uuidv7() } })).toBe(
      false,
    );
  });
});

describe('uploads', () => {
  const avatar = () => ({ kind: 'avatar', contentType: 'image/webp', contentLength: 1024 });

  it('size, type and kind/team pairing', () => {
    const at = (contentLength: number) =>
      accepts(presignUploadRequestSchema, { ...avatar(), contentLength });
    expect(at(LIMITS.uploadBytes.min)).toBe(true);
    expect(at(LIMITS.uploadBytes.max)).toBe(true);
    expect(LIMITS.uploadBytes.max).toBe(2 * MIB);
    expect(at(LIMITS.uploadBytes.min - 1)).toBe(false);
    expect(at(LIMITS.uploadBytes.max + 1)).toBe(false);
    expect(at(3 * MIB)).toBe(false);
    expect(at(1.5)).toBe(false);
    expect(accepts(presignUploadRequestSchema, { ...avatar(), contentType: 'image/gif' })).toBe(
      false,
    );
    expect(
      accepts(presignUploadRequestSchema, { ...avatar(), contentType: 'application/x-msdownload' }),
    ).toBe(false);
    expect(accepts(presignUploadRequestSchema, { ...avatar(), teamId: uuidv7() })).toBe(false);
    expect(accepts(presignUploadRequestSchema, { ...avatar(), kind: 'badge' })).toBe(false);
    expect(
      accepts(presignUploadRequestSchema, { ...avatar(), kind: 'badge', teamId: uuidv7() }),
    ).toBe(true);
    expect(accepts(presignUploadRequestSchema, { ...avatar(), kind: 'document' })).toBe(false);
  });

  it('the client can never choose the object key', () => {
    expect(accepts(presignUploadRequestSchema, { ...avatar(), key: badgeKey() })).toBe(false);
    expect(accepts(completeUploadRequestSchema, {})).toBe(true);
    expect(accepts(completeUploadRequestSchema, { key: badgeKey() })).toBe(false);
  });

  it('the presign response pins method and headers and names no key', () => {
    const response = {
      uploadId: uuidv7(),
      url: 'https://uploads.kadro.app/incoming/avatar/x?X-Amz-Signature=y',
      method: 'PUT',
      headers: { 'Content-Type': 'image/png', 'Content-Length': '1024' },
      expiresAt: isoAt(300_000),
    };
    expect(accepts(presignUploadResponseSchema, response)).toBe(true);
    expect(accepts(presignUploadResponseSchema, { ...response, method: 'POST' })).toBe(false);
    expect(accepts(presignUploadResponseSchema, { ...response, key: 'incoming/avatar/x' })).toBe(
      false,
    );
    expect(
      accepts(presignUploadResponseSchema, { ...response, url: 'http://uploads.kadro.app/x' }),
    ).toBe(false);
    expect(
      accepts(presignUploadResponseSchema, {
        ...response,
        headers: { ...response.headers, 'x-amz-acl': 'public-read' },
      }),
    ).toBe(false);
  });

  it('the status response exposes the public URL and reject reason only', () => {
    const status = {
      id: uuidv7(),
      kind: 'avatar',
      status: 'rejected',
      rejectReason: 'not_an_image',
      url: null,
    };
    expect(accepts(uploadStatusResponseSchema, status)).toBe(true);
    expect(accepts(uploadStatusResponseSchema, { ...status, rejectReason: 'virus' })).toBe(false);
    expect(accepts(uploadStatusResponseSchema, { ...status, mediaKey: badgeKey() })).toBe(false);
  });
});

describe('me and account deletion', () => {
  const jws = () => `${base64url(20)}.${base64url(40)}.${base64url(40)}`;

  it('the avatar can be removed but never set by key', () => {
    expect(accepts(updateMeRequestSchema, { avatar: null })).toBe(true);
    expect(accepts(updateMeRequestSchema, { avatar: badgeKey() })).toBe(false);
    expect(
      accepts(updateMeRequestSchema, { avatarKey: `avatars/${uuidv7()}/${uuidv7()}.webp` }),
    ).toBe(false);
  });

  it('deletion requires exactly one re-authentication proof', () => {
    const password = base64url(16);
    expect(accepts(deleteAccountRequestSchema, { password })).toBe(true);
    expect(accepts(deleteAccountRequestSchema, {})).toBe(false);
    expect(
      accepts(deleteAccountRequestSchema, {
        provider: 'apple',
        identityToken: jws(),
        nonce: base64url(LIMITS.nonce.min),
      }),
    ).toBe(true);
    expect(accepts(deleteAccountRequestSchema, { provider: 'apple', identityToken: jws() })).toBe(
      false,
    );
    expect(accepts(deleteAccountRequestSchema, { provider: 'google', identityToken: jws() })).toBe(
      true,
    );
    expect(accepts(deleteAccountRequestSchema, { provider: 'google' })).toBe(false);
    expect(accepts(deleteAccountRequestSchema, { identityToken: jws() })).toBe(false);
    expect(
      accepts(deleteAccountRequestSchema, { password, provider: 'google', identityToken: jws() }),
    ).toBe(false);
    expect(
      accepts(deleteAccountRequestSchema, { provider: 'facebook', identityToken: jws() }),
    ).toBe(false);
    expect(accepts(deleteAccountRequestSchema, { password, userId: uuidv7() })).toBe(false);
  });

  it('staff TOTP codes are six digits', () => {
    const body = (totpCode: string) => ({ password: base64url(16), totpCode });
    expect(accepts(deleteAccountRequestSchema, body('012345'))).toBe(true);
    expect(accepts(deleteAccountRequestSchema, body('01234'))).toBe(false);
    expect(accepts(deleteAccountRequestSchema, body('0123456'))).toBe(false);
    expect(accepts(deleteAccountRequestSchema, body('01234a'))).toBe(false);
  });

  it('the response states the grace deadline only', () => {
    const response = { graceUntil: isoAt(LIMITS.accountDeletionGraceSeconds * 1000) };
    expect(accepts(deleteAccountResponseSchema, response)).toBe(true);
    expect(accepts(deleteAccountResponseSchema, { ...response, userId: uuidv7() })).toBe(false);
  });
});
