import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { LIMITS } from '../../../packages/contracts/src/limits';
import { suggestLineup as contractSuggestLineup } from '../../../packages/contracts/src/lineup';
import {
  createMatchRequestSchema,
  feeTotalMinorSchema,
  MATCH_FORMATS as CONTRACT_FORMATS,
  slotsSchema,
  venueTextSchema,
} from '../../../packages/contracts/src/matches';
import { POSITIONS } from '../../../packages/contracts/src/users';
import { PERSISTED_QUERY_ROOTS, queryKeys, shouldPersistQuery } from '../src/query';
import { type MatchDetail, type MatchMemberView, type Position } from '../src/matches/contracts';
import { changedFields } from '../src/matches/edit';
import {
  dateInput,
  feeIssue,
  liraInput,
  MATCH_FORMATS,
  MATCH_LIMITS,
  parseLira,
  parseSlots,
  parseStartsAt,
  startsAtIssue,
  timeInput,
  venueTextIssue,
} from '../src/matches/form';
import { draftToAssignments, sideCapacity, suggestLineup } from '../src/matches/lineup';
import { tabMatches } from '../src/matches/list';
import { createMatchesApi } from '../src/matches/matches-api';
import { formatMinor, paymentSummary } from '../src/matches/money';
import { predictable, predictedRsvp, withOwnRsvp, withSides } from '../src/matches/mutations';
import {
  canCreateMatch,
  canEditMatch,
  canMarkPayment,
  canSetLineup,
  canVoteMvp,
  removalKind,
  rsvpChanges,
  rsvpChoices,
  statusTargets,
  termsFrozen,
} from '../src/matches/permissions';
import { matchKeys } from '../src/matches/queries';
import { createTestApi, issueTokens } from './support/api';
import { apiUrl, mswServer } from './support/msw';

const TEAM_ID = '0192a0b0-0000-7000-8000-000000000001';
const MATCH_ID = '0192a0b0-0000-7000-8000-0000000000a1';
const ME_ID = '0192a0b0-0000-7000-8000-0000000000f1';
const OTHER_ID = '0192a0b0-0000-7000-8000-0000000000f2';
const HOUR = 60 * 60 * 1000;

function memberView(overrides: Partial<MatchMemberView> = {}): MatchMemberView {
  return {
    projection: 'member',
    id: MATCH_ID,
    teamId: TEAM_ID,
    team: { id: TEAM_ID, name: 'Yıldızlar FK' },
    venue: null,
    venueText: 'Moda Sahası',
    startsAt: new Date(Date.now() + 48 * HOUR).toISOString(),
    format: '7v7',
    feeTotalMinor: 140_000,
    slots: 2,
    status: 'open',
    lockedAt: null,
    mvpVoteClosesAt: null,
    counts: { in: 1, maybe: 0, out: 0, waitlist: 0 },
    myRsvp: null,
    createdAt: '2026-09-20T10:00:00.000Z',
    sharePerPlayerMinor: 140_000,
    myShareMinor: null,
    mvp: null,
    participants: [
      {
        user: {
          id: OTHER_ID,
          displayName: 'Zeynep',
          avatarUrl: null,
          position: 'MID',
          level: null,
        },
        status: 'in',
        side: 'A',
        paid: true,
      },
    ],
    ...overrides,
  };
}

