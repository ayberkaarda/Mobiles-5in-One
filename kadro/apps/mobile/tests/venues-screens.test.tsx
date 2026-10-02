import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native/pure';
import { dehydrate, type QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createVenueRequestSchema } from '../../../packages/contracts/src/venues';
import VenuesTab from '../app/(tabs)/sahalar/index';
import NewVenueScreen from '../app/saha/yeni';
import VenueScreen from '../app/saha/[slug]';
import CreateMatchScreen from '../app/takim/[id]/mac/yeni';
import { session } from '../src/api/instance';
import { type MeResponse, type TeamDetail } from '../src/api/contracts';
import { type DistrictPublic } from '../src/calls/contracts';
import { createQueryPersister, persistOptions } from '../src/query/persistence';
import {
  type TeamSummary,
  type VenueDetail,
  type VenueReview,
  type VenueSummary,
} from '../src/venues/contracts';
import { openDialer } from '../src/venues/dial';
import { venueFacts, venueKeys } from '../src/venues/queries';
import { NO_VENUE_FILTERS } from '../src/venues/venues-api';
import { issueTokens, problem } from './support/api';
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

// The dialer is a native hand-off; the test records the link instead.
vi.mock('../src/venues/dial', () => ({ openDialer: vi.fn() }));

const VENUE_ID = '0192a0b0-0000-7000-8000-0000000000e1';
const SAMPLE_ID = '0192a0b0-0000-7000-8000-0000000000e2';
const MINE_ID = '0192a0b0-0000-7000-8000-0000000000e3';
const KADIKOY_ID = '0192a0b0-0000-7000-8000-0000000000d1';
const CANKAYA_ID = '0192a0b0-0000-7000-8000-0000000000d2';
const TEAM_ID = '0192a0b0-0000-7000-8000-000000000001';
const TEAM_2_ID = '0192a0b0-0000-7000-8000-000000000002';
const ME_ID = '0192a0b0-0000-7000-8000-0000000000f1';
const R1 = '0192a0b0-0000-7000-8000-0000000000b1';
const R2 = '0192a0b0-0000-7000-8000-0000000000b2';
const R3 = '0192a0b0-0000-7000-8000-0000000000b3';
const OWN = '0192a0b0-0000-7000-8000-0000000000b9';
const SLUG = 'moda-sahasi-kadikoy';

/** Copy of the error catalog (`errors.json`) as the screens read it; the real file ships separately. */
const ERROR_CATALOG = {
  network_error: 'Bağlantı kurulamadı. İnternet bağlantını kontrol edip tekrar dene.',
  server_error: 'Sunucuda bir sorun oluştu.',
  unknown: 'Bir sorun oluştu. Biraz sonra tekrar dene.',
};

function render(ui: ReactElement, queryClient: QueryClient = createTestQueryClient()) {
  const resources = appResources();
  const i18n = createTestI18n('tr', {
    ...resources,
    tr: { ...resources.tr, errors: ERROR_CATALOG },
  });
  return renderWithProviders(ui, { i18n, queryClient });
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

function summary(overrides: Partial<VenueSummary> = {}): VenueSummary {
  return {
    id: VENUE_ID,
    name: 'Moda Sahası',
    slug: SLUG,
    districtId: KADIKOY_ID,
    location: { latitude: 40.98, longitude: 29.03 },
    indoor: false,
    priceMinMinor: 120_000,
    priceMaxMinor: 180_000,
    verified: true,
    isSample: false,
    rating: { average: 4.3, count: 3 },
    ...overrides,
  };
}

function review(id: string, name: string, createdAt: string, text: string | null): VenueReview {
  return { id, authorDisplayName: name, rating: 4, text, createdAt };
}

function detail(overrides: Partial<VenueDetail> = {}): VenueDetail {
  return {
    ...summary(),
    address: 'Moda Cd. 1',
    phone: '0216 000 00 00',
    features: { lighting: true, parking: false },
    // Deliberately not newest first: the screen must not rely on the server order.
    recentReviews: [
      review(R1, 'Deniz', '2026-09-01T10:00:00.000Z', 'Eski yorum'),
      review(R3, 'Ege', '2026-10-01T10:00:00.000Z', '<img src=x onerror=alert(1)> **kalın**'),
      review(R2, 'Can', '2026-09-15T10:00:00.000Z', null),
    ],
    myReview: null,
    ...overrides,
  };
}

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
    ...overrides,
  };
}

