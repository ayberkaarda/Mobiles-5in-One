import { act, fireEvent, screen, waitFor } from '@testing-library/react-native/pure';
import { type QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { type ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NO_ENTITLEMENTS } from '../../../packages/contracts/src/billing';
import OpenCallsTab from '../app/(tabs)/eksik-var/index';
import CallDetailScreen from '../app/ilan/[id]';
import MatchCallScreen from '../app/ilan/mac/[matchId]';
import MatchDetailScreen from '../app/takim/[id]/mac/[matchId]/index';
import { session } from '../src/api/instance';
import { type MeResponse, type TeamDetail, type TeamRole } from '../src/api/contracts';
import { NO_FILTERS } from '../src/calls/calls-api';
import { CallFacts } from '../src/calls/components';
import {
  type Application,
  type DistrictPublic,
  type OpenCall,
  type OpenCallPublic,
} from '../src/calls/contracts';
import { callKeys } from '../src/calls/queries';
import { type MatchGuestView, type MatchMemberView } from '../src/matches/contracts';
import { lightTheme } from '../src/theme';
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
const CALL_ID = '0192a0b0-0000-7000-8000-0000000000c1';
const CALL_2_ID = '0192a0b0-0000-7000-8000-0000000000c2';
const APP_ID = '0192a0b0-0000-7000-8000-0000000000b1';
const APP_2_ID = '0192a0b0-0000-7000-8000-0000000000b2';
const KADIKOY_ID = '0192a0b0-0000-7000-8000-0000000000d1';
const CANKAYA_ID = '0192a0b0-0000-7000-8000-0000000000d2';
const ME_ID = '0192a0b0-0000-7000-8000-0000000000f1';
const DENIZ_ID = '0192a0b0-0000-7000-8000-0000000000f2';
const EGE_ID = '0192a0b0-0000-7000-8000-0000000000f3';
const HOUR = 60 * 60 * 1000;

/** Copy of the error catalog (`errors.json`) as the screens read it; the real file ships separately. */
const ERROR_CATALOG = {
  already_applied: 'Bu ilana zaten başvurdun.',
  already_participant: 'Zaten bu maçtasın.',
  call_closed: 'Bu ilan kapandı.',
  match_full: 'Maç dolu.',
  open_call_exists: 'Bu maçın açık bir ilanı var.',
  invalid_call_expiry: 'İlan bitişi geçersiz.',
  network_error: 'Bağlantı kurulamadı. İnternet bağlantını kontrol edip tekrar dene.',
  server_error: 'Sunucuda bir sorun oluştu.',
  unknown: 'Bir sorun oluştu. Biraz sonra tekrar dene.',
};

function i18nWithCatalog() {
  const resources = appResources();
  return createTestI18n('tr', { ...resources, tr: { ...resources.tr, errors: ERROR_CATALOG } });
}

function render(ui: ReactElement, queryClient: QueryClient = createTestQueryClient()) {
  return renderWithProviders(ui, { i18n: i18nWithCatalog(), queryClient });
}

const inFuture = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();

function publicCall(overrides: Partial<OpenCallPublic> = {}): OpenCallPublic {
  return {
    id: CALL_ID,
    districtId: KADIKOY_ID,
    startsAt: inFuture(30),
    format: '7v7',
    missingCount: 2,
    position: 'GK',
    level: 'regular',
    venue: null,
    teamName: 'Moda Gençlik',
    expiresAt: inFuture(29),
    ...overrides,
  };
}

function application(
  id: string,
  applicantId: string,
  name: string,
  overrides: Partial<Application> = {},
): Application {
  return {
    id,
    openCallId: CALL_ID,
    applicant: {
      id: applicantId,
      displayName: name,
      avatarUrl: null,
      position: 'GK',
      level: 'casual',
    },
    message: null,
    status: 'pending',
    createdAt: '2026-10-02T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
    ...overrides,
  };
}

function district(id: string, name: string, province: string): DistrictPublic {
  return {
    id,
    province,
    provinceSlug: 'il',
    name,
    slug: 'ilce',
    centroid: { latitude: 41, longitude: 29 },
  };
}

const DISTRICTS = [
  district(KADIKOY_ID, 'Kadıköy', 'İstanbul'),
  district(CANKAYA_ID, 'Çankaya', 'Ankara'),
];

function me(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    id: ME_ID,
    displayName: 'Ali',
    avatarUrl: null,
    position: 'GK',
    level: 'regular',
    email: 'ali@example.com',
    emailVerified: true,
    role: 'user',
    districtId: KADIKOY_ID,
    providers: { password: true, apple: false, google: false },
    createdAt: '2026-09-01T10:00:00.000Z',
    entitlements: NO_ENTITLEMENTS,
    ...overrides,
  };
}

