import { act, fireEvent, screen, waitFor } from '@testing-library/react-native/pure';
import { http, HttpResponse } from 'msw';
import { type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NO_ENTITLEMENTS } from '../../../packages/contracts/src/billing';
import MatchesTab from '../app/(tabs)/maclar/index';
import LineupScreen from '../app/takim/[id]/mac/[matchId]/dizilis';
import EditMatchScreen from '../app/takim/[id]/mac/[matchId]/duzenle';
import MatchDetailScreen from '../app/takim/[id]/mac/[matchId]/index';
import PaymentsScreen from '../app/takim/[id]/mac/[matchId]/odemeler';
import TeamMatchesScreen from '../app/takim/[id]/mac/index';
import CreateMatchScreen from '../app/takim/[id]/mac/yeni';
import { session } from '../src/api/instance';
import {
  type MeResponse,
  type TeamDetail,
  type TeamRole,
  type UserPublic,
} from '../src/api/contracts';
import {
  type MatchGuestView,
  type MatchMemberView,
  type MatchParticipant,
  type MatchSummary,
} from '../src/matches/contracts';
import { matchKeys } from '../src/matches/queries';
import { queryKeys } from '../src/query/keys';
import { issueTokens, problem } from './support/api';
import { deferred } from './support/deferred';
import { __setSearchParams, routerCalls } from './support/expo-router';
import { appResources, createTestI18n } from './support/i18n';
import { apiUrl, mswServer } from './support/msw';
import { createTestQueryClient, renderWithProviders } from './support/render';

// The screens use the app's API client; here it is wired to the MSW base URL.
vi.mock('../src/api/instance', async () => {
  const { createTestApi } = await import('./support/api');
  const { api, session: testSession } = createTestApi();
  return { api, session: testSession };
});

const TEAM_ID = '0192a0b0-0000-7000-8000-000000000001';
const MATCH_ID = '0192a0b0-0000-7000-8000-0000000000a1';
const VENUE_ID = '0192a0b0-0000-7000-8000-0000000000e1';
const DISTRICT_ID = '0192a0b0-0000-7000-8000-0000000000d1';
const ME_ID = '0192a0b0-0000-7000-8000-0000000000f1';
const ZEYNEP_ID = '0192a0b0-0000-7000-8000-0000000000f2';
const MERT_ID = '0192a0b0-0000-7000-8000-0000000000f3';
const HOUR = 60 * 60 * 1000;

/** Copy of the error catalog (`errors.json`) as the screens read it; the real file ships separately. */
const ERROR_CATALOG = {
  match_full: 'Maç dolu.',
  match_not_open: 'Bu maç yanıtlara kapalı.',
  forbidden: 'Bu işlem için yetkin yok.',
  lineup_side_full: 'Bu tarafta yer kalmadı.',
  already_voted: 'Bu maç için oyunu zaten verdin.',
  network_error: 'Bağlantı kurulamadı. İnternet bağlantını kontrol edip tekrar dene.',
  unknown: 'Bir sorun oluştu. Biraz sonra tekrar dene.',
};

function i18nWithCatalog() {
  const resources = appResources();
  return createTestI18n('tr', { ...resources, tr: { ...resources.tr, errors: ERROR_CATALOG } });
}

function render(ui: ReactElement, queryClient = createTestQueryClient()) {
  return renderWithProviders(ui, { i18n: i18nWithCatalog(), queryClient });
}

function user(id: string, displayName: string, position: UserPublic['position']): UserPublic {
  return { id, displayName, avatarUrl: null, position, level: 'regular' };
}

const ALI = user(ME_ID, 'Ali Kaptan', 'GK');
const ZEYNEP = user(ZEYNEP_ID, 'Zeynep', 'MID');
const MERT = user(MERT_ID, 'Mert', 'FWD');

function team(myRole: TeamRole = 'captain', overrides: Partial<TeamDetail> = {}): TeamDetail {
  return {
    id: TEAM_ID,
    name: 'Yıldızlar FK',
    slug: 'yildizlar-fk',
    badgeUrl: null,
    districtId: DISTRICT_ID,
    myRole,
    memberCount: 3,
    isProLocked: false,
    createdAt: '2026-09-01T10:00:00.000Z',
    members: [
      { user: ALI, role: myRole, joinedAt: '2026-09-01T10:00:00.000Z' },
      { user: ZEYNEP, role: 'player', joinedAt: '2026-09-01T10:00:00.000Z' },
      { user: MERT, role: 'player', joinedAt: '2026-09-01T10:00:00.000Z' },
    ],
    ...overrides,
  };
}

function participant(
  who: UserPublic,
  status: MatchParticipant['status'],
  overrides: Partial<MatchParticipant> = {},
): MatchParticipant {
  return { user: who, status, side: null, paid: false, ...overrides };
}

const inFuture = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();

function match(overrides: Partial<MatchMemberView> = {}): MatchMemberView {
  return {
    projection: 'member',
    id: MATCH_ID,
    teamId: TEAM_ID,
    team: { id: TEAM_ID, name: 'Yıldızlar FK' },
    venue: null,
    venueText: 'Moda Sahası',
    startsAt: inFuture(48),
    format: '7v7',
    feeTotalMinor: 150_000,
    slots: 14,
    status: 'open',
    lockedAt: null,
    mvpVoteClosesAt: null,
    counts: { in: 2, maybe: 0, out: 0, waitlist: 0 },
    myRsvp: null,
    createdAt: '2026-09-20T10:00:00.000Z',
    sharePerPlayerMinor: 75_000,
    myShareMinor: null,
    mvp: null,
    participants: [participant(ZEYNEP, 'in'), participant(MERT, 'in')],
    ...overrides,
  };
}