function team(overrides: Partial<TeamSummary> = {}): TeamSummary {
  return {
    id: TEAM_ID,
    name: 'Yıldızlar FK',
    slug: 'yildizlar-fk',
    badgeUrl: null,
    districtId: KADIKOY_ID,
    myRole: 'captain',
    memberCount: 5,
    isProLocked: false,
    createdAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

function serveDistricts() {
  mswServer.use(
    http.get(apiUrl('/api/v1/districts'), () => HttpResponse.json({ items: DISTRICTS })),
  );
}

function serveMe(respond: () => Response = () => HttpResponse.json(me())) {
  mswServer.use(http.get(apiUrl('/api/v1/me'), respond));
}

function serveTeams(
  respond: () => Response = () => HttpResponse.json({ items: [team()], nextCursor: null }),
) {
  mswServer.use(http.get(apiUrl('/api/v1/teams'), respond));
}

/** `GET venues` recording the query string of each read. */
function serveList(
  respond: (url: URL) => Response = () =>
    HttpResponse.json({ items: [summary()], nextCursor: null }),
) {
  const queries: string[] = [];
  mswServer.use(
    http.get(apiUrl('/api/v1/venues'), ({ request }) => {
      const url = new URL(request.url);
      queries.push(url.search);
      return respond(url);
    }),
  );
  return queries;
}

/** `GET venues/:slug` answering the current state. */
function serveDetail(initial: () => Response = () => HttpResponse.json(detail())) {
  let respond = initial;
  let reads = 0;
  mswServer.use(
    http.get(apiUrl('/api/v1/venues/:slug'), () => {
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

/** Every request to the review endpoints, in order. */
function serveReviewWrites(handlers: { post?: (body: unknown) => Response; del?: () => Response }) {
  const log: { method: string; body: unknown }[] = [];
  mswServer.use(
    http.post(apiUrl(`/api/v1/venues/${SLUG}/reviews`), async ({ request }) => {
      const body: unknown = await request.json();
      log.push({ method: 'POST', body });
      return (
        handlers.post?.(body) ??
        HttpResponse.json(review(OWN, 'Ali', '2026-10-03T10:00:00.000Z', 'Yeni'), { status: 201 })
      );
    }),
    http.delete(apiUrl(`/api/v1/venues/${SLUG}/reviews/mine`), () => {
      log.push({ method: 'DELETE', body: null });
      return handlers.del?.() ?? new HttpResponse(null, { status: 204 });
    }),
  );
  return log;
}

function serveVenueScreen(options: { detail?: VenueDetail } = {}) {
  serveDistricts();
  serveMe();
  serveTeams();
  return serveDetail(() => HttpResponse.json(options.detail ?? detail()));
}

/** The first or last button with this name (an empty state repeats a header action). */
function button(name: string, which: 'first' | 'last') {
  const buttons = screen.getAllByRole('button', { name });
  const found = which === 'first' ? buttons[0] : buttons.at(-1);
  if (found === undefined) {
    throw new Error(`no button ${name}`);
  }
  return found;
}

async function settle(ms = 50): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

beforeEach(async () => {
  vi.mocked(openDialer).mockClear();
  await session.establish(issueTokens());
});

describe('Sahalar tab', () => {
  it('lists venues with sample and unverified labels and the rating rule, and opens one', async () => {
    serveDistricts();
    serveList(() =>
      HttpResponse.json({
        items: [
          summary(),
          summary({
            id: SAMPLE_ID,
            name: '[ÖRNEK] Kadıköy Halı Saha A',
            slug: 'ornek-kadikoy-hali-saha-a',
            isSample: true,
            rating: { average: 5, count: 2 },
          }),
          summary({
            id: MINE_ID,
            name: 'Benim Saham',
            slug: 'benim-saham-kadikoy',
            verified: false,
            indoor: true,
            priceMinMinor: null,
            priceMaxMinor: null,
            rating: { average: null, count: 0 },
          }),
        ],
        nextCursor: null,
      }),
    );
    await render(<VenuesTab />);
    expect(await screen.findByText('Moda Sahası')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText('Kadıköy, İstanbul · Açık · ₺1.200–₺1.800')).toBeTruthy(),
    );
    expect(screen.getByText('4,3 / 5 · 3 yorum')).toBeTruthy();
    expect(screen.getByText('[ÖRNEK] Kadıköy Halı Saha A')).toBeTruthy();
    expect(screen.getByText(/^\[ÖRNEK\] Gerçek saha değil · Kadıköy/)).toBeTruthy();
    // Two reviews: no average yet, even a perfect one.
    expect(screen.getByText('2 yorum (puan en az 3 yorumla gösterilir)')).toBeTruthy();
    expect(screen.getByText('Doğrulanmamış · Kadıköy, İstanbul · Kapalı')).toBeTruthy();
    expect(screen.getByText('Henüz yorum yok')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`venue-${SAMPLE_ID}`));
    expect(routerCalls().at(-1)).toEqual({
      method: 'push',
      href: '/saha/ornek-kadikoy-hali-saha-a',
    });
  });

  it('searches by name and filters by a searched district; a too short term sends nothing', async () => {
    serveDistricts();
    const queries = serveList((url) =>
      HttpResponse.json({
        items: url.searchParams.has('district') ? [] : [summary()],
        nextCursor: null,
      }),
    );
    await render(<VenuesTab />);
    expect(await screen.findByText('Moda Sahası')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Saha ara'), 'm');
    await fireEvent.press(screen.getByRole('button', { name: 'Ara' }));
    expect(await screen.findByText('En az 2 karakter yaz.')).toBeTruthy();
    await settle();
    expect(queries).toEqual(['?limit=20']);
    await fireEvent.changeText(screen.getByLabelText('Saha ara'), '  moda ');
    await fireEvent.press(screen.getByRole('button', { name: 'Ara' }));
    await waitFor(() => expect(queries).toHaveLength(2));
    await fireEvent.press(screen.getByRole('button', { name: 'İlçe seç' }));
    await fireEvent.changeText(screen.getByLabelText('İlçe ara'), 'çan');
    await fireEvent.press(await screen.findByRole('radio', { name: 'Çankaya, Ankara' }));
    expect(await screen.findByText('Bu aramaya uyan saha yok')).toBeTruthy();
    expect(queries).toEqual([
      '?limit=20',
      '?limit=20&q=moda',
      `?limit=20&district=${CANKAYA_ID}&q=moda`,
    ]);
    expect(screen.getByRole('button', { name: 'Çankaya, Ankara' })).toBeTruthy();
    await fireEvent.press(button('Filtreleri temizle', 'last'));
    expect(await screen.findByText('Moda Sahası')).toBeTruthy();
  });

  it('shows the error with its request id and retries', async () => {
    serveDistricts();
    let fail = true;
    serveList(() =>
      fail
        ? problem(500, 'internal', 'req-venues-1')
        : HttpResponse.json({ items: [summary()], nextCursor: null }),
    );
    await render(<VenuesTab />);
    expect(await screen.findByText('Sunucuda bir sorun oluştu.')).toBeTruthy();
    expect(screen.getByText(/req-venues-1/)).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(await screen.findByText('Moda Sahası')).toBeTruthy();
  });

  it('shows the saved list with a notice when the refresh fails', async () => {
    serveDistricts();
    serveList(() => HttpResponse.error());
    const client = createTestQueryClient();
    client.setQueryData(venueKeys.list(NO_VENUE_FILTERS), {
      pages: [{ items: [summary()], nextCursor: null }],
      pageParams: [undefined],
    });
    await client.invalidateQueries({ queryKey: venueKeys.lists(), refetchType: 'none' });
    await render(<VenuesTab />, client);
    expect(await screen.findByText('Moda Sahası')).toBeTruthy();
    expect(
      await screen.findByText('Bağlantı yok. Son kaydedilen bilgileri görüyorsun.'),
    ).toBeTruthy();
  });

  it('shows an empty directory with the add action', async () => {
    serveDistricts();
    serveList(() => HttpResponse.json({ items: [], nextCursor: null }));
    await render(<VenuesTab />);
    expect(await screen.findByText('Henüz saha yok')).toBeTruthy();
    await fireEvent.press(button('Saha ekle', 'last'));
    expect(routerCalls().at(-1)).toEqual({ method: 'push', href: '/saha/yeni' });
  });
});

describe('venue detail', () => {
  it('shows facts, labels, the price in lira, a tel: link and the reviews as plain text, newest first', async () => {
    __setSearchParams({ slug: SLUG });
    serveVenueScreen({ detail: detail({ isSample: true, name: '[ÖRNEK] Moda' }) });
    await render(<VenueScreen />);
    expect(await screen.findByText('[ÖRNEK] Moda')).toBeTruthy();
    expect(screen.getByTestId('badge-sample')).toBeTruthy();
    expect(screen.getByTestId('venue-sample-notice')).toBeTruthy();
    expect(screen.getByTestId('badge-verified')).toBeTruthy();
    expect(screen.queryByTestId('venue-unverified-notice')).toBeNull();
    expect(screen.getByLabelText('Saatlik ücret: ₺1.200–₺1.800')).toBeTruthy();
    expect(screen.getByLabelText('Saha tipi: Açık')).toBeTruthy();
    expect(screen.getByLabelText('Puan: 4,3 / 5 · 3 yorum')).toBeTruthy();
    expect(screen.getByLabelText('Var: Aydınlatma')).toBeTruthy();
    expect(screen.getByLabelText('Yok: Otopark')).toBeTruthy();
    expect(screen.getByLabelText('Bilinmiyor: Soyunma odası, Duş')).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText('İlçe: Kadıköy, İstanbul')).toBeTruthy());
    await fireEvent.press(screen.getByRole('link', { name: 'Ara: 0216 000 00 00' }));
    expect(openDialer).toHaveBeenCalledWith('tel:02160000000');

    const list = await screen.findByTestId('reviews-list');
    const ids = within(list)
      .getAllByTestId(/^review-[0-9a-f-]+$/)
      .map((node) => String(node.props.testID));
    expect(ids).toEqual([`review-${R3}`, `review-${R2}`, `review-${R1}`]);
    // Untrusted text is rendered as it is: no markup, no link.
    expect(screen.getByTestId(`review-${R3}-text`).props.children).toBe(
      '<img src=x onerror=alert(1)> **kalın**',
    );
  });

  it('shows an unknown slug as not found without any request', async () => {
    __setSearchParams({ slug: 'Not A Slug' });
    serveDistricts();
    const server = serveDetail();
    await render(<VenueScreen />);
    expect(await screen.findByText('Saha bulunamadı')).toBeTruthy();
    await settle();
    expect(server.reads()).toBe(0);
  });

  it('shows a 404 as final not found and drops the kept copy', async () => {
    __setSearchParams({ slug: SLUG });
    serveDistricts();
    serveMe();
    serveTeams();
    serveDetail(() => problem(404, 'not_found'));
    const client = createTestQueryClient();
    client.setQueryData(venueKeys.facts(SLUG), venueFacts(detail()));
    await render(<VenueScreen />, client);
    expect(await screen.findByText('Saha bulunamadı')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tekrar dene' })).toBeNull();
    await waitFor(() => expect(client.getQueryData(venueKeys.facts(SLUG))).toBeUndefined());
  });

  it('shows the saved facts offline, without reviews, and offers a retry', async () => {
    __setSearchParams({ slug: SLUG });
    serveDistricts();
    serveMe();
    serveTeams();
    const server = serveDetail(() => HttpResponse.error());
    const client = createTestQueryClient();
    client.setQueryData(venueKeys.facts(SLUG), venueFacts(detail()));
    await render(<VenueScreen />, client);
    expect(await screen.findByTestId('reviews-offline')).toBeTruthy();
    expect(screen.getByText('Moda Sahası')).toBeTruthy();
    expect(screen.getByTestId('cached-notice')).toBeTruthy();
    expect(screen.queryByText('Eski yorum')).toBeNull();
    server.set(() => HttpResponse.json(detail()));
    await fireEvent.press(screen.getByTestId('reviews-retry'));
    expect(await screen.findByText('Eski yorum')).toBeTruthy();
  });

  it('shows an error with request id and retry when nothing is saved', async () => {
    __setSearchParams({ slug: SLUG });
    serveDistricts();
    serveMe();
    serveTeams();
    const server = serveDetail(() => problem(503, 'unavailable', 'req-venue-9'));
    await render(<VenueScreen />);
    expect(await screen.findByText('Sunucuda bir sorun oluştu.')).toBeTruthy();
    expect(screen.getByText(/req-venue-9/)).toBeTruthy();
    server.set(() => HttpResponse.json(detail()));
    await fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(await screen.findByText('Moda Sahası')).toBeTruthy();
  });

  it('never writes review texts to the device cache', async () => {
    __setSearchParams({ slug: SLUG });
    serveVenueScreen({
      detail: detail({
        myReview: review(OWN, 'Ali', '2026-10-02T10:00:00.000Z', 'Benim gizli notum'),
      }),
    });
    const client = createTestQueryClient();
    await render(<VenueScreen />, client);
    expect(await screen.findByText('Eski yorum')).toBeTruthy();
    const storage = {
      getItem: () => Promise.resolve(null),
      setItem: () => Promise.resolve(),
      removeItem: () => Promise.resolve(),
    };
    const options = persistOptions(createQueryPersister(storage), 'v1:test');
    const written = JSON.stringify(dehydrate(client, options.dehydrateOptions));
    expect(written).toContain('Moda Cd. 1');
    expect(written).not.toContain('Eski yorum');
    expect(written).not.toContain('onerror');
    expect(written).not.toContain('Benim gizli notum');
  });

  it('shows the unverified notice of an own suggested venue', async () => {
    __setSearchParams({ slug: SLUG });
    serveVenueScreen({ detail: detail({ verified: false, recentReviews: [] }) });
    await render(<VenueScreen />);
    expect(await screen.findByTestId('venue-unverified-notice')).toBeTruthy();
    expect(screen.getByTestId('badge-unverified')).toBeTruthy();
    expect(await screen.findByTestId('reviews-empty')).toBeTruthy();
  });
});

describe('venue reviews', () => {
  it('writes a review: body checked first, then sent and shown as the own review', async () => {
    __setSearchParams({ slug: SLUG });
    const server = serveVenueScreen();
    const log = serveReviewWrites({});
    await render(<VenueScreen />);
    expect(await screen.findByTestId('review-form')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Yorumu gönder' }));
    expect(await screen.findByText('1 ile 5 arasında bir puan seç.')).toBeTruthy();
    expect(log).toEqual([]);
    await fireEvent.press(screen.getByRole('radio', { name: '5 üzerinden 4' }));
    await fireEvent.changeText(
      screen.getByLabelText('Yorumun (isteğe bağlı)'),
      '  Zemin iyi \r\n ',
    );
    server.set(() =>
      HttpResponse.json(
        detail({ myReview: review(OWN, 'Ali', '2026-10-03T10:00:00.000Z', 'Zemin iyi') }),
      ),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Yorumu gönder' }));
    expect(await screen.findByTestId('own-review')).toBeTruthy();
    expect(log).toEqual([{ method: 'POST', body: { rating: 4, text: 'Zemin iyi' } }]);
  });

  it('explains review_not_eligible and the daily limit, keeping the text', async () => {
    __setSearchParams({ slug: SLUG });
    serveVenueScreen();
    let answer: () => Response = () => problem(403, 'review_not_eligible', 'req-r-1');
    serveReviewWrites({ post: () => answer() });
    await render(<VenueScreen />);
    await fireEvent.press(await screen.findByRole('radio', { name: '5 üzerinden 5' }));
    await fireEvent.changeText(screen.getByLabelText('Yorumun (isteğe bağlı)'), 'Harika');
    await fireEvent.press(screen.getByRole('button', { name: 'Yorumu gönder' }));
    expect(
      await screen.findByText(
        'Bu sahaya yorum yazmak için burada oynanmış bir maçta "Geliyorum" demiş olman gerekir.',
      ),
    ).toBeTruthy();
    expect(screen.getByText(/req-r-1/)).toBeTruthy();
    expect(screen.getByLabelText('Yorumun (isteğe bağlı)').props.value).toBe('Harika');
    answer = () => problem(429, 'rate_limited');
    await fireEvent.press(screen.getByRole('button', { name: 'Yorumu gönder' }));
    expect(
      await screen.findByText('Bugün için yorum sınırına ulaştın. Yarın tekrar dene.'),
    ).toBeTruthy();
  });

  it('re-reads the venue after already_reviewed and shows the own review', async () => {
    __setSearchParams({ slug: SLUG });
    const server = serveVenueScreen();
    serveReviewWrites({ post: () => problem(409, 'already_reviewed') });
    await render(<VenueScreen />);
    await fireEvent.press(await screen.findByRole('radio', { name: '5 üzerinden 3' }));
    server.set(() =>
      HttpResponse.json(
        detail({ myReview: review(OWN, 'Ali', '2026-10-01T10:00:00.000Z', 'Önceki') }),
      ),
    );
    const before = server.reads();
    await fireEvent.press(screen.getByRole('button', { name: 'Yorumu gönder' }));
    expect(await screen.findByTestId('own-review')).toBeTruthy();
    expect(server.reads()).toBeGreaterThan(before);
  });

  it('deletes the own review only after confirming', async () => {
    __setSearchParams({ slug: SLUG });
    const server = serveVenueScreen({
      detail: detail({
        myReview: review(OWN, 'Ali', '2026-10-02T10:00:00.000Z', 'Benim'),
        recentReviews: [review(OWN, 'Ali', '2026-10-02T10:00:00.000Z', 'Benim')],
      }),
    });
    const log = serveReviewWrites({});
    await render(<VenueScreen />);
    expect(await screen.findByTestId('own-review')).toBeTruthy();
    // The own review is not listed a second time among the others.
    expect(screen.getByTestId('reviews-empty')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Yorumu sil' }));
    expect(log).toEqual([]);
    server.set(() => HttpResponse.json(detail()));
    await fireEvent.press(screen.getByRole('button', { name: 'Evet, sil' }));
    expect(await screen.findByTestId('review-form')).toBeTruthy();
    expect(log).toEqual([{ method: 'DELETE', body: null }]);
  });

  it('rewrites as delete then create, and keeps the text when the create is refused', async () => {
    __setSearchParams({ slug: SLUG });
    const server = serveVenueScreen({
      detail: detail({ myReview: review(OWN, 'Ali', '2026-10-02T10:00:00.000Z', 'Eski metin') }),
    });
    const log = serveReviewWrites({ post: () => problem(429, 'rate_limited') });
    await render(<VenueScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Yorumu yeniden yaz' }));
    expect(screen.getByTestId('review-rewrite-notice')).toBeTruthy();
    expect(screen.getByLabelText('Yorumun (isteğe bağlı)').props.value).toBe('Eski metin');
    await fireEvent.changeText(screen.getByLabelText('Yorumun (isteğe bağlı)'), 'Yeni metin');
    // The re-read fails too: only the app's own bookkeeping can tell that the old review is gone.
    server.set(() => HttpResponse.error());
    await fireEvent.press(screen.getByRole('button', { name: 'Sil ve yenisini gönder' }));
    expect(await screen.findByTestId('rewrite-deleted')).toBeTruthy();
    expect(log.map((entry) => entry.method)).toEqual(['DELETE', 'POST']);
    expect(log[1]?.body).toEqual({ rating: 4, text: 'Yeni metin' });
    // The old review is gone; the form offers the typed text as a new review.
    expect(screen.queryByTestId('own-review')).toBeNull();
    expect(screen.getByLabelText('Yorumun (isteğe bağlı)').props.value).toBe('Yeni metin');
    expect(screen.getByRole('button', { name: 'Yorumu gönder' })).toBeTruthy();
  });

  it('asks for a verified email before writing, but still lets the author delete', async () => {
    __setSearchParams({ slug: SLUG });
    serveDistricts();
    serveTeams();
    serveMe(() => HttpResponse.json(me({ emailVerified: false })));
    const server = serveDetail(() => HttpResponse.json(detail()));
    await render(<VenueScreen />);
    expect(await screen.findByTestId('review-unverified')).toBeTruthy();
    expect(screen.queryByTestId('review-form')).toBeNull();
    server.set(() =>
      HttpResponse.json(
        detail({ myReview: review(OWN, 'Ali', '2026-10-02T10:00:00.000Z', 'Benim') }),
      ),
    );
    await act(async () => {
      await screen.unmount();
    });
    await render(<VenueScreen />);
    expect(await screen.findByTestId('own-review')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Yorumu sil' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Yorumu yeniden yaz' })).toBeNull();
  });

  it('offers a retry, not "verify your email", when the account cannot be loaded', async () => {
    __setSearchParams({ slug: SLUG });
    serveDistricts();
    serveTeams();
    let fail = true;
    serveMe(() => (fail ? problem(503, 'unavailable', 'req-me-1') : HttpResponse.json(me())));
    serveDetail(() => HttpResponse.json(detail()));
    await render(<VenueScreen />);
    expect(await screen.findByTestId('review-me-error')).toBeTruthy();
    expect(screen.queryByTestId('review-unverified')).toBeNull();
    fail = false;
    await fireEvent.press(button('Tekrar dene', 'last'));
    expect(await screen.findByTestId('review-form')).toBeTruthy();
  });
});

describe('match at this venue', () => {
  it('opens the create-match screen of the only staff team with the venue id', async () => {
    __setSearchParams({ slug: SLUG });
    serveVenueScreen();
    await render(<VenueScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Bu sahada maç kur' }));
    expect(routerCalls().at(-1)).toEqual({
      method: 'push',
      href: `/takim/${TEAM_ID}/mac/yeni?venue=${VENUE_ID}`,
    });
  });

  it('asks which team when several are possible, and skips player and read-only teams', async () => {
    __setSearchParams({ slug: SLUG });
    serveDistricts();
    serveMe();
    serveTeams(() =>
      HttpResponse.json({
        items: [
          team(),
          team({ id: TEAM_2_ID, name: 'Moda Gençlik', myRole: 'co_captain' }),
          team({ id: 'p', name: 'Oyuncu Takımı', myRole: 'player' }),
          team({ id: 'l', name: 'Kilitli', isProLocked: true }),
        ],
        nextCursor: null,
      }),
    );
    serveDetail();
    await render(<VenueScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Bu sahada maç kur' }));
    expect(screen.getByRole('button', { name: 'Yıldızlar FK ile kur' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Oyuncu Takımı ile kur' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Kilitli ile kur' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Moda Gençlik ile kur' }));
    expect(routerCalls().at(-1)).toEqual({
      method: 'push',
      href: `/takim/${TEAM_2_ID}/mac/yeni?venue=${VENUE_ID}`,
    });
  });

  it('says why when no team allows it, and offers a retry when the teams fail', async () => {
    __setSearchParams({ slug: SLUG });
    serveDistricts();
    serveMe();
    let respond: () => Response = () => problem(503, 'unavailable');
    serveTeams(() => respond());
    serveDetail();
    await render(<VenueScreen />);
    expect(await screen.findByTestId('match-here-teams-error')).toBeTruthy();
    expect(screen.queryByTestId('match-here-none')).toBeNull();
    respond = () => HttpResponse.json({ items: [team({ myRole: 'player' })], nextCursor: null });
    await fireEvent.press(button('Tekrar dene', 'first'));
    expect(await screen.findByTestId('match-here-none')).toBeTruthy();
  });

  it('prefills the create-match form with the cached venue, never a name from the link', async () => {
    const detailTeam: TeamDetail = { ...team(), members: [] };
    mswServer.use(
      http.get(apiUrl(`/api/v1/teams/${TEAM_ID}`), () => HttpResponse.json(detailTeam)),
    );
    const client = createTestQueryClient();
    client.setQueryData(venueKeys.facts(SLUG), venueFacts(detail()));
    __setSearchParams({ id: TEAM_ID, venue: VENUE_ID, venueName: 'Sahte Saha' });
    await render(<CreateMatchScreen />, client);
    expect(await screen.findByText('Seçilen saha: Moda Sahası')).toBeTruthy();
    await act(async () => {
      await screen.unmount();
    });
    __setSearchParams({ id: TEAM_ID, venue: '0192a0b0-0000-7000-8000-0000000000ff' });
    await render(<CreateMatchScreen />, client);
    expect(await screen.findByTestId('create-match-screen')).toBeTruthy();
    await settle();
    expect(screen.queryByTestId('venue-picked')).toBeNull();
    expect(screen.queryByText(/Sahte Saha/)).toBeNull();
  });
});

describe('add a venue', () => {
  it('says the venue is created unverified and checks every field before sending', async () => {
    serveDistricts();
    serveMe();
    const bodies: unknown[] = [];
    mswServer.use(
      http.post(apiUrl('/api/v1/venues'), async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(
          detail({ slug: 'yeni-saha-kadikoy', verified: false, recentReviews: [] }),
          { status: 201 },
        );
      }),
    );
    await render(<NewVenueScreen />);
    expect(await screen.findByTestId('new-venue-unverified-notice')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Sahayı gönder' }));
    expect(await screen.findByText('Bir ilçe seç.')).toBeTruthy();
    expect(screen.getByText('Saha adı en az 2 karakter olmalı.')).toBeTruthy();
    expect(screen.getByText('Sahanın kapalı mı açık mı olduğunu seç.')).toBeTruthy();
    expect(bodies).toEqual([]);

    await fireEvent.changeText(screen.getByLabelText('Sahanın adı'), 'Yeni Saha');
    await fireEvent.changeText(screen.getByLabelText('İlçe ara'), 'kad');
    await fireEvent.press(await screen.findByRole('radio', { name: 'Kadıköy, İstanbul' }));
    await fireEvent.changeText(
      screen.getByLabelText('Konum (enlem, boylam)'),
      '40.98765, 29.02345',
    );
    await fireEvent.press(screen.getByRole('radio', { name: 'Kapalı' }));
    await fireEvent.changeText(
      screen.getByLabelText('En düşük saatlik ücret (TL, isteğe bağlı)'),
      '1.500',
    );
    const lighting = screen.getByTestId('new-venue-feature-lighting');
    await fireEvent.press(within(lighting).getByRole('radio', { name: 'Var' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Sahayı gönder' }));
    await waitFor(() =>
      expect(routerCalls().at(-1)).toEqual({ method: 'replace', href: '/saha/yeni-saha-kadikoy' }),
    );
    expect(bodies).toEqual([
      {
        name: 'Yeni Saha',
        districtId: KADIKOY_ID,
        location: { latitude: 40.98765, longitude: 29.02345 },
        indoor: true,
        features: { lighting: true },
        priceMinMinor: 150_000,
      },
    ]);
    expect(createVenueRequestSchema.safeParse(bodies[0]).success).toBe(true);
  });

  it('explains venue_exists and the daily limit', async () => {
    serveDistricts();
    serveMe();
    let answer: () => Response = () => problem(409, 'venue_exists', 'req-v-1');
    mswServer.use(http.post(apiUrl('/api/v1/venues'), () => answer()));
    await render(<NewVenueScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Sahanın adı'), 'Moda Sahası');
    await fireEvent.changeText(screen.getByLabelText('İlçe ara'), 'kad');
    await fireEvent.press(await screen.findByRole('radio', { name: 'Kadıköy, İstanbul' }));
    await fireEvent.changeText(screen.getByLabelText('Konum (enlem, boylam)'), '41, 29');
    await fireEvent.press(screen.getByRole('radio', { name: 'Açık' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Sahayı gönder' }));
    expect(
      await screen.findByText('Bu ilçede bu adla bir saha zaten var. Listede adıyla aramayı dene.'),
    ).toBeTruthy();
    expect(screen.getByText(/req-v-1/)).toBeTruthy();
    answer = () => problem(429, 'rate_limited');
    await fireEvent.press(screen.getByRole('button', { name: 'Sahayı gönder' }));
    expect(
      await screen.findByText('Bugün için saha ekleme sınırına ulaştın. Yarın tekrar dene.'),
    ).toBeTruthy();
    expect(routerCalls()).toEqual([]);
  });

  it('asks for a verified email first, and offers a retry when the account fails', async () => {
    serveDistricts();
    let respond: () => Response = () => problem(503, 'unavailable');
    serveMe(() => respond());
    await render(<NewVenueScreen />);
    expect(await screen.findByTestId('new-venue-me-error')).toBeTruthy();
    respond = () => HttpResponse.json(me({ emailVerified: false }));
    await fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(await screen.findByTestId('new-venue-unverified')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sahayı gönder' })).toBeNull();
  });
});