function team(myRole: TeamRole = 'captain', overrides: Partial<TeamDetail> = {}): TeamDetail {
  return {
    id: TEAM_ID,
    name: 'Yıldızlar FK',
    slug: 'yildizlar-fk',
    badgeUrl: null,
    districtId: KADIKOY_ID,
    myRole,
    memberCount: 1,
    isProLocked: false,
    createdAt: '2026-09-01T10:00:00.000Z',
    members: [],
    ...overrides,
  };
}

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
    counts: { in: 11, maybe: 0, out: 0, waitlist: 0 },
    myRsvp: 'in',
    createdAt: '2026-09-20T10:00:00.000Z',
    sharePerPlayerMinor: 10_000,
    myShareMinor: 10_000,
    mvp: null,
    participants: [],
    ...overrides,
  };
}

function storedCall(overrides: Partial<OpenCall> = {}): OpenCall {
  return {
    id: CALL_ID,
    matchId: MATCH_ID,
    missingCount: 2,
    position: null,
    level: 'regular',
    districtId: KADIKOY_ID,
    status: 'open',
    expiresAt: inFuture(47),
    createdAt: '2026-10-02T10:00:00.000Z',
    ...overrides,
  };
}

function serveMe(value: MeResponse = me()) {
  mswServer.use(http.get(apiUrl('/api/v1/me'), () => HttpResponse.json(value)));
}

function serveDistricts() {
  mswServer.use(
    http.get(apiUrl('/api/v1/districts'), () => HttpResponse.json({ items: DISTRICTS })),
  );
}

/** `GET open-calls` recording the query string of each read. */
function serveList(
  respond: (url: URL) => Response = () =>
    HttpResponse.json({ items: [publicCall()], nextCursor: null }),
) {
  const queries: string[] = [];
  mswServer.use(
    http.get(apiUrl('/api/v1/open-calls'), ({ request }) => {
      const url = new URL(request.url);
      queries.push(url.search);
      return respond(url);
    }),
  );
  return queries;
}

/** `GET open-calls/:id/applications` answering the current state. */
function serveApplications(initial: () => Response) {
  let respond = initial;
  let reads = 0;
  mswServer.use(
    http.get(apiUrl(`/api/v1/open-calls/${CALL_ID}/applications`), () => {
      reads += 1;
      return respond();
    }),
  );
  return {
    set: (next: () => Response) => {
      respond = next;
    },
    reads: () => reads,
  };
}

const page = (items: Application[]) => () => HttpResponse.json({ items, nextCursor: null });

function servePatchApplication(respond: (body: unknown, appId: string) => Response) {
  const bodies: unknown[] = [];
  mswServer.use(
    http.patch(
      apiUrl(`/api/v1/open-calls/${CALL_ID}/applications/:appId`),
      async ({ request, params }) => {
        const body: unknown = await request.json();
        bodies.push(body);
        return respond(body, String(params.appId));
      },
    ),
  );
  return bodies;
}

function serveMatch(value: MatchMemberView | MatchGuestView = match()) {
  let reads = 0;
  mswServer.use(
    http.get(apiUrl(`/api/v1/matches/${MATCH_ID}`), () => {
      reads += 1;
      return HttpResponse.json(value);
    }),
  );
  return { reads: () => reads };
}

function serveTeam(detail: TeamDetail = team()) {
  mswServer.use(http.get(apiUrl(`/api/v1/teams/${TEAM_ID}`), () => HttpResponse.json(detail)));
}

/** A client that already holds the call in a list, as after tapping it in the tab. */
function clientWithCall(call: OpenCallPublic = publicCall()): QueryClient {
  const client = createTestQueryClient();
  client.setQueryData(callKeys.list(NO_FILTERS), {
    pages: [{ items: [call], nextCursor: null }],
    pageParams: [undefined],
  });
  client.setQueryData(callKeys.call(call.id), call);
  return client;
}

async function settle(ms = 50): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function lastButton(name: string) {
  const buttons = screen.getAllByRole('button', { name });
  const last = buttons.at(-1);
  if (last === undefined) {
    throw new Error(`no button ${name}`);
  }
  return last;
}