function me(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    ...ALI,
    email: 'ali@example.com',
    emailVerified: true,
    role: 'user',
    districtId: DISTRICT_ID,
    providers: { password: true, apple: false, google: false },
    createdAt: '2026-09-01T10:00:00.000Z',
    entitlements: NO_ENTITLEMENTS,
    ...overrides,
  };
}

function serveMe() {
  mswServer.use(http.get(apiUrl('/api/v1/me'), () => HttpResponse.json(me())));
}

function serveTeam(detail: TeamDetail = team()) {
  mswServer.use(http.get(apiUrl(`/api/v1/teams/${TEAM_ID}`), () => HttpResponse.json(detail)));
}

/**
 * `GET matches/:id` answering the current server state. With `offlineAfterFirstRead`, later
 * reads fail like a lost connection, so what the cache shows after a write comes from the write
 * handling alone.
 */
function serveMatch(
  initial: MatchMemberView | MatchGuestView,
  { offlineAfterFirstRead = false } = {},
) {
  let current = initial;
  let reads = 0;
  mswServer.use(
    http.get(apiUrl(`/api/v1/matches/${MATCH_ID}`), () => {
      reads += 1;
      if (offlineAfterFirstRead && reads > 1) {
        return HttpResponse.error();
      }
      return HttpResponse.json(current);
    }),
  );
  return {
    set: (next: MatchMemberView | MatchGuestView) => {
      current = next;
    },
    reads: () => reads,
  };
}

function openMatch() {
  __setSearchParams({ id: TEAM_ID, matchId: MATCH_ID });
}

async function settle(ms = 50): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function lastRouterCall() {
  return routerCalls().at(-1);
}

/** The confirm button of an in-place confirmation carries the same name as the first press. */
function lastButton(name: string) {
  const buttons = screen.getAllByRole('button', { name });
  const last = buttons.at(-1);
  if (last === undefined) {
    throw new Error(`no button ${name}`);
  }
  return last;
}

function radio(name: string) {
  return screen.getByRole('radio', { name });
}

beforeEach(async () => {
  await session.establish(issueTokens());
});

describe('Maçlar tab', () => {
  it('opens a match and the full list of a team', async () => {
    const summary: MatchSummary = { ...match(), myRsvp: 'in' };
    const {
      projection: _p,
      team: _t,
      sharePerPlayerMinor: _s,
      myShareMinor: _m,
      mvp: _v,
      participants: _r,
      ...row
    } = summary as MatchMemberView;
    mswServer.use(
      http.get(apiUrl('/api/v1/teams'), () =>
        HttpResponse.json({ items: [team()], nextCursor: null }),
      ),
      http.get(apiUrl(`/api/v1/teams/${TEAM_ID}/matches`), () =>
        HttpResponse.json({ items: [row], nextCursor: null }),
      ),
    );
    await render(<MatchesTab />);
    await fireEvent.press(await screen.findByTestId(`match-${MATCH_ID}`));
    expect(lastRouterCall()).toEqual({ method: 'push', href: `/takim/${TEAM_ID}/mac/${MATCH_ID}` });
    await fireEvent.press(screen.getByRole('button', { name: 'Yıldızlar FK maçları' }));
    expect(lastRouterCall()).toEqual({ method: 'push', href: `/takim/${TEAM_ID}/mac` });
  });
});

describe('team matches', () => {
  function serveList(items: unknown[] = []) {
    mswServer.use(
      http.get(apiUrl(`/api/v1/teams/${TEAM_ID}/matches`), () =>
        HttpResponse.json({ items, nextCursor: null }),
      ),
    );
  }

  it('offers "create a match" to the captain', async () => {
    serveTeam(team('captain'));
    serveList();
    __setSearchParams({ id: TEAM_ID });
    await render(<TeamMatchesScreen />);
    expect(await screen.findByText('İlk maçı sen kur: saha, gün ve saat yeter.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Maç kur' }));
    expect(lastRouterCall()).toEqual({ method: 'push', href: `/takim/${TEAM_ID}/mac/yeni` });
  });

  it('offers nothing to create for a player, and explains a read-only team to staff', async () => {
    serveTeam(team('player'));
    serveList();
    __setSearchParams({ id: TEAM_ID });
    await render(<TeamMatchesScreen />);
    expect(await screen.findByText('Kaptanın maç kurduğunda burada görürsün.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Maç kur' })).toBeNull();
    await act(async () => {
      await screen.unmount();
    });
    serveTeam(team('co_captain', { isProLocked: true }));
    await render(<TeamMatchesScreen />);
    expect(await screen.findByTestId('match-create-locked')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Maç kur' })).toBeNull();
  });
});