describe('match form checks mirror the contracts', () => {
  it('uses the contract limits and formats', () => {
    expect(MATCH_LIMITS.feeMinMinor).toBe(LIMITS.feeTotalMinor.min);
    expect(MATCH_LIMITS.feeMaxMinor).toBe(LIMITS.feeTotalMinor.max);
    expect(MATCH_LIMITS.slotsMin).toBe(LIMITS.slots.min);
    expect(MATCH_LIMITS.slotsMax).toBe(LIMITS.slots.max);
    expect(MATCH_LIMITS.venueTextMin).toBe(LIMITS.venueText.min);
    expect(MATCH_LIMITS.venueTextMax).toBe(LIMITS.venueText.max);
    expect(MATCH_LIMITS.searchMin).toBe(LIMITS.searchQuery.min);
    expect(MATCH_LIMITS.searchMax).toBe(LIMITS.searchQuery.max);
    expect([...MATCH_FORMATS]).toEqual([...CONTRACT_FORMATS]);
  });

  const venueTexts = [
    'Moda',
    ' M ',
    'M',
    'x'.repeat(200),
    'x'.repeat(201),
    `Moda${String.fromCodePoint(0x202e)}Saha`,
    '  ',
  ];
  it.each(venueTexts)(
    'free-text venue %j is accepted exactly when the contract accepts it',
    (text) => {
      expect(venueTextIssue(text) === null).toBe(venueTextSchema.safeParse(text).success);
    },
  );

  const fees = [
    '0',
    '1500',
    '1.500',
    '1500,50',
    '1.500,5',
    '1500.50',
    '₺ 2.100',
    '1500 TL',
    '1,500',
    '1500,505',
    '-5',
    'abc',
    '',
    '1.000.000',
    '1.000.000,01',
  ];
  it.each(fees)('fee %j becomes kuruş the contract accepts, or a field error', (raw) => {
    const minor = parseLira(raw);
    if (feeIssue(raw) === null) {
      expect(minor).not.toBeNull();
      expect(feeTotalMinorSchema.safeParse(minor).success).toBe(true);
    } else if (minor !== null) {
      expect(feeTotalMinorSchema.safeParse(minor).success).toBe(false);
    }
  });

  it('reads lira the way a Turkish user writes it', () => {
    expect(parseLira('1.500')).toBe(150_000);
    expect(parseLira('1500,50')).toBe(150_050);
    expect(parseLira('1.500,5')).toBe(150_050);
    expect(parseLira('1500.5')).toBe(150_050);
    expect(parseLira('₺ 2.100')).toBe(210_000);
    expect(parseLira('1500 TL')).toBe(150_000);
    expect(parseLira('1,500')).toBeNull();
    expect(feeIssue('1.000.000,01')).toBe('validation.feeTooHigh');
    expect(liraInput(150_050)).toBe('1500,50');
    expect(liraInput(150_000)).toBe('1500');
    expect(parseLira(liraInput(150_005))).toBe(150_005);
  });

  it.each(['1', '2', '14', '30', '31', ' 7 ', '7.5', ''])('slots %j follow the contract', (raw) => {
    const text = raw.trim();
    const contractAccepts = /^\d+$/.test(text) && slotsSchema.safeParse(Number(text)).success;
    expect(parseSlots(raw) !== null).toBe(contractAccepts);
  });

  it('reads day and time in the device time zone and refuses days that do not exist', () => {
    const date = parseStartsAt('25.10.2026', '21:00');
    expect(date?.getTime()).toBe(new Date(2026, 9, 25, 21, 0).getTime());
    expect(parseStartsAt('31.02.2027', '21:00')).toBeNull();
    expect(parseStartsAt('25.10.2026', '24:00')).toBeNull();
    expect(startsAtIssue('2026-10-25', '21:00')).toBe('validation.dateInvalid');
    expect(startsAtIssue('25.10.2026', '9pm')).toBe('validation.timeInvalid');
    const now = new Date(2026, 9, 25, 21, 0).getTime();
    expect(startsAtIssue('25.10.2026', '21:00', now)).toBe('validation.startsInPast');
    expect(startsAtIssue('25.10.2026', '21:01', now)).toBeNull();
    const iso = new Date(2026, 9, 25, 9, 5).toISOString();
    expect([dateInput(iso), timeInput(iso)]).toEqual(['25.10.2026', '09:05']);
  });

  it('builds a create body the contract schema accepts', () => {
    const startsAt = parseStartsAt('25.10.2026', '21:00')?.toISOString();
    expect(
      createMatchRequestSchema.safeParse({
        venueText: 'Moda Sahası',
        startsAt,
        format: '7v7',
        feeTotalMinor: parseLira('1.500'),
        slots: parseSlots('14'),
        status: 'open',
      }).success,
    ).toBe(true);
  });
});