beforeEach(async () => {
  await session.establish(issueTokens());
});

describe('Eksik Var tab', () => {
  it('lists calls and opens one, keeping it for the detail', async () => {
    serveDistricts();
    serveList();
    const client = createTestQueryClient();
    await render(<OpenCallsTab />, client);
    expect(await screen.findByText('Moda Gençlik')).toBeTruthy();
    // The count is an outlined figure; "2 eksik" is its spoken text.
    expect(screen.getByLabelText('2 eksik')).toBeTruthy();
    expect(screen.getByText('Kaleci')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Kadıköy, İstanbul')).toBeTruthy());
    await fireEvent.press(screen.getByTestId(`open-call-${CALL_ID}`));
    expect(routerCalls().at(-1)).toEqual({ method: 'push', href: `/ilan/${CALL_ID}` });
    expect(client.getQueryData(callKeys.call(CALL_ID))).toMatchObject({ teamName: 'Moda Gençlik' });
  });

  it('filters by level, position and a searched district, and clears the filters', async () => {
    serveDistricts();
    const queries = serveList((url) =>
      HttpResponse.json({
        items: url.searchParams.has('district') ? [] : [publicCall()],
        nextCursor: null,
      }),
    );
    await render(<OpenCallsTab />);
    expect(await screen.findByText('Moda Gençlik')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Filtrele' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Rekabetçi' }));
    // A selected filter uses the inverse chip colours, like the "Filtrele" toggle.
    const chosen = screen.getByRole('radio', { name: 'Rekabetçi' });
    expect(chosen.props.accessibilityState).toMatchObject({ checked: true });
    expect(StyleSheet.flatten(chosen.props.style).backgroundColor).toBe(lightTheme.colors.inverse);
    expect(StyleSheet.flatten(screen.getByText('Rekabetçi').props.style).color).toBe(
      lightTheme.colors.onInverse,
    );
    await fireEvent.press(screen.getByRole('radio', { name: 'Kaleci' }));
    await fireEvent.changeText(screen.getByLabelText('İlçe ara'), 'çan');
    await fireEvent.press(await screen.findByRole('radio', { name: 'Çankaya, Ankara' }));
    expect(await screen.findByText('Bu filtrelere uyan ilan yok')).toBeTruthy();
    expect(queries).toEqual([
      '?limit=20',
      '?limit=20&level=competitive',
      '?limit=20&level=competitive&position=GK',
      `?limit=20&district=${CANKAYA_ID}&level=competitive&position=GK`,
    ]);
    expect(screen.getByRole('button', { name: 'Filtrele (3)' })).toBeTruthy();
    await fireEvent.press(lastButton('Filtreleri temizle'));
    expect(await screen.findByText('Moda Gençlik')).toBeTruthy();
  });

  it('shows the error with its request id and retries; keeps the list working without districts', async () => {
    mswServer.use(http.get(apiUrl('/api/v1/districts'), () => problem(404, 'not_found')));
    let fail = true;
    serveList(() =>
      fail
        ? problem(500, 'internal', 'req-calls-1')
        : HttpResponse.json({ items: [publicCall()], nextCursor: null }),
    );
    await render(<OpenCallsTab />);
    expect(await screen.findByText('Sunucuda bir sorun oluştu.')).toBeTruthy();
    expect(screen.getByText(/req-calls-1/)).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(await screen.findByText('Moda Gençlik')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Filtrele' }));
    expect(await screen.findByTestId('filter-district-error')).toBeTruthy();
  });

  it('keeps showing the saved list when a refresh fails', async () => {
    serveDistricts();
    serveList(() => HttpResponse.error());
    const client = clientWithCall();
    await client.invalidateQueries({ queryKey: callKeys.lists() });
    await render(<OpenCallsTab />, client);
    expect(
      await screen.findByText('Bağlantı yok. Son kaydedilen bilgileri görüyorsun.'),
    ).toBeTruthy();
    expect(screen.getByText('Moda Gençlik')).toBeTruthy();
  });
});

