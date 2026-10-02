import { act, fireEvent, screen, waitFor } from '@testing-library/react-native/pure';
import { http, HttpResponse } from 'msw';
import { type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TeamsTab from '../app/(tabs)/takimlar/index';
import InviteLinkScreen from '../app/mac/[code]';
import TeamInvitesScreen from '../app/takim/[id]/davet';
import TeamDetailScreen from '../app/takim/[id]/index';
import MemberScreen from '../app/takim/[id]/uye/[userId]';
import JoinTeamScreen from '../app/takim/katil';
import CreateTeamScreen from '../app/takim/yeni';
import { session } from '../src/api/instance';
import {
  type MeResponse,
  type TeamDetail,
  type TeamMember,
  type TeamRole,
  type TeamSummary,
  type UserPublic,
} from '../src/api/contracts';
import { queryKeys } from '../src/query/keys';
import { issueTokens, problem, rotatingRefreshServer } from './support/api';
import { deferred } from './support/deferred';
import { __setSearchParams, routerCalls } from './support/expo-router';
import { appResources, createTestI18n } from './support/i18n';
import { apiUrl, mswServer } from './support/msw';
import { createTestQueryClient, renderWithProviders } from './support/render';
import { __setShareFailure, __sharedContent } from './support/react-native';

// The screens use the app's API client; here it is wired to the MSW base URL.
vi.mock('../src/api/instance', async () => {
  const { createTestApi } = await import('./support/api');
  const { api, session: testSession } = createTestApi();
  return { api, session: testSession };
});

const TEAM_ID = '0192a0b0-0000-7000-8000-000000000001';
const DISTRICT_ID = '0192a0b0-0000-7000-8000-0000000000d1';
const ME_ID = '0192a0b0-0000-7000-8000-0000000000f1';
const ZEYNEP_ID = '0192a0b0-0000-7000-8000-0000000000f2';
const MERT_ID = '0192a0b0-0000-7000-8000-0000000000f3';
const INVITE_ID = '0192a0b0-0000-7000-8000-0000000000b1';
const CODE = 'Ab3_-xY9Zq0LmN4pQrS7tU';

/** Copy of the error catalog (`errors.json`) as the screens read it; the real file ships separately. */
const ERROR_CATALOG = {
  entitlement_required: 'Bu işlem için Kadro Pro gerekiyor.',
  invite_limit: 'Bu takımın etkin davet sayısı dolu. Eski bir daveti iptal et.',
  forbidden: 'Bu işlem için yetkin yok.',
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

function member(who: UserPublic, role: TeamRole): TeamMember {
  return { user: who, role, joinedAt: '2026-09-01T10:00:00.000Z' };
}

const ALI = user(ME_ID, 'Ali Kaptan', 'GK');
const ZEYNEP = user(ZEYNEP_ID, 'Zeynep', 'MID');
const MERT = user(MERT_ID, 'Mert', null);

function summary(overrides: Partial<TeamSummary> = {}): TeamSummary {
  return {
    id: TEAM_ID,
    name: 'Yıldızlar FK',
    slug: 'yildizlar-fk',
    badgeUrl: null,
    districtId: DISTRICT_ID,
    myRole: 'captain',
    memberCount: 3,
    isProLocked: false,
    createdAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

/** Roster seen by Ali; `myRole` is Ali's role, the others keep theirs unless given. */
function detail(
  myRole: TeamRole = 'captain',
  overrides: Partial<TeamDetail> = {},
  roles: { zeynep?: TeamRole; mert?: TeamRole } = {},
): TeamDetail {
  const members = [
    member(MERT, roles.mert ?? 'player'),
    member(ZEYNEP, roles.zeynep ?? (myRole === 'captain' ? 'co_captain' : 'captain')),
    member(ALI, myRole),
  ];
  return { ...summary({ myRole }), members, ...overrides };
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
    ...overrides,
  };
}

function serveMe(overrides: Partial<MeResponse> = {}) {
  mswServer.use(http.get(apiUrl('/api/v1/me'), () => HttpResponse.json(me(overrides))));
}

/**
 * `GET teams/:id` answering the current server state; returns a setter for it. With
 * `offlineAfterFirstRead`, every later read fails like a lost connection, so what the cache shows
 * after a write comes from the write handling alone and not from a refetch.
 */
function serveTeam(initial: TeamDetail, { offlineAfterFirstRead = false } = {}) {
  let current = initial;
  let reads = 0;
  mswServer.use(
    http.get(apiUrl(`/api/v1/teams/${TEAM_ID}`), () => {
      reads += 1;
      if (offlineAfterFirstRead && reads > 1) {
        return HttpResponse.error();
      }
      return HttpResponse.json(current);
    }),
  );
  return {
    set: (next: TeamDetail) => {
      current = next;
    },
    reads: () => reads,
  };
}

/**
 * Lets pending work run (query effects, fetches through the client, MSW handlers) before a test
 * asserts that something did not happen; an assertion right after a press would pass even if a
 * request were about to go out.
 */
async function settle(ms = 50): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function lastRouterCall() {
  return routerCalls().at(-1);
}

beforeEach(async () => {
  await session.establish(issueTokens());
});

describe('Takımlar tab', () => {
  it('opens a team, the create screen and the join screen', async () => {
    mswServer.use(
      http.get(apiUrl('/api/v1/teams'), () =>
        HttpResponse.json({ items: [summary({ memberCount: 9 })], nextCursor: null }),
      ),
    );
    await render(<TeamsTab />);
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Yıldızlar FK, Kaptan · 9 oyuncu' }),
    );
    expect(lastRouterCall()).toEqual({ method: 'push', href: `/takim/${TEAM_ID}` });
    await fireEvent.press(screen.getByRole('button', { name: 'Takım kur' }));
    expect(lastRouterCall()).toEqual({ method: 'push', href: '/takim/yeni' });
    await fireEvent.press(screen.getByRole('button', { name: 'Kodla katıl' }));
    expect(lastRouterCall()).toEqual({ method: 'push', href: '/takim/katil' });
  });

  it('marks a read-only team in its row', async () => {
    mswServer.use(
      http.get(apiUrl('/api/v1/teams'), () =>
        HttpResponse.json({ items: [summary({ isProLocked: true })], nextCursor: null }),
      ),
    );
    await render(<TeamsTab />);
    expect(
      await screen.findByRole('button', { name: 'Yıldızlar FK, Kaptan · 3 oyuncu, Salt okunur' }),
    ).toBeTruthy();
  });
});

describe('create team', () => {
  function servePost(respond: (body: unknown) => Response) {
    const bodies: unknown[] = [];
    mswServer.use(
      http.post(apiUrl('/api/v1/teams'), async ({ request }) => {
        const body: unknown = await request.json();
        bodies.push(body);
        return respond(body);
      }),
    );
    return bodies;
  }

  it('checks the name before sending anything', async () => {
    serveMe();
    const bodies = servePost(() => HttpResponse.json({}, { status: 500 }));
    await render(<CreateTeamScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Takım adı'), ' A ');
    await fireEvent.press(screen.getByRole('button', { name: 'Takımı kur' }));
    expect(screen.getByText('Takım adı en az 2 karakter olmalı.')).toBeTruthy();
    await settle();
    expect(bodies).toEqual([]);
    // A valid name goes out as the one and only request.
    await fireEvent.changeText(screen.getByLabelText('Takım adı'), 'Yıldızlar FK');
    await fireEvent.press(screen.getByRole('button', { name: 'Takımı kur' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies).toEqual([{ name: 'Yıldızlar FK', districtId: DISTRICT_ID }]);
  });

  it('creates the team in the profile district and opens it', async () => {
    serveMe();
    const created = detail('captain', { members: [member(ALI, 'captain')], memberCount: 1 });
    const bodies = servePost(() => HttpResponse.json(created, { status: 201 }));
    const queryClient = createTestQueryClient();
    await render(<CreateTeamScreen />, queryClient);
    await fireEvent.changeText(await screen.findByLabelText('Takım adı'), '  Yıldızlar FK ');
    await fireEvent.press(screen.getByRole('button', { name: 'Takımı kur' }));
    await waitFor(() =>
      expect(lastRouterCall()).toEqual({ method: 'replace', href: `/takim/${TEAM_ID}` }),
    );
    expect(bodies).toEqual([{ name: 'Yıldızlar FK', districtId: DISTRICT_ID }]);
    expect(queryClient.getQueryData(queryKeys.teamDetail(TEAM_ID))).toEqual(created);
  });

  it('asks for a district in the profile when none is set', async () => {
    serveMe({ districtId: null });
    await render(<CreateTeamScreen />);
    expect(
      await screen.findByText('Takım kurmak için önce profilinde bölgeni seçmelisin.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Takımı kur' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Profile git' }));
    expect(lastRouterCall()).toEqual({ method: 'push', href: '/profil' });
  });

  it('shows the catalog copy when the server refuses, and stays', async () => {
    serveMe({ emailVerified: false });
    servePost(() => problem(403, 'entitlement_required', 'req-team-1'));
    await render(<CreateTeamScreen />);
    expect(await screen.findByTestId('create-team-unverified')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Takım adı'), 'İkinci Takım');
    await fireEvent.press(screen.getByRole('button', { name: 'Takımı kur' }));
    expect(await screen.findByText('Bu işlem için Kadro Pro gerekiyor.')).toBeTruthy();
    expect(screen.getByText('Hata kodu: req-team-1')).toBeTruthy();
    expect(routerCalls()).toEqual([]);
  });
});

describe('join with a code', () => {
  function serveInvite(options: { preview?: () => Response; accept?: () => Response } = {}) {
    const calls: string[] = [];
    mswServer.use(
      http.get(apiUrl(`/api/v1/invites/${CODE}`), () => {
        calls.push('preview');
        return (
          options.preview?.() ??
          HttpResponse.json({
            team: { name: 'Yıldızlar FK', badgeUrl: null, districtId: DISTRICT_ID, memberCount: 7 },
          })
        );
      }),
      http.post(apiUrl(`/api/v1/invites/${CODE}/accept`), () => {
        calls.push('accept');
        return options.accept?.() ?? HttpResponse.json({ team: summary({ myRole: 'player' }) });
      }),
    );
    serveMe();
    return calls;
  }

  it('rejects input without an invite code and sends nothing', async () => {
    const calls = serveInvite();
    await render(<JoinTeamScreen />);
    await fireEvent.changeText(screen.getByLabelText('Davet bağlantısı ya da kodu'), 'merhaba');
    await fireEvent.press(screen.getByRole('button', { name: 'Daveti göster' }));
    expect(
      screen.getByText(
        'Bu bir davet bağlantısı ya da davet kodu değil. Bağlantının tamamını yapıştır.',
      ),
    ).toBeTruthy();
    await settle();
    expect(calls).toEqual([]);
    // A real code afterwards is previewed once: nothing else was sent for the bad input.
    await fireEvent.changeText(screen.getByLabelText('Davet bağlantısı ya da kodu'), CODE);
    await fireEvent.press(screen.getByRole('button', { name: 'Daveti göster' }));
    expect(await screen.findByText('7 oyuncu')).toBeTruthy();
    expect(calls).toEqual(['preview']);
  });

  it('previews a pasted link, joins and opens the team', async () => {
    const calls = serveInvite();
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.teams(), { pages: [], pageParams: [undefined] });
    await render(<JoinTeamScreen />, queryClient);
    await fireEvent.changeText(
      screen.getByLabelText('Davet bağlantısı ya da kodu'),
      `Takıma katıl: https://kadro.app/mac/${CODE}`,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Daveti göster' }));
    expect(await screen.findByText('Yıldızlar FK')).toBeTruthy();
    expect(screen.getByText('7 oyuncu')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Takıma katıl' }));
    await waitFor(() =>
      expect(lastRouterCall()).toEqual({ method: 'replace', href: `/takim/${TEAM_ID}` }),
    );
    expect(calls).toEqual(['preview', 'accept']);
    expect(queryClient.getQueryState(queryKeys.teams())?.isInvalidated).toBe(true);
  });

  it('treats an unknown, expired or used-up code as final, without retry', async () => {
    serveInvite({ preview: () => problem(404, 'not_found') });
    __setSearchParams({ code: CODE });
    await render(<InviteLinkScreen />);
    expect(await screen.findByRole('header', { name: 'Davet geçersiz' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tekrar dene' })).toBeNull();
  });

  it('tells an existing member and offers the team list', async () => {
    serveInvite({ accept: () => problem(409, 'already_participant') });
    __setSearchParams({ code: CODE });
    await render(<InviteLinkScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Takıma katıl' }));
    expect(await screen.findByText('Zaten bu takımdasın.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Takımlarıma git' }));
    expect(lastRouterCall()).toEqual({ method: 'replace', href: '/takimlar' });
  });

  it('rejects a malformed link code without a request', async () => {
    serveMe();
    const calls: string[] = [];
    mswServer.use(
      http.all(apiUrl('/api/v1/invites/*'), ({ request }) => {
        calls.push(new URL(request.url).pathname);
        return problem(404, 'not_found');
      }),
    );
    __setSearchParams({ code: 'short' });
    await render(<InviteLinkScreen />);
    expect(screen.getByRole('header', { name: 'Davet geçersiz' })).toBeTruthy();
    await settle();
    expect(calls).toEqual([]);
  });

  it('goes back to the input for another code', async () => {
    serveInvite();
    await render(<JoinTeamScreen />);
    await fireEvent.changeText(screen.getByLabelText('Davet bağlantısı ya da kodu'), CODE);
    await fireEvent.press(screen.getByRole('button', { name: 'Daveti göster' }));
    await screen.findByText('Yıldızlar FK');
    await fireEvent.press(screen.getByRole('button', { name: 'Başka bir kod gir' }));
    expect(screen.getByLabelText('Davet bağlantısı ya da kodu').props.value).toBe('');
  });
});

describe('team detail', () => {
  it('shows the roster by role with the own row marked, and the staff entry to invites', async () => {
    serveMe();
    serveTeam(detail('captain'));
    __setSearchParams({ id: TEAM_ID });
    await render(<TeamDetailScreen />);
    expect(await screen.findByRole('header', { name: 'Yıldızlar FK' })).toBeTruthy();
    const labels = screen
      .getAllByTestId(/^member-/)
      .map((element) => element.props.accessibilityLabel as string);
    expect(labels).toEqual([
      'Ali Kaptan (sen), Kaptan · Kaleci',
      'Zeynep, Yardımcı kaptan · Orta saha',
      'Mert, Oyuncu',
    ]);
    // The captain has no controls on their own row.
    expect(screen.getByTestId(`member-${ME_ID}`).props.accessibilityRole).toBeUndefined();
    expect(screen.getByTestId('team-captain-leave')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Takımdan ayrıl' })).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Oyuncu davet et' }));
    expect(lastRouterCall()).toEqual({ method: 'push', href: `/takim/${TEAM_ID}/davet` });
    await fireEvent.press(screen.getByRole('button', { name: 'Mert, Oyuncu' }));
    expect(lastRouterCall()).toEqual({
      method: 'push',
      href: `/takim/${TEAM_ID}/uye/${MERT_ID}`,
    });
  });

  it('lets a player leave after confirming, then forgets the team', async () => {
    serveMe();
    const server = serveTeam(detail('player'));
    const deletes: string[] = [];
    mswServer.use(
      http.delete(apiUrl(`/api/v1/teams/${TEAM_ID}/members/:userId`), ({ params }) => {
        deletes.push(String(params.userId));
        return new HttpResponse(null, { status: 204 });
      }),
      http.get(apiUrl('/api/v1/teams'), () => HttpResponse.json({ items: [], nextCursor: null })),
    );
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.teams(), {
      pages: [{ items: [summary({ myRole: 'player' })], nextCursor: null }],
      pageParams: [undefined],
    });
    __setSearchParams({ id: TEAM_ID });
    await render(<TeamDetailScreen />, queryClient);

    expect(screen.queryByRole('button', { name: 'Oyuncu davet et' })).toBeNull();
    await fireEvent.press(await screen.findByRole('button', { name: 'Takımdan ayrıl' }));
    expect(
      screen.getByText(
        'Yıldızlar FK takımından ayrılmak istediğine emin misin? Tekrar katılmak için yeni bir davet gerekir.',
      ),
    ).toBeTruthy();
    expect(deletes).toEqual([]);
    await fireEvent.press(screen.getByRole('button', { name: 'Ayrıl' }));
    await waitFor(() => expect(lastRouterCall()).toEqual({ method: 'replace', href: '/takimlar' }));
    expect(deletes).toEqual([ME_ID]);
    expect(queryClient.getQueryData(queryKeys.teamDetail(TEAM_ID))).toBeUndefined();
    // The roster of a team the user left is not asked for again.
    expect(server.reads()).toBe(1);
    await waitFor(() =>
      expect(
        queryClient
          .getQueryData<{ pages: { items: TeamSummary[] }[] }>(queryKeys.teams())
          ?.pages.flatMap((page) => page.items),
      ).toEqual([]),
    );
  });

  it('keeps the team when leaving fails and says why', async () => {
    serveMe();
    serveTeam(detail('player'));
    mswServer.use(
      http.delete(apiUrl(`/api/v1/teams/${TEAM_ID}/members/${ME_ID}`), () =>
        problem(403, 'forbidden'),
      ),
    );
    const queryClient = createTestQueryClient();
    __setSearchParams({ id: TEAM_ID });
    await render(<TeamDetailScreen />, queryClient);
    await fireEvent.press(await screen.findByRole('button', { name: 'Takımdan ayrıl' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Ayrıl' }));
    expect(await screen.findByText('Bu işlem için yetkin yok.')).toBeTruthy();
    expect(routerCalls()).toEqual([]);
    expect(queryClient.getQueryData(queryKeys.teamDetail(TEAM_ID))).toBeDefined();
  });

  it('explains a team that is gone or no longer accessible', async () => {
    serveMe();
    mswServer.use(http.get(apiUrl(`/api/v1/teams/${TEAM_ID}`), () => problem(404, 'not_found')));
    __setSearchParams({ id: TEAM_ID });
    await render(<TeamDetailScreen />);
    expect(await screen.findByRole('header', { name: 'Takım bulunamadı' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tekrar dene' })).toBeNull();
  });

  it('shows the saved roster with a notice when the network is down', async () => {
    serveMe();
    mswServer.use(http.get(apiUrl(`/api/v1/teams/${TEAM_ID}`), () => HttpResponse.error()));
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.teamDetail(TEAM_ID), detail('player'));
    __setSearchParams({ id: TEAM_ID });
    await render(<TeamDetailScreen />, queryClient);
    expect(await screen.findByTestId('cached-notice')).toBeTruthy();
    expect(screen.getByText('Bağlantı yok. Son kaydedilen bilgileri görüyorsun.')).toBeTruthy();
    expect(screen.getByText('Mert')).toBeTruthy();
  });

  it('shows a retryable error with the catalog copy when nothing is cached', async () => {
    serveMe();
    mswServer.use(http.get(apiUrl(`/api/v1/teams/${TEAM_ID}`), () => HttpResponse.error()));
    __setSearchParams({ id: TEAM_ID });
    await render(<TeamDetailScreen />);
    expect(
      await screen.findByText('Bağlantı kurulamadı. İnternet bağlantını kontrol edip tekrar dene.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tekrar dene' })).toBeTruthy();
  });

  it('loads through one shared token refresh when the access token has expired', async () => {
    const tokens = issueTokens(-60_000);
    await session.establish(tokens);
    const refresh = rotatingRefreshServer(tokens.refreshToken);
    const bearers: string[] = [];
    mswServer.use(
      http.get(apiUrl('/api/v1/me'), ({ request }) => {
        bearers.push(request.headers.get('authorization') ?? '');
        return HttpResponse.json(me());
      }),
      http.get(apiUrl(`/api/v1/teams/${TEAM_ID}`), ({ request }) => {
        bearers.push(request.headers.get('authorization') ?? '');
        return HttpResponse.json(detail('captain'));
      }),
    );
    __setSearchParams({ id: TEAM_ID });
    await render(<TeamDetailScreen />);
    expect(await screen.findByRole('header', { name: 'Yıldızlar FK' })).toBeTruthy();
    await waitFor(() => expect(bearers).toHaveLength(2));
    expect(refresh.calls()).toBe(1);
    expect(new Set(bearers)).toEqual(new Set([`Bearer ${refresh.current().accessToken}`]));
  });
});

describe('member actions', () => {
  function openMember(userId: string) {
    __setSearchParams({ id: TEAM_ID, userId });
  }

  it('makes a player co-captain at once and keeps it when the server agrees', async () => {
    serveMe();
    const server = serveTeam(detail('captain'));
    const gate = deferred();
    const bodies: unknown[] = [];
    mswServer.use(
      http.patch(apiUrl(`/api/v1/teams/${TEAM_ID}/members/${MERT_ID}`), async ({ request }) => {
        bodies.push(await request.json());
        await gate.promise;
        server.set(detail('captain', {}, { mert: 'co_captain' }));
        return HttpResponse.json(member(MERT, 'co_captain'));
      }),
    );
    openMember(MERT_ID);
    await render(<MemberScreen />);
    expect(await screen.findByText('Rol: Oyuncu')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Oyuncu yap' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Yardımcı kaptan yap' }));
    // Applied before the answer arrives.
    expect(await screen.findByText('Rol: Yardımcı kaptan')).toBeTruthy();
    expect(bodies).toEqual([{ role: 'co_captain' }]);
    gate.resolve();
    await waitFor(() => expect(server.reads()).toBeGreaterThanOrEqual(2));
    expect(screen.getByText('Rol: Yardımcı kaptan')).toBeTruthy();
  });

  it('puts the old role back when the server refuses the change', async () => {
    serveMe();
    serveTeam(detail('captain'), { offlineAfterFirstRead: true });
    mswServer.use(
      http.patch(apiUrl(`/api/v1/teams/${TEAM_ID}/members/${MERT_ID}`), () =>
        problem(403, 'forbidden'),
      ),
    );
    const queryClient = createTestQueryClient();
    openMember(MERT_ID);
    await render(<MemberScreen />, queryClient);
    await fireEvent.press(await screen.findByRole('button', { name: 'Yardımcı kaptan yap' }));
    expect(await screen.findByText('Bu işlem için yetkin yok.')).toBeTruthy();
    expect(screen.getByText('Rol: Oyuncu')).toBeTruthy();
    const cached = queryClient.getQueryData<TeamDetail>(queryKeys.teamDetail(TEAM_ID));
    expect(cached?.members.find((entry) => entry.user.id === MERT_ID)?.role).toBe('player');
  });

  it('hands over the captaincy only after confirmation and never in advance', async () => {
    serveMe();
    serveTeam(detail('captain'));
    const gate = deferred();
    const bodies: unknown[] = [];
    mswServer.use(
      http.patch(apiUrl(`/api/v1/teams/${TEAM_ID}/members/${MERT_ID}`), async ({ request }) => {
        bodies.push(await request.json());
        await gate.promise;
        return HttpResponse.json(member(MERT, 'captain'));
      }),
    );
    openMember(MERT_ID);
    await render(<MemberScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Kaptanlığı devret' }));
    expect(
      screen.getByText(
        'Kaptanlığı Mert adlı oyuncuya devretmek istediğine emin misin? Sen yardımcı kaptan olursun.',
      ),
    ).toBeTruthy();
    expect(bodies).toEqual([]);
    await fireEvent.press(screen.getByRole('button', { name: 'Devret' }));
    await waitFor(() => expect(bodies).toEqual([{ role: 'captain' }]));
    expect(screen.getByText('Rol: Oyuncu')).toBeTruthy();
    gate.resolve();
  });

  it('removes a member from the roster at once and goes back when the server confirms', async () => {
    serveMe();
    const server = serveTeam(detail('captain'));
    const gate = deferred();
    mswServer.use(
      http.delete(apiUrl(`/api/v1/teams/${TEAM_ID}/members/${MERT_ID}`), async () => {
        await gate.promise;
        server.set(
          detail('captain', {
            members: [member(ALI, 'captain'), member(ZEYNEP, 'co_captain')],
            memberCount: 2,
          }),
        );
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const queryClient = createTestQueryClient();
    openMember(MERT_ID);
    await render(<MemberScreen />, queryClient);
    await fireEvent.press(await screen.findByRole('button', { name: 'Takımdan çıkar' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Çıkar' }));
    await waitFor(() => {
      const cached = queryClient.getQueryData<TeamDetail>(queryKeys.teamDetail(TEAM_ID));
      expect(cached?.members.map((entry) => entry.user.id)).not.toContain(MERT_ID);
      expect(cached?.memberCount).toBe(2);
    });
    // The open screen keeps showing the member instead of "not found".
    expect(screen.getByRole('header', { name: 'Mert' })).toBeTruthy();
    expect(routerCalls()).toEqual([]);
    gate.resolve();
    await waitFor(() =>
      expect(lastRouterCall()).toEqual({ method: 'replace', href: `/takim/${TEAM_ID}` }),
    );
  });

  it('brings a removed member back when the server refuses', async () => {
    serveMe();
    serveTeam(detail('captain'), { offlineAfterFirstRead: true });
    mswServer.use(
      http.delete(apiUrl(`/api/v1/teams/${TEAM_ID}/members/${MERT_ID}`), () =>
        problem(403, 'forbidden'),
      ),
    );
    const queryClient = createTestQueryClient();
    openMember(MERT_ID);
    await render(<MemberScreen />, queryClient);
    await fireEvent.press(await screen.findByRole('button', { name: 'Takımdan çıkar' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Çıkar' }));
    expect(await screen.findByText('Bu işlem için yetkin yok.')).toBeTruthy();
    const cached = queryClient.getQueryData<TeamDetail>(queryKeys.teamDetail(TEAM_ID));
    expect(cached?.members.map((entry) => entry.user.id)).toContain(MERT_ID);
    expect(cached?.memberCount).toBe(3);
    expect(routerCalls()).toEqual([]);
  });

  it('offers a co-captain removal of players only, and nothing on another co-captain', async () => {
    serveMe();
    serveTeam(detail('co_captain', {}, { zeynep: 'captain' }));
    openMember(MERT_ID);
    await render(<MemberScreen />);
    expect(await screen.findByRole('button', { name: 'Takımdan çıkar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Yardımcı kaptan yap' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Kaptanlığı devret' })).toBeNull();
  });

  it('offers nothing to a captain on their own row', async () => {
    serveMe();
    serveTeam(detail('captain'));
    openMember(ME_ID);
    await render(<MemberScreen />);
    expect(await screen.findByTestId('member-no-actions')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Takımdan çıkar' })).toBeNull();
  });
});

describe('invites', () => {
  const future = () => new Date(Date.now() + 3 * 86_400_000).toISOString();

  function serveInvites(options: { create?: () => Response } = {}) {
    const calls: string[] = [];
    mswServer.use(
      http.get(apiUrl(`/api/v1/teams/${TEAM_ID}/invites`), () => {
        calls.push('list');
        return HttpResponse.json({
          items: [
            {
              id: INVITE_ID,
              createdAt: '2026-10-01T10:00:00.000Z',
              expiresAt: future(),
              uses: 3,
              maxUses: 20,
            },
            {
              id: '0192a0b0-0000-7000-8000-0000000000b2',
              createdAt: '2026-09-01T10:00:00.000Z',
              expiresAt: '2026-09-08T10:00:00.000Z',
              uses: 1,
              maxUses: 20,
            },
          ],
          nextCursor: null,
        });
      }),
      http.post(apiUrl(`/api/v1/teams/${TEAM_ID}/invites`), () => {
        calls.push('create');
        return (
          options.create?.() ??
          HttpResponse.json(
            {
              inviteId: '0192a0b0-0000-7000-8000-0000000000b3',
              code: CODE,
              url: `https://kadro.app/mac/${CODE}`,
              expiresAt: future(),
              maxUses: 20,
            },
            { status: 201 },
          )
        );
      }),
      http.delete(apiUrl(`/api/v1/teams/${TEAM_ID}/invites/:inviteId`), ({ params }) => {
        calls.push(`revoke ${String(params.inviteId)}`);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    return calls;
  }

  it('creates a link once, with code, QR code and share sheet', async () => {
    serveMe();
    serveTeam(detail('co_captain', {}, { zeynep: 'captain' }));
    const calls = serveInvites();
    __setSearchParams({ id: TEAM_ID });
    await render(<TeamInvitesScreen />);

    // Only the live invite is listed.
    expect(await screen.findAllByTestId(/^invite-0192/)).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Davet bağlantısı oluştur' }));
    expect(await screen.findByTestId('invite-code')).toBeTruthy();
    expect(screen.getByText(CODE)).toBeTruthy();
    expect(screen.getByTestId('qr-code').props.value).toBe(`https://kadro.app/mac/${CODE}`);
    expect(screen.getByLabelText('Davet bağlantısının QR kodu')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Yeni bağlantı oluştur' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Bağlantıyı paylaş' }));
    expect(__sharedContent()).toEqual([
      { message: `Yıldızlar FK takımına Kadro'da katıl: https://kadro.app/mac/${CODE}` },
    ]);
    await waitFor(() => expect(calls).toEqual(['list', 'create', 'list']));
  });

  it('says so when the share sheet cannot open', async () => {
    serveMe();
    serveTeam(detail('captain'));
    serveInvites();
    __setShareFailure(new Error('no activity'));
    __setSearchParams({ id: TEAM_ID });
    await render(<TeamInvitesScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Davet bağlantısı oluştur' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Bağlantıyı paylaş' }));
    expect(
      await screen.findByText('Paylaşım açılamadı. Kodu ekrandan seçip kopyalayabilirsin.'),
    ).toBeTruthy();
  });

  it('does not show a link that is not https or does not carry the code', async () => {
    serveMe();
    serveTeam(detail('captain'));
    serveInvites({
      create: () =>
        HttpResponse.json(
          {
            inviteId: '0192a0b0-0000-7000-8000-0000000000b3',
            code: CODE,
            url: `http://kadro.app/mac/${CODE}`,
            expiresAt: future(),
            maxUses: 20,
          },
          { status: 201 },
        ),
    });
    __setSearchParams({ id: TEAM_ID });
    await render(<TeamInvitesScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Davet bağlantısı oluştur' }));
    expect(await screen.findByText(CODE)).toBeTruthy();
    expect(screen.queryByTestId('qr-code')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bağlantıyı paylaş' })).toBeNull();
  });

  it('shows the catalog copy when the team has too many live invites', async () => {
    serveMe();
    serveTeam(detail('captain'));
    serveInvites({ create: () => problem(409, 'invite_limit') });
    __setSearchParams({ id: TEAM_ID });
    await render(<TeamInvitesScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Davet bağlantısı oluştur' }));
    expect(
      await screen.findByText('Bu takımın etkin davet sayısı dolu. Eski bir daveti iptal et.'),
    ).toBeTruthy();
    expect(screen.queryByTestId('invite-code')).toBeNull();
  });

  it('revokes an invite after confirmation', async () => {
    serveMe();
    serveTeam(detail('captain'));
    const calls = serveInvites();
    __setSearchParams({ id: TEAM_ID });
    await render(<TeamInvitesScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Daveti iptal et' }));
    expect(
      screen.getByText('Bu davet iptal edilsin mi? Bağlantı hemen geçersiz olur.'),
    ).toBeTruthy();
    expect(calls).toEqual(['list']);
    await fireEvent.press(screen.getByRole('button', { name: 'İptal et' }));
    await waitFor(() => expect(calls).toEqual(['list', `revoke ${INVITE_ID}`, 'list']));
  });

  it('offers no new invite for a read-only team', async () => {
    serveMe();
    serveTeam(detail('captain', { isProLocked: true }));
    serveInvites();
    __setSearchParams({ id: TEAM_ID });
    await render(<TeamInvitesScreen />);
    expect(await screen.findByTestId('invites-locked')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Davet bağlantısı oluştur' })).toBeNull();
  });

  it('shows players that invites belong to the staff and does not ask for them', async () => {
    serveMe();
    serveTeam(detail('player'));
    const calls = serveInvites();
    __setSearchParams({ id: TEAM_ID });
    await render(<TeamInvitesScreen />);
    expect(await screen.findByTestId('invites-staff-only')).toBeTruthy();
    await settle();
    expect(calls).toEqual([]);
  });
});

describe('writes return at once and show their state', () => {
  /** A connection that accepts the request and never answers (weak signal). */
  const hang = () => new Promise<never>(() => undefined);

  it('goes back after a removal although the roster refetch never answers', async () => {
    serveMe();
    let reads = 0;
    mswServer.use(
      http.get(apiUrl(`/api/v1/teams/${TEAM_ID}`), async () => {
        reads += 1;
        if (reads > 1) {
          return hang();
        }
        return HttpResponse.json(detail('captain'));
      }),
      http.delete(
        apiUrl(`/api/v1/teams/${TEAM_ID}/members/${MERT_ID}`),
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    __setSearchParams({ id: TEAM_ID, userId: MERT_ID });
    await render(<MemberScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Takımdan çıkar' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Çıkar' }));
    await waitFor(() =>
      expect(lastRouterCall()).toEqual({ method: 'replace', href: `/takim/${TEAM_ID}` }),
    );
    expect(reads).toBe(2);
  });

  it('leaves the team at once although the team list refetch never answers', async () => {
    serveMe();
    serveTeam(detail('player'));
    let listReads = 0;
    mswServer.use(
      http.get(apiUrl('/api/v1/teams'), async () => {
        listReads += 1;
        if (listReads > 1) {
          return hang();
        }
        return HttpResponse.json({ items: [summary({ myRole: 'player' })], nextCursor: null });
      }),
      http.delete(
        apiUrl(`/api/v1/teams/${TEAM_ID}/members/${ME_ID}`),
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    __setSearchParams({ id: TEAM_ID });
    // The tab stays mounted under the team screen, so its list is refetched after leaving.
    await render(
      <>
        <TeamsTab />
        <TeamDetailScreen />
      </>,
    );
    await screen.findByRole('button', { name: 'Yıldızlar FK, Oyuncu · 3 oyuncu' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Takımdan ayrıl' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Ayrıl' }));
    await waitFor(() => expect(lastRouterCall()).toEqual({ method: 'replace', href: '/takimlar' }));
    expect(listReads).toBe(2);
  });

  it('keeps a roster that a refetch brought in while a refused change was on its way', async () => {
    serveMe();
    let reads = 0;
    const gate = deferred();
    mswServer.use(
      http.get(apiUrl(`/api/v1/teams/${TEAM_ID}`), () => {
        reads += 1;
        if (reads === 1) {
          return HttpResponse.json(detail('captain'));
        }
        if (reads === 2) {
          return HttpResponse.json(
            detail('captain', {
              members: [
                member(ALI, 'captain'),
                member(ZEYNEP, 'co_captain'),
                member({ ...MERT, displayName: 'Mert Yılmaz' }, 'player'),
              ],
            }),
          );
        }
        return HttpResponse.error();
      }),
      http.patch(apiUrl(`/api/v1/teams/${TEAM_ID}/members/${MERT_ID}`), async () => {
        await gate.promise;
        return problem(403, 'forbidden');
      }),
    );
    const queryClient = createTestQueryClient();
    __setSearchParams({ id: TEAM_ID, userId: MERT_ID });
    await render(<MemberScreen />, queryClient);
    await fireEvent.press(await screen.findByRole('button', { name: 'Yardımcı kaptan yap' }));
    await act(() => queryClient.refetchQueries({ queryKey: queryKeys.teamDetail(TEAM_ID) }));
    gate.resolve();
    expect(await screen.findByText('Bu işlem için yetkin yok.')).toBeTruthy();
    await waitFor(() => expect(reads).toBeGreaterThanOrEqual(3));
    const cached = queryClient.getQueryData<TeamDetail>(queryKeys.teamDetail(TEAM_ID));
    const mert = cached?.members.find((entry) => entry.user.id === MERT_ID);
    expect(mert?.user.displayName).toBe('Mert Yılmaz');
    expect(mert?.role).toBe('player');
  });

  it('marks the running removal busy and the other roster rows disabled', async () => {
    serveMe();
    serveTeam(detail('captain'));
    const gate = deferred();
    mswServer.use(
      http.delete(apiUrl(`/api/v1/teams/${TEAM_ID}/members/${MERT_ID}`), async () => {
        await gate.promise;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    __setSearchParams({ id: TEAM_ID, userId: MERT_ID });
    await render(
      <>
        <TeamDetailScreen />
        <MemberScreen />
      </>,
    );
    const zeynepRow = await screen.findByRole('button', {
      name: 'Zeynep, Yardımcı kaptan · Orta saha',
    });
    expect(zeynepRow.props.accessibilityState).toEqual({ disabled: false });
    await fireEvent.press(screen.getByRole('button', { name: 'Takımdan çıkar' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Çıkar' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Takımdan çıkar' }).props.accessibilityState,
      ).toEqual({ disabled: true, busy: true }),
    );
    expect(
      screen.getByRole('button', { name: 'Zeynep, Yardımcı kaptan · Orta saha' }).props
        .accessibilityState,
    ).toEqual({ disabled: true });
    gate.resolve();
    await waitFor(() => expect(routerCalls()).toHaveLength(1));
  });

  it('marks a running revoke busy', async () => {
    serveMe();
    serveTeam(detail('captain'));
    const gate = deferred();
    mswServer.use(
      http.get(apiUrl(`/api/v1/teams/${TEAM_ID}/invites`), () =>
        HttpResponse.json({
          items: [
            {
              id: INVITE_ID,
              createdAt: '2026-10-01T10:00:00.000Z',
              expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
              uses: 0,
              maxUses: 20,
            },
          ],
          nextCursor: null,
        }),
      ),
      http.delete(apiUrl(`/api/v1/teams/${TEAM_ID}/invites/${INVITE_ID}`), async () => {
        await gate.promise;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    __setSearchParams({ id: TEAM_ID });
    await render(<TeamInvitesScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Daveti iptal et' }));
    await fireEvent.press(screen.getByRole('button', { name: 'İptal et' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Daveti iptal et' }).props.accessibilityState,
      ).toEqual({ disabled: true, busy: true }),
    );
    gate.resolve();
  });
});

describe('member screen while the own profile loads', () => {
  it('shows progress, then a retry on failure, and offers actions only once it is known', async () => {
    serveTeam(detail('captain'));
    const gate = deferred();
    let fail = true;
    mswServer.use(
      http.get(apiUrl('/api/v1/me'), async () => {
        await gate.promise;
        return fail ? problem(500, 'internal_error', 'req-me-1') : HttpResponse.json(me());
      }),
    );
    __setSearchParams({ id: TEAM_ID, userId: ME_ID });
    await render(<MemberScreen />);
    expect(await screen.findByTestId('member-viewer-loading')).toBeTruthy();
    expect(screen.queryByTestId('member-no-actions')).toBeNull();
    gate.resolve();
    expect(await screen.findByText('Hata kodu: req-me-1')).toBeTruthy();
    expect(screen.queryByTestId('member-no-actions')).toBeNull();
    fail = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    // Own row of the captain: now known, so the screen can say there is nothing to change.
    expect(await screen.findByTestId('member-no-actions')).toBeTruthy();
  });
});