describe('edit sends only what changed', () => {
  const match = memberView({ slots: 14, startsAt: '2026-10-25T18:00:30.000Z' });
  const same = {
    venue: { kind: 'text' as const, text: 'Moda Sahası' },
    startsAt: '2026-10-25T18:00:00.000Z',
    format: '7v7' as const,
    slots: 14,
    feeTotalMinor: 140_000,
  };

  it('sends nothing for an unchanged form (a stored start with seconds is the same minute)', () => {
    expect(changedFields(match, same, false)).toBeNull();
  });

  it('sends the changed fields only, and never frozen terms', () => {
    const changed = {
      ...same,
      slots: 16,
      feeTotalMinor: 150_000,
      startsAt: '2026-10-25T19:00:00.000Z',
    };
    expect(changedFields(match, changed, false)).toEqual({
      slots: 16,
      feeTotalMinor: 150_000,
      startsAt: '2026-10-25T19:00:00.000Z',
    });
    expect(changedFields(match, changed, true)).toEqual({ startsAt: '2026-10-25T19:00:00.000Z' });
  });

  it('switches between directory and free-text venue', () => {
    const venue = {
      kind: 'directory' as const,
      id: '0192a0b0-0000-7000-8000-0000000000e1',
      name: 'Moda',
    };
    expect(changedFields(match, { ...same, venue }, false)).toEqual({ venueId: venue.id });
    const withVenue = {
      ...match,
      venue: { id: venue.id, name: 'Moda', slug: 'moda' },
      venueText: null,
    };
    expect(changedFields(withVenue, same, false)).toEqual({
      venueText: 'Moda Sahası',
    });
  });
});

describe('fee split', () => {
  it('does not depend on the order participants arrive in', () => {
    const rows = [
      { userId: 'a', paid: true },
      { userId: 'b', paid: false },
      { userId: 'c', paid: true },
    ];
    const forward = paymentSummary(100_001, rows, 33_333, 'c', 33_334);
    const reversed = paymentSummary(100_001, [...rows].reverse(), 33_333, 'c', 33_334);
    expect(reversed.collectedMinor).toBe(forward.collectedMinor);
    // Base share for others, the server's exact share for the viewer; a lower bound while uneven.
    expect(forward.collectedMinor).toBe(33_333 + 33_334);
    expect(forward.uneven).toBe(true);
    expect(['a', 'b', 'c'].map(forward.shareOf)).toEqual([33_333, 33_333, 33_334]);
    expect(['a', 'b', 'c'].map(reversed.shareOf)).toEqual([33_333, 33_333, 33_334]);
  });

  it('is exact when the fee splits evenly', () => {
    const summary = paymentSummary(
      150_000,
      [
        { userId: 'a', paid: true },
        { userId: 'b', paid: true },
      ],
      75_000,
      null,
      null,
    );
    expect(summary.uneven).toBe(false);
    expect(summary.collectedMinor).toBe(150_000);
    expect(paymentSummary(100, [], null, null, null).uneven).toBe(false);
  });

  it('shows whole lira without decimals and a share to the kuruş', () => {
    expect(formatMinor(150_000, 'tr')).toBe(
      new Intl.NumberFormat('tr', {
        style: 'currency',
        currency: 'TRY',
        maximumFractionDigits: 0,
      }).format(1500),
    );
    expect(formatMinor(33_334, 'tr')).toContain('333,34');
  });
});

describe('lineup', () => {
  const positions: (Position | null)[] = ['GK', 'DEF', 'MID', 'FWD', null];
  const pool = Array.from({ length: 13 }, (_, index) => ({
    userId: `0192a0b0-0000-7000-8000-${String(index).padStart(12, '0')}`,
    position: positions[(index * 7) % positions.length] ?? null,
  }));

  it.each([2, 5, 10, 14, 16, 30])(
    'suggests exactly what the contracts suggest (slots %i)',
    (slots) => {
      for (let size = 0; size <= pool.length; size += 1) {
        const players = pool.slice(0, size);
        expect(suggestLineup(players, slots)).toEqual(contractSuggestLineup(players, slots));
      }
    },
  );

  it('covers every contract position', () => {
    expect(POSITIONS.every((position) => positions.includes(position))).toBe(true);
  });

  it('sends assigned players only, in RSVP order', () => {
    const draft = new Map([
      ['b', 'B' as const],
      ['a', 'A' as const],
      ['c', null],
    ]);
    expect(draftToAssignments(draft, ['a', 'b', 'c', 'd'])).toEqual([
      { userId: 'a', side: 'A' },
      { userId: 'b', side: 'B' },
    ]);
    expect(sideCapacity(13)).toBe(7);
  });

  it('applies the stored lineup: listed sides, other confirmed players unassigned', () => {
    const match = memberView();
    const stored = withSides(match, []);
    expect(stored.participants[0]?.side).toBeNull();
    expect(withSides(match, [{ userId: OTHER_ID, side: 'B' }]).participants[0]?.side).toBe('B');
  });
});