describe('call detail', () => {
  function openCall(id = CALL_ID) {
    __setSearchParams({ id });
  }

  it('applies with a message and shows "applied" only after the server stored it', async () => {
    serveMe();
    serveDistricts();
    serveApplications(() => problem(404, 'not_found'));
    const gate = deferred();
    const bodies: unknown[] = [];
    mswServer.use(
      http.post(apiUrl(`/api/v1/open-calls/${CALL_ID}/applications`), async ({ request }) => {
        bodies.push(await request.json());
        await gate.promise;
        return HttpResponse.json(application(APP_ID, ME_ID, 'Ali', { message: 'Kaleye geçerim' }), {
          status: 201,
        });
      }),
    );
    openCall();
    await render(<CallDetailScreen />, clientWithCall());
    await fireEvent.changeText(
      await screen.findByLabelText('Kaptana not (isteğe bağlı)'),
      '  Kaleye geçerim  ',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Başvur' }));
    await settle();
    // Pessimistic: nothing claims success while the request runs.
    expect(screen.queryByTestId('own-application')).toBeNull();
    expect(screen.getByTestId('apply-form')).toBeTruthy();
    gate.resolve();
    expect(
      await screen.findByText('Başvurun kaptanda. Karar verilince haber vereceğiz.'),
    ).toBeTruthy();
    expect(bodies).toEqual([{ message: 'Kaleye geçerim' }]);
    expect(screen.queryByTestId('apply-form')).toBeNull();
  });

  it('sends no message field when the note is empty and refuses an over-long note', async () => {
    serveMe();
    serveDistricts();
    serveApplications(() => problem(404, 'not_found'));
    const bodies: unknown[] = [];
    mswServer.use(
      http.post(apiUrl(`/api/v1/open-calls/${CALL_ID}/applications`), async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(application(APP_ID, ME_ID, 'Ali'), { status: 201 });
      }),
    );
    openCall();
    await render(<CallDetailScreen />, clientWithCall());
    await fireEvent.changeText(
      await screen.findByLabelText('Kaptana not (isteğe bağlı)'),
      'zil\u0007',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Başvur' }));
    expect(screen.getByText('Notta kullanılamayan karakterler var.')).toBeTruthy();
    await settle();
    expect(bodies).toEqual([]);
    await fireEvent.changeText(screen.getByLabelText('Kaptana not (isteğe bağlı)'), '   ');
    await fireEvent.press(screen.getByRole('button', { name: 'Başvur' }));
    await waitFor(() => expect(bodies).toEqual([{}]));
  });

  it('shows an existing application and withdraws it after a confirmation', async () => {
    serveMe();
    serveDistricts();
    serveApplications(page([application(APP_ID, ME_ID, 'Ali', { message: 'Gelirim' })]));
    const bodies = servePatchApplication(() =>
      HttpResponse.json(application(APP_ID, ME_ID, 'Ali', { status: 'withdrawn' })),
    );
    openCall();
    await render(<CallDetailScreen />, clientWithCall());
    expect(await screen.findByText('Notun: Gelirim')).toBeTruthy();
    expect(screen.queryByTestId('apply-form')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Başvurumu geri çek' }));
    await settle();
    expect(bodies).toEqual([]);
    await fireEvent.press(screen.getByRole('button', { name: 'Geri çek' }));
    expect(await screen.findByText('Başvurunu geri çektin.')).toBeTruthy();
    expect(bodies).toEqual([{ status: 'withdrawn' }]);
    expect(screen.queryByRole('button', { name: 'Başvurumu geri çek' })).toBeNull();
  });

  it('shows the team staff its own call with the applications to decide', async () => {
    serveMe();
    serveDistricts();
    const applications = serveApplications(
      page([application(APP_ID, DENIZ_ID, 'Deniz', { message: 'https://x.test bak' })]),
    );
    const bodies = servePatchApplication(() => {
      const accepted = application(APP_ID, DENIZ_ID, 'Deniz', { status: 'accepted' });
      applications.set(page([accepted]));
      return HttpResponse.json(accepted);
    });
    openCall();
    await render(<CallDetailScreen />, clientWithCall());
    expect(await screen.findByTestId('own-team')).toBeTruthy();
    expect(screen.queryByTestId('apply-form')).toBeNull();
    expect(screen.getByText('https://x.test bak')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Deniz adlı oyuncuyu kabul et' }));
    await waitFor(() =>
      expect(screen.getByTestId(`application-${APP_ID}-status`).props.children).toBe(
        'Kabul edildi',
      ),
    );
    expect(bodies).toEqual([{ status: 'accepted' }]);
  });

  it('accepting from the call screen refreshes the match and the kept call', async () => {
    serveMe();
    serveDistricts();
    serveMatch();
    const deniz = application(APP_ID, DENIZ_ID, 'Deniz');
    const applications = serveApplications(page([deniz]));
    servePatchApplication(() => {
      const accepted = { ...deniz, status: 'accepted' as const };
      applications.set(page([accepted]));
      return HttpResponse.json(accepted);
    });
    const client = clientWithCall();
    client.setQueryData(callKeys.matchCall(MATCH_ID), storedCall({ missingCount: 1 }));
    client.setQueryData(['matches', 'detail', MATCH_ID], match());
    openCall();
    await render(<CallDetailScreen />, client);
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Deniz adlı oyuncuyu kabul et' }),
    );
    await waitFor(() =>
      expect(client.getQueryData<OpenCall>(callKeys.matchCall(MATCH_ID))).toMatchObject({
        missingCount: 0,
        status: 'closed',
      }),
    );
    expect(client.getQueryState(['matches', 'detail', MATCH_ID])?.isInvalidated).toBe(true);
  });

  it('without a kept call, accepting marks every cached match detail stale', async () => {
    serveMe();
    serveDistricts();
    const deniz = application(APP_ID, DENIZ_ID, 'Deniz');
    const applications = serveApplications(page([deniz]));
    servePatchApplication(() => {
      const accepted = { ...deniz, status: 'accepted' as const };
      applications.set(page([accepted]));
      return HttpResponse.json(accepted);
    });
    const client = clientWithCall();
    client.setQueryData(['matches', 'detail', MATCH_ID], match());
    client.setQueryData(['matches', 'team', TEAM_ID], { items: [], nextCursor: null });
    openCall();
    await render(<CallDetailScreen />, client);
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Deniz adlı oyuncuyu kabul et' }),
    );
    await waitFor(() =>
      expect(client.getQueryState(['matches', 'detail', MATCH_ID])?.isInvalidated).toBe(true),
    );
    expect(client.getQueryState(['matches', 'team', TEAM_ID])?.isInvalidated).toBe(false);
  });

  it('turns already_participant into the "you are in this team" state', async () => {
    serveMe();
    serveDistricts();
    serveApplications(() => problem(404, 'not_found'));
    mswServer.use(
      http.post(apiUrl(`/api/v1/open-calls/${CALL_ID}/applications`), () =>
        problem(409, 'already_participant'),
      ),
    );
    openCall();
    await render(<CallDetailScreen />, clientWithCall());
    await fireEvent.press(await screen.findByRole('button', { name: 'Başvur' }));
    expect(await screen.findByTestId('already-participant')).toBeTruthy();
    expect(screen.queryByTestId('apply-form')).toBeNull();
  });

  it('re-reads the own application after already_applied', async () => {
    serveMe();
    serveDistricts();
    const applications = serveApplications(() => problem(404, 'not_found'));
    mswServer.use(
      http.post(apiUrl(`/api/v1/open-calls/${CALL_ID}/applications`), () => {
        applications.set(page([application(APP_ID, ME_ID, 'Ali', { status: 'rejected' })]));
        return problem(409, 'already_applied');
      }),
    );
    openCall();
    await render(<CallDetailScreen />, clientWithCall());
    await fireEvent.press(await screen.findByRole('button', { name: 'Başvur' }));
    expect(await screen.findByText('Başvurun kabul edilmedi.')).toBeTruthy();
  });

  it('offers no application on an ended call or with an unverified email', async () => {
    serveMe(me({ emailVerified: false }));
    serveDistricts();
    serveApplications(() => problem(404, 'not_found'));
    openCall();
    await render(<CallDetailScreen />, clientWithCall());
    expect(await screen.findByTestId('apply-unverified')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Başvur' })).toBeNull();
    await act(async () => {
      await screen.unmount();
    });
    serveMe();
    const ended = publicCall({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    await render(<CallDetailScreen />, clientWithCall(ended));
    expect(await screen.findByTestId('apply-closed')).toBeTruthy();
    expect(screen.getByTestId('call-ended')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Başvur' })).toBeNull();
  });

  it('shows a final "not found" for a call the app never saw, without a request', async () => {
    serveMe();
    serveDistricts();
    let reads = 0;
    mswServer.use(
      http.get(apiUrl(`/api/v1/open-calls/${CALL_2_ID}/applications`), () => {
        reads += 1;
        return problem(404, 'not_found');
      }),
    );
    openCall(CALL_2_ID);
    await render(<CallDetailScreen />, clientWithCall());
    expect(await screen.findByText('İlan bulunamadı')).toBeTruthy();
    await settle();
    expect(reads).toBe(0);
    await fireEvent.press(screen.getByRole('button', { name: 'İlanlara dön' }));
    expect(routerCalls().at(-1)).toEqual({ method: 'replace', href: '/eksik-var' });
  });

  it('shows the relationship error with its request id and retries', async () => {
    serveMe();
    serveDistricts();
    const applications = serveApplications(() => problem(500, 'internal', 'req-rel-1'));
    openCall();
    await render(<CallDetailScreen />, clientWithCall());
    expect(await screen.findByText(/req-rel-1/)).toBeTruthy();
    expect(screen.queryByTestId('apply-form')).toBeNull();
    applications.set(() => problem(404, 'not_found'));
    await fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(await screen.findByTestId('apply-form')).toBeTruthy();
  });
});

describe('match call (staff)', () => {
  function openMatchCall() {
    __setSearchParams({ matchId: MATCH_ID });
  }

  function servePublish(respond: () => Response) {
    const bodies: Record<string, unknown>[] = [];
    mswServer.use(
      http.post(apiUrl(`/api/v1/matches/${MATCH_ID}/open-call`), async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return respond();
      }),
    );
    return bodies;
  }

  it('publishes a call, then decides its applications; an acceptance refreshes the match', async () => {
    const value = match();
    const reads = serveMatch(value);
    serveTeam();
    serveMe();
    serveDistricts();
    const bodies = servePublish(() =>
      HttpResponse.json(storedCall({ missingCount: 2, position: 'GK', level: 'competitive' }), {
        status: 201,
      }),
    );
    let deniz = application(APP_ID, DENIZ_ID, 'Deniz');
    let ege = application(APP_2_ID, EGE_ID, 'Ege');
    const applications = serveApplications(page([deniz, ege]));
    servePatchApplication((body, appId) => {
      const { status } = body as { status: Application['status'] };
      if (appId === APP_ID) {
        deniz = { ...deniz, status };
      } else {
        ege = { ...ege, status };
      }
      applications.set(page([deniz, ege]));
      return HttpResponse.json(appId === APP_ID ? deniz : ege);
    });
    const client = createTestQueryClient();
    openMatchCall();
    await render(<MatchCallScreen />, client);
    expect(await screen.findByText('Kaç oyuncu eksik? (en fazla 3)')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: '4' })).toBeNull();
    await fireEvent.press(screen.getByRole('radio', { name: '2' }));
    await fireEvent.press(screen.getByTestId('publish-position-GK'));
    await fireEvent.press(screen.getByRole('radio', { name: 'Rekabetçi' }));
    await fireEvent.press(screen.getByRole('button', { name: 'İlanı yayınla' }));
    expect(await screen.findByText('Yayındaki ilan')).toBeTruthy();
    expect(bodies).toHaveLength(1);
    const body = bodies[0] ?? {};
    expect(body).toEqual({
      missingCount: 2,
      position: 'GK',
      level: 'competitive',
      expiresAt: new Date(Date.parse(value.startsAt) - HOUR).toISOString(),
    });
    expect('districtId' in body).toBe(false);
    expect(await screen.findByText('2 başvuru, 2 bekliyor')).toBeTruthy();

    const before = reads.reads();
    await fireEvent.press(screen.getByRole('button', { name: 'Deniz adlı oyuncuyu kabul et' }));
    await waitFor(() =>
      expect(screen.getByTestId(`application-${APP_ID}-status`).props.children).toBe(
        'Kabul edildi',
      ),
    );
    await waitFor(() => expect(reads.reads()).toBeGreaterThan(before));
    expect(client.getQueryData<OpenCall>(callKeys.matchCall(MATCH_ID))?.missingCount).toBe(1);

    await fireEvent.press(screen.getByRole('button', { name: 'Reddet' }));
    await fireEvent.press(lastButton('Reddet'));
    await waitFor(() =>
      expect(screen.getByTestId(`application-${APP_2_ID}-status`).props.children).toBe(
        'Reddedildi',
      ),
    );
  });

  it('closes a call it never saw after open_call_exists, then offers a new one', async () => {
    serveMatch();
    serveTeam(team('co_captain'));
    serveMe();
    serveDistricts();
    servePublish(() => problem(409, 'open_call_exists'));
    serveApplications(page([]));
    const closeBodies: unknown[] = [];
    mswServer.use(
      http.patch(apiUrl(`/api/v1/matches/${MATCH_ID}/open-call`), async ({ request }) => {
        closeBodies.push(await request.json());
        return HttpResponse.json(storedCall({ status: 'closed' }));
      }),
    );
    openMatchCall();
    await render(<MatchCallScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'İlanı yayınla' }));
    expect(await screen.findByTestId('call-exists')).toBeTruthy();
    // The publish form is hidden while a call this device cannot see is live.
    expect(screen.queryByTestId('publish-form')).toBeNull();
    expect(screen.getByTestId('publish-hidden')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'İlanı kapat' }));
    // Closing warns that pending applicants (unseen here) are rejected.
    expect(screen.getByText(/Burada göremediğin bekleyen başvurular da reddedilecek/)).toBeTruthy();
    await fireEvent.press(lastButton('İlanı kapat'));
    expect(await screen.findByTestId('last-call-status')).toBeTruthy();
    expect(closeBodies).toEqual([{ status: 'closed' }]);
    expect(screen.queryByTestId('call-exists')).toBeNull();
    expect(screen.getByText('Kapandı')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'İlanı yayınla' })).toBeTruthy();
  });

  it('recognizes a live call from the cached list, hides the form and opens the call', async () => {
    const value = match();
    serveMatch(value);
    serveTeam(team('co_captain'));
    serveMe();
    serveDistricts();
    const bodies = servePublish(() => HttpResponse.json(storedCall(), { status: 201 }));
    const listed = publicCall({
      id: CALL_2_ID,
      teamName: 'Yıldızlar FK',
      startsAt: value.startsAt,
    });
    const client = clientWithCall(listed);
    openMatchCall();
    await render(<MatchCallScreen />, client);
    expect(await screen.findByTestId('call-exists-listed')).toBeTruthy();
    expect(screen.queryByTestId('publish-form')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'İlanı ve başvuruları aç' }));
    expect(routerCalls().at(-1)).toEqual({ method: 'push', href: `/ilan/${CALL_2_ID}` });
    await settle();
    expect(bodies).toEqual([]);
  });

  it('treats a kept open call as ended once the match left open: no accept offered', async () => {
    serveMatch(match({ status: 'locked' }));
    serveTeam();
    serveMe();
    serveDistricts();
    serveApplications(page([application(APP_ID, DENIZ_ID, 'Deniz')]));
    const client = createTestQueryClient();
    client.setQueryData(callKeys.matchCall(MATCH_ID), storedCall());
    openMatchCall();
    await render(<MatchCallScreen />, client);
    expect(await screen.findByTestId('last-call-status')).toBeTruthy();
    expect(screen.getByText('Kapandı')).toBeTruthy();
    expect(await screen.findByTestId(`application-${APP_ID}`)).toBeTruthy();
    expect(screen.queryByText('Yayındaki ilan')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deniz adlı oyuncuyu kabul et' })).toBeNull();
  });

  it('shows the form only when an expiry can be chosen', async () => {
    serveMe();
    serveDistricts();
    serveTeam();
    openMatchCall();
    // 16 minutes ahead: past the 15-minute minimum but before the earliest selectable end.
    serveMatch(match({ startsAt: new Date(Date.now() + 16 * 60 * 1000).toISOString() }));
    await render(<MatchCallScreen />);
    expect(await screen.findByTestId('publish-blocked')).toBeTruthy();
    expect(screen.queryByTestId('publish-form')).toBeNull();
  });

  it('shows a decision refusal and re-reads the applications', async () => {
    serveMatch();
    serveTeam();
    serveMe();
    serveDistricts();
    const applications = serveApplications(page([application(APP_ID, DENIZ_ID, 'Deniz')]));
    servePatchApplication(() => {
      applications.set(page([application(APP_ID, DENIZ_ID, 'Deniz', { status: 'rejected' })]));
      return problem(409, 'match_full');
    });
    const client = createTestQueryClient();
    client.setQueryData(callKeys.matchCall(MATCH_ID), storedCall());
    openMatchCall();
    await render(<MatchCallScreen />, client);
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Deniz adlı oyuncuyu kabul et' }),
    );
    expect(await screen.findByText('Maç dolu.')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId(`application-${APP_ID}-status`).props.children).toBe('Reddedildi'),
    );
    expect(screen.queryByRole('button', { name: 'Deniz adlı oyuncuyu kabul et' })).toBeNull();
  });

  it('offers nothing to players and guests', async () => {
    serveMatch();
    serveTeam(team('player'));
    serveMe();
    serveDistricts();
    openMatchCall();
    await render(<MatchCallScreen />);
    expect(await screen.findByTestId('match-call-not-staff')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'İlanı yayınla' })).toBeNull();
    await act(async () => {
      await screen.unmount();
    });
    const guest: MatchGuestView = {
      projection: 'guest',
      id: MATCH_ID,
      team: { id: TEAM_ID, name: 'Yıldızlar FK' },
      venue: null,
      venueText: 'Moda Sahası',
      startsAt: inFuture(48),
      format: '7v7',
      status: 'open',
      mvpVoteClosesAt: null,
      myRsvp: { status: 'in', side: null },
      sharePerPlayerMinor: null,
      myShareMinor: null,
      mvp: null,
      participants: [],
    } as unknown as MatchGuestView;
    serveMatch(guest);
    await render(<MatchCallScreen />, createTestQueryClient());
    expect(await screen.findByTestId('match-call-not-staff')).toBeTruthy();
  });

  it('explains why a call cannot be published', async () => {
    const cases: [MatchMemberView, TeamDetail, string][] = [
      [match({ counts: { in: 14, maybe: 0, out: 0, waitlist: 0 } }), team(), 'Maçta boş yer yok.'],
      [match({ status: 'locked' }), team(), 'İlan yalnızca açık bir maç için verilebilir.'],
      [
        match({ startsAt: inFuture(0.2) }),
        team(),
        'Maça çok az kaldı; ilan en az 15 dakika yayında kalmalı.',
      ],
      [
        match(),
        team('captain', { isProLocked: true }),
        'Takım salt okunur olduğu için yeni ilan verilemez.',
      ],
    ];
    serveMe();
    serveDistricts();
    openMatchCall();
    for (const [value, detail, copy] of cases) {
      serveMatch(value);
      serveTeam(detail);
      await render(<MatchCallScreen />, createTestQueryClient());
      expect(await screen.findByText(copy)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'İlanı yayınla' })).toBeNull();
      await act(async () => {
        await screen.unmount();
      });
    }
  });
});