describe('create match', () => {
  function servePost(respond: () => Response) {
    const bodies: unknown[] = [];
    mswServer.use(
      http.post(apiUrl(`/api/v1/teams/${TEAM_ID}/matches`), async ({ request }) => {
        bodies.push(await request.json());
        return respond();
      }),
    );
    return bodies;
  }

  async function fillDayAndFee() {
    await fireEvent.changeText(screen.getByLabelText('Gün'), '25.10.2099');
    await fireEvent.changeText(screen.getByLabelText('Saat'), '21:00');
    await fireEvent.changeText(screen.getByLabelText('Toplam saha ücreti (TL)'), '1.500');
  }

  it('checks every field before sending anything', async () => {
    serveTeam();
    const bodies = servePost(() => HttpResponse.json({}, { status: 500 }));
    __setSearchParams({ id: TEAM_ID });
    await render(<CreateMatchScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Kaydet ve yayınla' }));
    expect(screen.getByText('Rehberden bir saha seç ya da sahayı kendin yaz.')).toBeTruthy();
    expect(screen.getByText('Günü GG.AA.YYYY biçiminde yaz, örneğin 25.10.2026.')).toBeTruthy();
    expect(screen.getByText('Ücreti TL olarak yaz, örneğin 1.500 ya da 1500,50.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Gün'), '01.01.2001');
    await fireEvent.changeText(screen.getByLabelText('Saat'), '21:00');
    await fireEvent.press(screen.getByRole('button', { name: 'Kaydet ve yayınla' }));
    expect(screen.getByText('Maç ileri bir tarihte olmalı.')).toBeTruthy();
    await settle();
    expect(bodies).toEqual([]);
  });

  it('publishes a free-text match with the fee in kuruş and opens it', async () => {
    serveTeam();
    const created = match();
    const bodies = servePost(() => HttpResponse.json(created, { status: 201 }));
    const queryClient = createTestQueryClient();
    __setSearchParams({ id: TEAM_ID });
    await render(<CreateMatchScreen />, queryClient);
    await fireEvent.press(await screen.findByRole('radio', { name: 'Kendim yazayım' }));
    await fireEvent.changeText(screen.getByLabelText('Saha adı ya da adresi'), '  Moda Sahası ');
    await fillDayAndFee();
    await fireEvent.press(radio('6v6'));
    expect(screen.getByLabelText('Kontenjan').props.value).toBe('12');
    await fireEvent.press(screen.getByRole('button', { name: 'Kaydet ve yayınla' }));
    await waitFor(() =>
      expect(lastRouterCall()).toEqual({
        method: 'replace',
        href: `/takim/${TEAM_ID}/mac/${MATCH_ID}`,
      }),
    );
    expect(bodies).toEqual([
      {
        venueText: 'Moda Sahası',
        startsAt: new Date(2099, 9, 25, 21, 0).toISOString(),
        format: '6v6',
        feeTotalMinor: 150_000,
        slots: 12,
        status: 'open',
      },
    ]);
    expect(queryClient.getQueryData(matchKeys.detail(MATCH_ID))).toEqual(created);
  });

  it('saves a draft at a pitch picked from the guide', async () => {
    serveTeam();
    const searches: string[] = [];
    mswServer.use(
      http.get(apiUrl('/api/v1/venues'), ({ request }) => {
        searches.push(new URL(request.url).search);
        return HttpResponse.json({
          items: [
            {
              id: VENUE_ID,
              name: 'Moda Halı Saha',
              slug: 'moda-hali-saha',
              districtId: DISTRICT_ID,
              location: { lat: 40.98, lng: 29.03 },
              indoor: false,
              priceMinMinor: null,
              priceMaxMinor: null,
              verified: true,
              isSample: false,
              rating: { average: null, count: 0 },
            },
          ],
          nextCursor: null,
        });
      }),
    );
    const bodies = servePost(() => HttpResponse.json(match({ status: 'draft' }), { status: 201 }));
    __setSearchParams({ id: TEAM_ID });
    await render(<CreateMatchScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Saha ara'), 'm');
    await fireEvent.press(screen.getByRole('button', { name: 'Ara' }));
    expect(screen.getByText('Aramak için en az 2 karakter yaz.')).toBeTruthy();
    await settle();
    expect(searches).toEqual([]);
    await fireEvent.changeText(screen.getByLabelText('Saha ara'), 'moda');
    await fireEvent.press(screen.getByRole('button', { name: 'Ara' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Moda Halı Saha' }));
    expect(screen.getByText('Seçilen saha: Moda Halı Saha')).toBeTruthy();
    await fillDayAndFee();
    await fireEvent.press(screen.getByRole('button', { name: 'Taslak olarak kaydet' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(searches).toEqual(['?q=moda&limit=10']);
    expect(bodies[0]).toMatchObject({
      venueId: VENUE_ID,
      status: 'draft',
      slots: 14,
      format: '7v7',
    });
    expect(bodies[0]).not.toHaveProperty('venueText');
  });

  it('shows the catalog copy and reference when the server refuses, and stays', async () => {
    serveTeam();
    servePost(() => problem(403, 'forbidden', 'req-match-1'));
    __setSearchParams({ id: TEAM_ID });
    await render(<CreateMatchScreen />);
    await fireEvent.press(await screen.findByRole('radio', { name: 'Kendim yazayım' }));
    await fireEvent.changeText(screen.getByLabelText('Saha adı ya da adresi'), 'Moda');
    await fillDayAndFee();
    await fireEvent.press(screen.getByRole('button', { name: 'Kaydet ve yayınla' }));
    expect(await screen.findByText('Bu işlem için yetkin yok.')).toBeTruthy();
    expect(screen.getByText('Hata kodu: req-match-1')).toBeTruthy();
    expect(routerCalls()).toEqual([]);
  });

  it('tells a player that only staff create matches', async () => {
    serveTeam(team('player'));
    __setSearchParams({ id: TEAM_ID });
    await render(<CreateMatchScreen />);
    expect(
      await screen.findByText('Maçı yalnızca kaptan ve yardımcı kaptan kurabilir.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Kaydet ve yayınla' })).toBeNull();
  });
});

describe('match detail states', () => {
  it('shows a skeleton first, then the match', async () => {
    serveMe();
    serveTeam(team('player'));
    const gate = deferred();
    mswServer.use(
      http.get(apiUrl(`/api/v1/matches/${MATCH_ID}`), async () => {
        await gate.promise;
        return HttpResponse.json(match());
      }),
    );
    openMatch();
    await render(<MatchDetailScreen />);
    expect(screen.getByTestId('match-loading')).toBeTruthy();
    gate.resolve();
    expect(await screen.findByLabelText('Saha: Moda Sahası')).toBeTruthy();
    expect(screen.getByLabelText('Toplam ücret: ₺1.500')).toBeTruthy();
    expect(screen.getByLabelText('Gelen: 2/14')).toBeTruthy();
  });

  it('shows the error with its reference and loads again on retry', async () => {
    serveMe();
    serveTeam(team('player'));
    let fail = true;
    mswServer.use(
      http.get(apiUrl(`/api/v1/matches/${MATCH_ID}`), () =>
        fail ? problem(500, 'internal', 'req-match-9') : HttpResponse.json(match()),
      ),
    );
    openMatch();
    await render(<MatchDetailScreen />);
    expect(await screen.findByText('Hata kodu: req-match-9')).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(await screen.findByLabelText('Saha: Moda Sahası')).toBeTruthy();
  });

  it('says a missing match is gone, without a retry', async () => {
    serveMe();
    mswServer.use(http.get(apiUrl(`/api/v1/matches/${MATCH_ID}`), () => problem(404, 'not_found')));
    openMatch();
    await render(<MatchDetailScreen />);
    expect(await screen.findByRole('header', { name: 'Maç bulunamadı' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tekrar dene' })).toBeNull();
  });

  it('shows the saved match with a notice when the network is down', async () => {
    serveMe();
    serveTeam(team('player'));
    mswServer.use(http.get(apiUrl(`/api/v1/matches/${MATCH_ID}`), () => HttpResponse.error()));
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(matchKeys.detail(MATCH_ID), match());
    openMatch();
    await render(<MatchDetailScreen />, queryClient);
    expect(await screen.findByTestId('cached-notice')).toBeTruthy();
    expect(screen.getByText('Zeynep')).toBeTruthy();
  });

  it('shows a guest the guest projection: no fee total, no payments, no staff controls', async () => {
    serveMe();
    const guest: MatchGuestView = {
      projection: 'guest',
      id: MATCH_ID,
      team: { id: TEAM_ID, name: 'Yıldızlar FK' },
      venue: null,
      venueText: 'Moda Sahası',
      startsAt: inFuture(48),
      format: '7v7',
      status: 'locked',
      mvpVoteClosesAt: null,
      sharePerPlayerMinor: 50_000,
      myShareMinor: 50_000,
      myRsvp: { matchId: MATCH_ID, status: 'in', side: 'B', updatedAt: '2026-09-20T10:00:00.000Z' },
      mvp: null,
      participants: [
        {
          user: { id: ME_ID, displayName: 'Ali Kaptan', avatarUrl: null, position: 'GK' },
          status: 'in',
          side: 'B',
        },
      ],
    };
    serveMatch(guest);
    const teamReads: string[] = [];
    mswServer.use(
      http.get(apiUrl(`/api/v1/teams/${TEAM_ID}`), () => {
        teamReads.push('team');
        return problem(404, 'not_found');
      }),
    );
    openMatch();
    await render(<MatchDetailScreen />);
    expect(await screen.findByLabelText('Senin payın: ₺500')).toBeTruthy();
    expect(screen.queryByTestId('match-fee')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ödemeler' })).toBeNull();
    expect(screen.queryByRole('header', { name: 'Maçı yönet' })).toBeNull();
    await settle();
    expect(teamReads).toEqual([]);
  });
});

describe('RSVP', () => {
  it('shows the choice at once and then the server answer (waitlist)', async () => {
    serveMe();
    serveTeam(team('player'));
    serveMatch(match({ slots: 2 }), { offlineAfterFirstRead: true });
    const gate = deferred();
    const bodies: unknown[] = [];
    mswServer.use(
      http.put(apiUrl(`/api/v1/matches/${MATCH_ID}/rsvp`), async ({ request }) => {
        bodies.push(await request.json());
        await gate.promise;
        return HttpResponse.json({
          matchId: MATCH_ID,
          status: 'waitlist',
          side: null,
          updatedAt: new Date().toISOString(),
        });
      }),
    );
    openMatch();
    await render(<MatchDetailScreen />);
    await fireEvent.press(await screen.findByRole('radio', { name: 'Geliyorum' }));
    // Optimistic: the slots are full, so the waitlist is shown before the server answers.
    expect(await screen.findByText('Yanıtın: Yedek listedeyim')).toBeTruthy();
    expect(radio('Belki').props.accessibilityState).toEqual({ checked: false, disabled: true });
    await waitFor(() => expect(bodies).toEqual([{ status: 'in' }]));
    gate.resolve();
    expect(await screen.findByTestId('rsvp-waitlist')).toBeTruthy();
    await waitFor(() =>
      expect(radio('Belki').props.accessibilityState).toEqual({ checked: false, disabled: false }),
    );
  });

  it('puts the previous match back exactly when the server refuses', async () => {
    serveMe();
    serveTeam(team('player'));
    const before = match({ myRsvp: 'maybe', counts: { in: 2, maybe: 1, out: 0, waitlist: 0 } });
    serveMatch(before, { offlineAfterFirstRead: true });
    const gate = deferred();
    mswServer.use(
      http.put(apiUrl(`/api/v1/matches/${MATCH_ID}/rsvp`), async () => {
        await gate.promise;
        return problem(409, 'match_not_open', 'req-rsvp-1');
      }),
    );
    const queryClient = createTestQueryClient();
    openMatch();
    await render(<MatchDetailScreen />, queryClient);
    await fireEvent.press(await screen.findByRole('radio', { name: 'Geliyorum' }));
    expect(await screen.findByText('Yanıtın: Geliyorum')).toBeTruthy();
    expect(queryClient.getQueryData<MatchMemberView>(matchKeys.detail(MATCH_ID))?.counts).toEqual({
      in: 3,
      maybe: 0,
      out: 0,
      waitlist: 0,
    });
    gate.resolve();
    expect(await screen.findByText('Bu maç yanıtlara kapalı.')).toBeTruthy();
    expect(screen.getByText('Yanıtın: Belki')).toBeTruthy();
    expect(screen.getByText('Hata kodu: req-rsvp-1')).toBeTruthy();
    expect(queryClient.getQueryData(matchKeys.detail(MATCH_ID))).toEqual(before);
  });

  it('sends nothing when the choice would not change the answer', async () => {
    serveMe();
    serveTeam(team('player'));
    serveMatch(match({ myRsvp: 'in' }));
    const bodies: unknown[] = [];
    mswServer.use(
      http.put(apiUrl(`/api/v1/matches/${MATCH_ID}/rsvp`), async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({});
      }),
    );
    openMatch();
    await render(<MatchDetailScreen />);
    await fireEvent.press(await screen.findByRole('radio', { name: 'Geliyorum' }));
    await settle();
    expect(bodies).toEqual([]);
  });

  it('offers only "out" in a locked match and nothing once it started', async () => {
    serveMe();
    serveTeam(team('player'));
    const server = serveMatch(match({ status: 'locked', myRsvp: 'in' }));
    openMatch();
    await render(<MatchDetailScreen />);
    expect(await screen.findByTestId('rsvp-locked')).toBeTruthy();
    expect(radio('Gelmiyorum').props.accessibilityState).toEqual({
      checked: false,
      disabled: false,
    });
    expect(radio('Belki').props.accessibilityState).toEqual({ checked: false, disabled: true });
    expect(radio('Geliyorum').props.accessibilityState).toEqual({ checked: true, disabled: true });
    await act(async () => {
      await screen.unmount();
    });
    server.set(match({ status: 'open', startsAt: inFuture(-1) }));
    await render(<MatchDetailScreen />);
    expect(await screen.findByText('Maç başladı, yanıt artık değişmez.')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Geliyorum' })).toBeNull();
  });
});

describe('staff controls', () => {
  it('are not offered to a player', async () => {
    serveMe();
    serveTeam(team('player'));
    serveMatch(match());
    openMatch();
    await render(<MatchDetailScreen />);
    expect(await screen.findByLabelText('Saha: Moda Sahası')).toBeTruthy();
    await settle();
    expect(screen.queryByRole('header', { name: 'Maçı yönet' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Kadroyu kilitle' })).toBeNull();
  });

  it('lock the squad only after the server answers', async () => {
    serveMe();
    serveTeam(team('co_captain'));
    serveMatch(match(), { offlineAfterFirstRead: true });
    const gate = deferred();
    const bodies: unknown[] = [];
    mswServer.use(
      http.patch(apiUrl(`/api/v1/matches/${MATCH_ID}`), async ({ request }) => {
        bodies.push(await request.json());
        await gate.promise;
        return HttpResponse.json(match({ status: 'locked', lockedAt: new Date().toISOString() }));
      }),
    );
    openMatch();
    await render(<MatchDetailScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Kadroyu kilitle' }));
    await waitFor(() => expect(bodies).toEqual([{ status: 'locked' }]));
    expect(screen.getByLabelText('Durum: Açık')).toBeTruthy();
    gate.resolve();
    expect(await screen.findByLabelText('Durum: Kilitli')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Kilidi aç' })).toBeTruthy();
  });

  it('delete a draft after confirmation and return to the team matches', async () => {
    serveMe();
    serveTeam(team('captain'));
    serveMatch(match({ status: 'draft' }));
    const deletes: string[] = [];
    mswServer.use(
      http.delete(apiUrl(`/api/v1/matches/${MATCH_ID}`), () => {
        deletes.push('delete');
        return HttpResponse.json({ outcome: 'deleted' });
      }),
    );
    const queryClient = createTestQueryClient();
    openMatch();
    await render(<MatchDetailScreen />, queryClient);
    await fireEvent.press(await screen.findByRole('button', { name: 'Taslağı sil' }));
    expect(screen.getByText('Bu taslak silinecek. Emin misin?')).toBeTruthy();
    await settle();
    expect(deletes).toEqual([]);
    await fireEvent.press(lastButton('Taslağı sil'));
    await waitFor(() =>
      expect(lastRouterCall()).toEqual({ method: 'replace', href: `/takim/${TEAM_ID}/mac` }),
    );
    expect(deletes).toEqual(['delete']);
    expect(queryClient.getQueryData(matchKeys.detail(MATCH_ID))).toBeUndefined();
  });

  it('mark a started match played only after confirmation', async () => {
    serveMe();
    serveTeam(team('captain'));
    serveMatch(match({ status: 'locked', startsAt: inFuture(-2), lockedAt: inFuture(-30) }));
    const bodies: unknown[] = [];
    mswServer.use(
      http.patch(apiUrl(`/api/v1/matches/${MATCH_ID}`), async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(match({ status: 'played', mvpVoteClosesAt: inFuture(24) }));
      }),
    );
    openMatch();
    await render(<MatchDetailScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Oynandı olarak işaretle' }));
    await settle();
    expect(bodies).toEqual([]);
    await fireEvent.press(lastButton('Oynandı olarak işaretle'));
    await waitFor(() => expect(bodies).toEqual([{ status: 'played' }]));
  });
});

describe('edit match', () => {
  it('keeps frozen terms read-only and sends only the changed start', async () => {
    serveMe();
    serveTeam(team('captain'));
    const stored = match({ status: 'locked', lockedAt: inFuture(-1) });
    serveMatch(stored);
    const bodies: unknown[] = [];
    mswServer.use(
      http.patch(apiUrl(`/api/v1/matches/${MATCH_ID}`), async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(stored);
      }),
    );
    openMatch();
    await render(<EditMatchScreen />);
    expect(await screen.findByTestId('terms-frozen')).toBeTruthy();
    expect(screen.getByLabelText('Toplam saha ücreti (TL)').props.editable).toBe(false);
    expect(radio('8v8').props.accessibilityState).toEqual({ checked: false, disabled: true });
    expect(screen.getByLabelText('Toplam saha ücreti (TL)').props.value).toBe('1500');
    await fireEvent.changeText(screen.getByLabelText('Saat'), '22:30');
    await fireEvent.press(screen.getByRole('button', { name: 'Değişiklikleri kaydet' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    const start = new Date(stored.startsAt);
    start.setHours(22, 30, 0, 0);
    expect(bodies).toEqual([{ startsAt: start.toISOString() }]);
    await waitFor(() =>
      expect(lastRouterCall()).toEqual({
        method: 'replace',
        href: `/takim/${TEAM_ID}/mac/${MATCH_ID}`,
      }),
    );
  });
});

describe('lineup', () => {
  it('is read-only for a player', async () => {
    serveMe();
    serveTeam(team('player'));
    serveMatch(
      match({
        participants: [
          participant(ZEYNEP, 'in', { side: 'A' }),
          participant(MERT, 'in', { side: 'B' }),
          participant(ALI, 'in'),
        ],
      }),
    );
    openMatch();
    await render(<LineupScreen />);
    expect(await screen.findByText('Dizilişi kaptan ve yardımcı kaptan belirler.')).toBeTruthy();
    expect(screen.queryAllByRole('radio')).toEqual([]);
    expect(screen.getByRole('header', { name: 'A takımı: 1/7' })).toBeTruthy();
    expect(screen.getByLabelText('Ali Kaptan (sen), Kaleci')).toBeTruthy();
  });

  it('lets the captain assign by tapping, keeps full sides closed and saves the whole lineup', async () => {
    serveMe();
    serveTeam(team('captain'));
    serveMatch(
      match({
        slots: 2,
        participants: [
          participant(ZEYNEP, 'in'),
          participant(MERT, 'in'),
          participant(ALI, 'maybe'),
        ],
      }),
      { offlineAfterFirstRead: true },
    );
    const bodies: unknown[] = [];
    mswServer.use(
      http.put(apiUrl(`/api/v1/matches/${MATCH_ID}/lineup`), async ({ request }) => {
        const body = (await request.json()) as { sides: unknown[] };
        bodies.push(body);
        return HttpResponse.json({ matchId: MATCH_ID, sides: body.sides });
      }),
    );
    const queryClient = createTestQueryClient();
    openMatch();
    await render(<LineupScreen />, queryClient);
    await fireEvent.press(await screen.findByRole('radio', { name: 'Zeynep: A takımı' }));
    // One slot per side (ceil(2 / 2)): side A is now full for Mert.
    expect(radio('Mert: A takımı').props.accessibilityState).toEqual({
      checked: false,
      disabled: true,
    });
    await fireEvent.press(radio('Mert: B takımı'));
    expect(screen.getByText('Kaydedilmemiş değişiklik var.')).toBeTruthy();
    await settle();
    expect(bodies).toEqual([]);
    await fireEvent.press(screen.getByRole('button', { name: 'Dizilişi kaydet' }));
    await waitFor(() =>
      expect(bodies).toEqual([
        {
          sides: [
            { userId: ZEYNEP_ID, side: 'A' },
            { userId: MERT_ID, side: 'B' },
          ],
        },
      ]),
    );
    await waitFor(() => expect(screen.queryByText('Kaydedilmemiş değişiklik var.')).toBeNull());
    const cached = queryClient.getQueryData<MatchMemberView>(matchKeys.detail(MATCH_ID));
    expect(cached?.participants.map((row) => row.side)).toEqual(['A', 'B', null]);
  });

  it('suggests sides by position and shows a refused save', async () => {
    serveMe();
    serveTeam(team('captain'));
    serveMatch(
      match({
        participants: [participant(ZEYNEP, 'in'), participant(ALI, 'in'), participant(MERT, 'in')],
      }),
    );
    mswServer.use(
      http.put(apiUrl(`/api/v1/matches/${MATCH_ID}/lineup`), () =>
        problem(409, 'lineup_side_full'),
      ),
    );
    openMatch();
    await render(<LineupScreen />);
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Mevkiye göre otomatik dağıt' }),
    );
    // GK first (Ali to A), then MID (Zeynep to B), then FWD (Mert to A: fewer in total ties, alternation).
    expect(radio('Ali Kaptan (sen): A takımı').props.accessibilityState.checked).toBe(true);
    expect(radio('Zeynep: B takımı').props.accessibilityState.checked).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Dizilişi kaydet' }));
    expect(await screen.findByText('Bu tarafta yer kalmadı.')).toBeTruthy();
  });
});

describe('payments', () => {
  // 100_001 kuruş over 3 players: base share 33_333; the server says Ali's own share is 33_334.
  const locked = (order: 'rsvp' | 'reversed' = 'rsvp') => {
    const rows = [
      participant(ZEYNEP, 'in'),
      participant(MERT, 'in', { paid: true }),
      participant(ALI, 'in'),
    ];
    return match({
      status: 'locked',
      lockedAt: inFuture(-1),
      feeTotalMinor: 100_001,
      counts: { in: 3, maybe: 0, out: 0, waitlist: 0 },
      sharePerPlayerMinor: 33_333,
      myRsvp: 'in',
      myShareMinor: 33_334,
      participants: order === 'rsvp' ? rows : [...rows].reverse(),
    });
  };

  it('shows the same shares and total whatever order the participants arrive in', async () => {
    serveMe();
    serveTeam(team('player'));
    const server = serveMatch(locked('rsvp'));
    openMatch();
    await render(<PaymentsScreen />);
    const read = () => ({
      zeynep: screen.getByLabelText('Zeynep, ₺333,33, Ödemedi'),
      self: screen.getByLabelText('Ali Kaptan (sen), ₺333,34, Ödemedi'),
      collected: screen.getByLabelText('Toplanan (en az): ₺333,33'),
      uneven: screen.getByTestId('payments-uneven'),
    });
    await screen.findByLabelText('Ödeyen: 1/3');
    expect(read()).toBeTruthy();
    await act(async () => {
      await screen.unmount();
    });
    server.set(locked('reversed'));
    await render(<PaymentsScreen />, createTestQueryClient());
    await screen.findByLabelText('Ödeyen: 1/3');
    expect(read()).toBeTruthy();
  });

  it('lets the captain mark a player paid once the server confirms', async () => {
    serveMe();
    serveTeam(team('captain'));
    serveMatch(locked(), { offlineAfterFirstRead: true });
    const gate = deferred();
    const bodies: unknown[] = [];
    mswServer.use(
      http.patch(
        apiUrl(`/api/v1/matches/${MATCH_ID}/payments/${ZEYNEP_ID}`),
        async ({ request }) => {
          bodies.push(await request.json());
          await gate.promise;
          return HttpResponse.json({
            matchId: MATCH_ID,
            userId: ZEYNEP_ID,
            paid: true,
            updatedAt: new Date().toISOString(),
          });
        },
      ),
    );
    openMatch();
    await render(<PaymentsScreen />);
    expect(await screen.findByLabelText('Ödeyen: 1/3')).toBeTruthy();
    // Others show the base share; the viewer's row shows the server's exact share.
    expect(screen.getByLabelText('Zeynep, ₺333,33, Ödemedi')).toBeTruthy();
    expect(screen.getByLabelText('Ali Kaptan (sen), ₺333,34, Ödemedi')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Zeynep ödedi olarak işaretle' }));
    await waitFor(() => expect(bodies).toEqual([{ paid: true }]));
    // Pessimistic: nothing changes before the answer.
    expect(screen.getByLabelText('Zeynep, ₺333,33, Ödemedi')).toBeTruthy();
    gate.resolve();
    expect(await screen.findByLabelText('Zeynep, ₺333,33, Ödedi')).toBeTruthy();
    expect(screen.getByLabelText('Ödeyen: 2/3')).toBeTruthy();
    // The captain may mark their own share.
    expect(screen.getByRole('button', { name: 'Ali Kaptan ödedi olarak işaretle' })).toBeTruthy();
  });

  it('never offers a co-captain their own row, nor a player any row', async () => {
    serveMe();
    serveTeam(team('co_captain'));
    serveMatch(locked());
    openMatch();
    await render(<PaymentsScreen />);
    expect(await screen.findByTestId('payment-self-note')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ali Kaptan ödedi olarak işaretle' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Zeynep ödedi olarak işaretle' })).toBeTruthy();
    await act(async () => {
      await screen.unmount();
    });
    serveTeam(team('player'));
    await render(<PaymentsScreen />, createTestQueryClient());
    expect(await screen.findByLabelText('Ödeyen: 1/3')).toBeTruthy();
    await settle();
    expect(screen.queryByRole('button', { name: 'Zeynep ödedi olarak işaretle' })).toBeNull();
  });
});

describe('MVP vote', () => {
  const played = (overrides: Partial<MatchMemberView> = {}) =>
    match({
      status: 'played',
      startsAt: inFuture(-3),
      lockedAt: inFuture(-30),
      mvpVoteClosesAt: inFuture(20),
      myRsvp: 'in',
      mvp: { myVoteeId: null, winnerIds: null },
      participants: [participant(ZEYNEP, 'in'), participant(MERT, 'in'), participant(ALI, 'in')],
      ...overrides,
    });

  it('lets a confirmed player vote once, for someone else, after confirming', async () => {
    serveMe();
    serveTeam(team('player'));
    serveMatch(played(), { offlineAfterFirstRead: true });
    const bodies: unknown[] = [];
    mswServer.use(
      http.post(apiUrl(`/api/v1/matches/${MATCH_ID}/mvp-vote`), async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ matchId: MATCH_ID, voteeId: MERT_ID }, { status: 201 });
      }),
    );
    openMatch();
    await render(<MatchDetailScreen />);
    expect(await screen.findByRole('radio', { name: 'Zeynep' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Ali Kaptan' })).toBeNull();
    await fireEvent.press(radio('Mert'));
    await fireEvent.press(screen.getByRole('button', { name: 'Oyumu ver' }));
    expect(
      screen.getByText('Oyunu Mert için veriyorsun. Verilen oy sonradan değişmez.'),
    ).toBeTruthy();
    await settle();
    expect(bodies).toEqual([]);
    await fireEvent.press(screen.getByRole('button', { name: 'Oyu ver' }));
    expect(
      await screen.findByText('Oyunu Mert için verdin. Sonuç oylama bitince görünür.'),
    ).toBeTruthy();
    expect(bodies).toEqual([{ voteeId: MERT_ID }]);
  });

  it('shows the winners once the window has closed', async () => {
    serveMe();
    serveTeam(team('player'));
    serveMatch(
      played({
        mvpVoteClosesAt: inFuture(-1),
        mvp: { myVoteeId: MERT_ID, winnerIds: [ZEYNEP_ID, MERT_ID] },
      }),
    );
    openMatch();
    await render(<MatchDetailScreen />);
    expect(await screen.findByTestId('mvp-winners')).toBeTruthy();
    expect(screen.getAllByText('Zeynep').length).toBeGreaterThan(1);
    expect(screen.queryByRole('button', { name: 'Oyumu ver' })).toBeNull();
  });
});

describe('review fixes', () => {
  function guestView(overrides: Partial<MatchGuestView> = {}): MatchGuestView {
    return {
      projection: 'guest',
      id: MATCH_ID,
      team: { id: TEAM_ID, name: 'Yıldızlar FK' },
      venue: null,
      venueText: 'Moda Sahası',
      startsAt: inFuture(48),
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
      ...overrides,
    };
  }

  it('does not show a guest "in" before the server answers, so a full match never flashes a place', async () => {
    serveMe();
    const before = guestView();
    serveMatch(before, { offlineAfterFirstRead: true });
    const gate = deferred();
    mswServer.use(
      http.put(apiUrl(`/api/v1/matches/${MATCH_ID}/rsvp`), async () => {
        await gate.promise;
        return problem(409, 'match_full', 'req-full-1');
      }),
    );
    const queryClient = createTestQueryClient();
    openMatch();
    await render(<MatchDetailScreen />, queryClient);
    await fireEvent.press(await screen.findByRole('radio', { name: 'Geliyorum' }));
    await settle();
    expect(screen.getByText('Yanıtın: Gelmiyorum')).toBeTruthy();
    gate.resolve();
    expect(await screen.findByText('Maç dolu.')).toBeTruthy();
    expect(screen.getByText('Yanıtın: Gelmiyorum')).toBeTruthy();
    expect(queryClient.getQueryData(matchKeys.detail(MATCH_ID))).toEqual(before);
  });

  it('writes a guest "in" once the server confirms it', async () => {
    serveMe();
    serveMatch(guestView(), { offlineAfterFirstRead: true });
    mswServer.use(
      http.put(apiUrl(`/api/v1/matches/${MATCH_ID}/rsvp`), () =>
        HttpResponse.json({
          matchId: MATCH_ID,
          status: 'in',
          side: null,
          updatedAt: new Date().toISOString(),
        }),
      ),
    );
    openMatch();
    await render(<MatchDetailScreen />);
    await fireEvent.press(await screen.findByRole('radio', { name: 'Geliyorum' }));
    expect(await screen.findByText('Yanıtın: Geliyorum')).toBeTruthy();
  });

  it('sends a guest back to the tab, not to the team list they cannot open', async () => {
    serveMe();
    serveMatch(guestView());
    openMatch();
    await render(<MatchDetailScreen />);
    await screen.findByLabelText('Saha: Moda Sahası');
    await fireEvent.press(screen.getByRole('button', { name: 'Geri' }));
    expect(lastRouterCall()).toEqual({ method: 'replace', href: '/maclar' });
  });

  it('shows a retry instead of hiding staff controls when the team role fails to load', async () => {
    serveMe();
    serveMatch(match());
    let failTeam = true;
    mswServer.use(
      http.get(apiUrl(`/api/v1/teams/${TEAM_ID}`), () =>
        failTeam
          ? problem(503, 'service_unavailable', 'req-team-9')
          : HttpResponse.json(team('captain')),
      ),
    );
    openMatch();
    await render(<MatchDetailScreen />);
    expect(await screen.findByTestId('role-error')).toBeTruthy();
    expect(screen.getByText('Hata kodu: req-team-9')).toBeTruthy();
    failTeam = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(await screen.findByRole('button', { name: 'Kadroyu kilitle' })).toBeTruthy();
    expect(screen.queryByTestId('role-error')).toBeNull();
  });

  it('does not tell a captain they may not edit when the team role fails to load', async () => {
    serveMe();
    serveMatch(match());
    mswServer.use(http.get(apiUrl(`/api/v1/teams/${TEAM_ID}`), () => HttpResponse.error()));
    openMatch();
    await render(<EditMatchScreen />);
    expect(await screen.findByTestId('role-error')).toBeTruthy();
    expect(screen.queryByTestId('edit-match-not-allowed')).toBeNull();
  });
});

describe('cache after leaving a team', () => {
  it('keeps every match list of the team under the key the teams area removes', () => {
    expect(matchKeys.teamAll(TEAM_ID).slice(0, 3)).toEqual([...queryKeys.teamMatches(TEAM_ID)]);
  });
});