describe('RSVP prediction and optimistic row', () => {
  it('predicts the waitlist once the slots are full and keeps a confirmed player', () => {
    expect(
      predictedRsvp(memberView({ counts: { in: 1, maybe: 0, out: 0, waitlist: 0 } }), 'in'),
    ).toBe('in');
    expect(
      predictedRsvp(memberView({ counts: { in: 2, maybe: 0, out: 0, waitlist: 0 } }), 'in'),
    ).toBe('waitlist');
    expect(predictedRsvp(memberView({ myRsvp: 'waitlist' }), 'in')).toBe('waitlist');
    expect(predictedRsvp(memberView({ myRsvp: 'in' }), 'out')).toBe('out');
  });

  it('moves the counts and clears side and paid when leaving', () => {
    const match = memberView({ myRsvp: 'in', counts: { in: 1, maybe: 0, out: 0, waitlist: 0 } });
    const left = withOwnRsvp(match, OTHER_ID, 'out') as MatchMemberView;
    expect(left.counts).toEqual({ in: 0, maybe: 0, out: 1, waitlist: 0 });
    expect(left.participants[0]).toMatchObject({ status: 'out', side: null, paid: false });
    expect(left.myShareMinor).toBeNull();
    // The input is never changed (the rollback restores this object).
    expect(match.participants[0]?.status).toBe('in');
  });

  it('never waitlists a guest', () => {
    const guest: MatchDetail = {
      projection: 'guest',
      id: MATCH_ID,
      team: { id: TEAM_ID, name: 'Yıldızlar FK' },
      venue: null,
      venueText: 'Moda',
      startsAt: new Date(Date.now() + HOUR).toISOString(),
      format: '7v7',
      status: 'open',
      mvpVoteClosesAt: null,
      sharePerPlayerMinor: null,
      myShareMinor: null,
      myRsvp: {
        matchId: MATCH_ID,
        status: 'out',
        side: null,
        updatedAt: '2026-09-20T10:00:00.000Z',
      },
      mvp: null,
      participants: [],
    };
    expect(predictedRsvp(guest, 'in')).toBe('in');
    // The guest projection has no slots: a guest's `in` is never shown before the server answers
    // (a full match answers 409 `match_full`, not the waitlist).
    expect(predictable(guest, 'in')).toBe(false);
    expect(predictable(guest, 'out')).toBe(true);
    expect(predictable(memberView(), 'in')).toBe(true);
  });
});