describe('match screen entry', () => {
  it('links staff to the match call and shows nothing to a player', async () => {
    serveMatch();
    serveTeam();
    serveMe();
    __setSearchParams({ id: TEAM_ID, matchId: MATCH_ID });
    await render(<MatchDetailScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Eksik Var ilanı' }));
    expect(routerCalls().at(-1)).toEqual({ method: 'push', href: `/ilan/mac/${MATCH_ID}` });
    await act(async () => {
      await screen.unmount();
    });
    serveTeam(team('player'));
    await render(<MatchDetailScreen />, createTestQueryClient());
    expect(await screen.findByTestId('match-status')).toBeTruthy();
    await settle();
    expect(screen.queryByRole('button', { name: 'Eksik Var ilanı' })).toBeNull();
  });
});

describe('call facts', () => {
  it.each(['light', 'dark'] as const)(
    'draws the outlined count with one empty slot per missing player (%s)',
    async (scheme) => {
      await renderWithProviders(<CallFacts call={publicCall()} place="Moda Sahası" />, {
        i18n: i18nWithCatalog(),
        scheme,
      });
      expect(screen.getByTestId('call-missing').props.accessibilityLabel).toBe('Eksik oyuncu: 2');
      expect(screen.getByLabelText('Yer: Moda Sahası')).toBeTruthy();
      expect(screen.getByLabelText('Mevki: Kaleci')).toBeTruthy();
      expect(screen.getAllByTestId(/^missing-slot-/, { includeHiddenElements: true })).toHaveLength(
        2,
      );
    },
  );

  it('shows only the figure for a count too large to draw', async () => {
    await renderWithProviders(<CallFacts call={publicCall({ missingCount: 7 })} place={null} />, {
      i18n: i18nWithCatalog(),
    });
    expect(screen.getByTestId('call-missing').props.accessibilityLabel).toBe('Eksik oyuncu: 7');
    expect(screen.queryAllByTestId(/^missing-slot-/, { includeHiddenElements: true })).toHaveLength(
      0,
    );
    expect(screen.queryByTestId('call-place')).toBeNull();
  });
});