describe('permissions follow the authorization matrix §3.4', () => {
  const now = Date.parse('2026-10-25T18:00:00.000Z');
  const future = '2026-10-26T18:00:00.000Z';
  const past = '2026-10-24T18:00:00.000Z';

  it('lets staff of an unlocked team create matches', () => {
    expect(canCreateMatch({ myRole: 'captain', isProLocked: false })).toBe(true);
    expect(canCreateMatch({ myRole: 'co_captain', isProLocked: false })).toBe(true);
    expect(canCreateMatch({ myRole: 'player', isProLocked: false })).toBe(false);
    expect(canCreateMatch({ myRole: 'captain', isProLocked: true })).toBe(false);
  });

  it('offers the footnote 12 transitions, played only after the start', () => {
    expect(statusTargets('captain', { status: 'draft', startsAt: future }, now)).toEqual(['open']);
    expect(statusTargets('captain', { status: 'open', startsAt: future }, now)).toEqual(['locked']);
    expect(statusTargets('co_captain', { status: 'open', startsAt: past }, now)).toEqual([
      'locked',
      'played',
    ]);
    expect(statusTargets('captain', { status: 'locked', startsAt: past }, now)).toEqual([
      'open',
      'played',
    ]);
    expect(statusTargets('captain', { status: 'played', startsAt: past }, now)).toEqual([]);
    expect(statusTargets('player', { status: 'open', startsAt: past }, now)).toEqual([]);
    expect(statusTargets(null, { status: 'open', startsAt: past }, now)).toEqual([]);
  });

  it('deletes drafts, cancels open and locked matches, keeps played ones (footnote 13)', () => {
    expect(removalKind('captain', 'draft')).toBe('delete');
    expect(removalKind('co_captain', 'open')).toBe('cancel');
    expect(removalKind('captain', 'locked')).toBe('cancel');
    expect(removalKind('captain', 'played')).toBeNull();
    expect(removalKind('player', 'open')).toBeNull();
  });

  it('freezes terms from the first lock on (ADR-0004)', () => {
    expect(termsFrozen({ lockedAt: null, status: 'open' })).toBe(false);
    expect(termsFrozen({ lockedAt: past, status: 'open' })).toBe(true);
    expect(termsFrozen({ lockedAt: null, status: 'locked' })).toBe(true);
    expect(canEditMatch('captain', 'locked')).toBe(true);
    expect(canEditMatch('captain', 'played')).toBe(false);
    expect(canEditMatch('player', 'open')).toBe(false);
  });

  it('offers RSVP choices per footnote 14', () => {
    expect(rsvpChoices({ status: 'open', startsAt: future }, now)).toEqual(['in', 'maybe', 'out']);
    expect(rsvpChoices({ status: 'locked', startsAt: future }, now)).toEqual(['out']);
    expect(rsvpChoices({ status: 'open', startsAt: past }, now)).toEqual([]);
    expect(rsvpChoices({ status: 'draft', startsAt: future }, now)).toEqual([]);
    expect(rsvpChanges('waitlist', 'in')).toBe(false);
    expect(rsvpChanges('in', 'in')).toBe(false);
    expect(rsvpChanges('maybe', 'in')).toBe(true);
  });

  it('lets staff set the lineup in open and locked matches only (footnote 15)', () => {
    expect(canSetLineup('captain', 'open')).toBe(true);
    expect(canSetLineup('co_captain', 'locked')).toBe(true);
    expect(canSetLineup('captain', 'played')).toBe(false);
    expect(canSetLineup('player', 'open')).toBe(false);
  });

  it('marks payments per footnote 16', () => {
    const confirmed = { status: 'in' as const, isSelf: false };
    expect(canMarkPayment('captain', 'locked', confirmed)).toBe(true);
    expect(canMarkPayment('co_captain', 'played', confirmed)).toBe(true);
    expect(canMarkPayment('captain', 'open', confirmed)).toBe(false);
    expect(canMarkPayment('player', 'locked', confirmed)).toBe(false);
    expect(canMarkPayment('captain', 'locked', { status: 'maybe', isSelf: false })).toBe(false);
    expect(canMarkPayment('captain', 'locked', { status: 'in', isSelf: true })).toBe(true);
    expect(canMarkPayment('co_captain', 'locked', { status: 'in', isSelf: true })).toBe(false);
  });

  it('opens the MVP vote to confirmed players for 24 hours (footnote 17)', () => {
    const played = { status: 'played' as const, mvpVoteClosesAt: '2026-10-26T00:00:00.000Z' };
    expect(canVoteMvp(played, 'in', null, now)).toBe(true);
    expect(canVoteMvp(played, 'in', OTHER_ID, now)).toBe(false);
    expect(canVoteMvp(played, 'maybe', null, now)).toBe(false);
    expect(canVoteMvp({ ...played, mvpVoteClosesAt: past }, 'in', null, now)).toBe(false);
    expect(canVoteMvp({ status: 'locked', mvpVoteClosesAt: null }, 'in', null, now)).toBe(false);
  });
});

describe('Maçlar tab list', () => {
  const now = Date.parse('2026-10-25T18:00:00.000Z');
  const base = memberView();
  const summary = (
    id: string,
    startsAt: string,
    status: MatchMemberView['status'],
    mvpVoteClosesAt: string | null = null,
  ) => ({
    ...base,
    id,
    startsAt,
    status,
    mvpVoteClosesAt,
  });

  it('keeps upcoming matches and played ones with an open vote, in start order', () => {
    const list = tabMatches(
      [
        summary('later', '2026-10-27T18:00:00.000Z', 'open'),
        summary('soon', '2026-10-26T18:00:00.000Z', 'locked'),
        summary('cancelled', '2026-10-26T18:00:00.000Z', 'cancelled'),
        summary('voting', '2026-10-25T10:00:00.000Z', 'played', '2026-10-26T10:00:00.000Z'),
        summary('closed', '2026-10-23T10:00:00.000Z', 'played', '2026-10-24T10:00:00.000Z'),
        summary('old', '2026-10-25T10:00:00.000Z', 'open'),
      ],
      now,
    );
    expect(list.map((match) => match.id)).toEqual(['voting', 'soon', 'later']);
  });
});

describe('matches API module', () => {
  it('sends each write to its contract path with the contract body', async () => {
    const { api, session } = createTestApi();
    await session.establish(issueTokens());
    const seen: { method: string; path: string; body: unknown }[] = [];
    const record = async ({ request }: { request: Request }) => {
      const url = new URL(request.url);
      seen.push({
        method: request.method,
        path: url.pathname + url.search,
        body: request.method === 'GET' || request.method === 'DELETE' ? null : await request.json(),
      });
      return HttpResponse.json({});
    };
    mswServer.use(
      http.all(apiUrl('/api/v1/matches/*'), record),
      http.all(apiUrl('/api/v1/teams/*'), record),
      http.get(apiUrl('/api/v1/venues'), record),
    );
    const matches = createMatchesApi(api);
    await matches.listTeamMatches(TEAM_ID, 'abc');
    await matches.setRsvp(MATCH_ID, 'maybe');
    await matches.setLineup(MATCH_ID, [{ userId: ME_ID, side: 'A' }]);
    await matches.markPayment(MATCH_ID, ME_ID, true);
    await matches.voteMvp(MATCH_ID, OTHER_ID);
    await matches.deleteMatch(MATCH_ID);
    await matches.searchVenues('moda');
    expect(seen).toEqual([
      { method: 'GET', path: `/api/v1/teams/${TEAM_ID}/matches?cursor=abc&limit=20`, body: null },
      { method: 'PUT', path: `/api/v1/matches/${MATCH_ID}/rsvp`, body: { status: 'maybe' } },
      {
        method: 'PUT',
        path: `/api/v1/matches/${MATCH_ID}/lineup`,
        body: { sides: [{ userId: ME_ID, side: 'A' }] },
      },
      {
        method: 'PATCH',
        path: `/api/v1/matches/${MATCH_ID}/payments/${ME_ID}`,
        body: { paid: true },
      },
      { method: 'POST', path: `/api/v1/matches/${MATCH_ID}/mvp-vote`, body: { voteeId: OTHER_ID } },
      { method: 'DELETE', path: `/api/v1/matches/${MATCH_ID}`, body: null },
      { method: 'GET', path: '/api/v1/venues?q=moda&limit=10', body: null },
    ]);
  });

  it('keeps match data under the persisted matches root', () => {
    expect(PERSISTED_QUERY_ROOTS.has('matches')).toBe(true);
    expect(matchKeys.detail(MATCH_ID)[0]).toBe('matches');
    expect(matchKeys.teamAll(TEAM_ID).slice(0, 3)).toEqual([...queryKeys.teamMatches(TEAM_ID)]);
    expect(
      shouldPersistQuery({
        queryKey: matchKeys.detail(MATCH_ID),
        state: { status: 'success', data: memberView() },
      } as unknown as Parameters<typeof shouldPersistQuery>[0]),
    ).toBe(true);
  });
});
