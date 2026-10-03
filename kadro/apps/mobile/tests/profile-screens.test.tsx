import { createHash } from 'node:crypto';

import { fireEvent, screen, waitFor } from '@testing-library/react-native/pure';
import { type QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { type ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteAccountRequestSchema,
  updateMeRequestSchema,
} from '../../../packages/contracts/src/users';
import { NO_ENTITLEMENTS } from '../../../packages/contracts/src/billing';
import SignInScreen from '../app/(auth)/giris';
import ProfileTab from '../app/(tabs)/profil/index';
import DeletionNoticeScreen from '../app/ayarlar/hesap-silindi';
import DeleteAccountScreen from '../app/ayarlar/hesabi-sil';
import SettingsScreen from '../app/ayarlar/index';
import EditProfileScreen from '../app/profil/duzenle';
import { session } from '../src/api/instance';
import { type DistrictPublic } from '../src/calls/contracts';
import { callKeys } from '../src/calls/queries';
import { type AvatarPicker } from '../src/profile/avatar-upload';
import { type MeResponse, type MeStatsResponse } from '../src/profile/contracts';
import { profileKeys } from '../src/profile/queries';
import { queryKeys } from '../src/query/keys';
import WelcomeScreen from '../app/index';
import { authStore } from '../src/auth-store/store';
import { NO_DELETION_NOTICE } from '../src/settings/deletion';
import { pushStore } from '../src/settings/instance';
import { darkTheme, lightTheme } from '../src/theme';
import { deletionNotice } from '../src/settings/notice';
import { type LegalLink } from '../src/settings/legal';
import { type PushPermission, type PushPort } from '../src/settings/push';
import { issueTokens, problem } from './support/api';
import { asyncStorageContents } from './support/async-storage';
import { deferred } from './support/deferred';
import { __scriptApple, appleSignInCalls } from './support/expo-apple-authentication';
import { __resetOpenedURLs, openedURLs } from './support/expo-linking';
import { routerCalls } from './support/expo-router';
import { secureStoreContents } from './support/expo-secure-store';
import { createTestI18n } from './support/i18n';
import { apiUrl, mswServer } from './support/msw';
import { createTestQueryClient, renderWithProviders } from './support/render';

const holder = vi.hoisted(() => ({
  picker: null as AvatarPicker | null,
  legal: [] as LegalLink[],
  push: null as PushPort | null,
}));

vi.mock('expo-image', () => import('./support/expo-image'));

// The settings screen links to the store's subscription page through the billing port; no store
// is reachable in these tests.
vi.mock('../src/billing/instance', async () => {
  const { unavailableBillingPort } = await import('../src/billing/port');
  return { billing: unavailableBillingPort };
});

// The screens use the app's API client; here it is wired to the MSW base URL.
vi.mock('../src/api/instance', async () => {
  const { createTestApi } = await import('./support/api');
  const { api, session: testSession } = createTestApi();
  return { api, session: testSession };
});

// Profile calls on that client; the image picker is set per test (the app has none).
vi.mock('../src/profile/instance', async () => {
  const { api } = await import('../src/api/instance');
  const { createProfileApi } = await import('../src/profile/profile-api');
  return {
    profileApi: createProfileApi(api),
    get avatarPicker() {
      return holder.picker;
    },
  };
});

// Settings wiring without the native push module and the build-time web origin.
vi.mock('../src/settings/instance', async () => {
  const { createPushStore } = await import('../src/settings/push');
  return {
    get appLegalLinks() {
      return holder.legal;
    },
    get pushPort() {
      return holder.push;
    },
    pushStore: createPushStore(),
  };
});

const ME_ID = '0192a0b0-0000-7000-8000-0000000000f1';
const KADIKOY_ID = '0192a0b0-0000-7000-8000-0000000000d1';
const CANKAYA_ID = '0192a0b0-0000-7000-8000-0000000000d2';
const UPLOAD_ID = '0192a0b0-0000-7000-8000-0000000000a9';
const STORAGE_URL = 'https://incoming.storage.test.invalid/avatar/object?signature=abc';
const GRACE_UNTIL = '2026-10-10T10:00:00.000Z';

/** Only the shipped copy: there is no error catalog file on this branch (generic fallback). */
const GENERIC_ERROR = 'Bir sorun oluştu. Biraz sonra tekrar dene.';

function render(ui: ReactElement, queryClient: QueryClient = createTestQueryClient()) {
  return renderWithProviders(ui, { i18n: createTestI18n(), queryClient });
}

function me(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    id: ME_ID,
    displayName: 'Ali Kaleci',
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

function serveMe(profile: MeResponse = me()) {
  let reads = 0;
  mswServer.use(
    http.get(apiUrl('/api/v1/me'), () => {
      reads += 1;
      return HttpResponse.json(profile);
    }),
  );
  return { reads: () => reads };
}

function serveDistricts() {
  mswServer.use(
    http.get(apiUrl('/api/v1/districts'), () => HttpResponse.json({ items: DISTRICTS })),
  );
}

function serveStats(stats: MeStatsResponse = { tier: 'basic', matchesPlayed: 7, mvpCount: 2 }) {
  mswServer.use(http.get(apiUrl('/api/v1/me/stats'), () => HttpResponse.json(stats)));
}

function servePatch(answer: (body: Record<string, unknown>) => Response) {
  const bodies: Record<string, unknown>[] = [];
  mswServer.use(
    http.patch(apiUrl('/api/v1/me'), async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      return answer(body);
    }),
  );
  return bodies;
}

function serveDelete(answer: (body: Record<string, unknown>) => Response) {
  const bodies: Record<string, unknown>[] = [];
  mswServer.use(
    http.delete(apiUrl('/api/v1/me'), async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      return answer(body);
    }),
  );
  return bodies;
}

function countLogout() {
  let calls = 0;
  mswServer.use(
    http.post(apiUrl('/api/v1/auth/logout'), () => {
      calls += 1;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return () => calls;
}

function countRefresh() {
  let calls = 0;
  mswServer.use(
    http.post(apiUrl('/api/v1/auth/refresh'), () => {
      calls += 1;
      return problem(401, 'unauthenticated');
    }),
  );
  return () => calls;
}

function fakePush(permission: PushPermission, platform: 'ios' | 'android' | null = 'ios') {
  const port: PushPort & { requests: number } = {
    requests: 0,
    platform,
    permission: async () => permission,
    requestPermission: async () => {
      port.requests += 1;
      return 'granted';
    },
    expoToken: async () => 'ExponentPushToken[device-1]',
  };
  return port;
}

beforeEach(async () => {
  holder.picker = null;
  holder.legal = [];
  holder.push = fakePush('undetermined');
  pushStore.setState({ registered: false });
  deletionNotice.setState(NO_DELETION_NOTICE);
  authStore.setState({ status: 'unknown' });
  __resetOpenedURLs();
  __scriptApple({ available: true, outcome: { kind: 'cancel' } });
  await session.establish(issueTokens());
});

describe('profile tab', () => {
  it('shows a skeleton, then the failure with request id and retry, then the profile', async () => {
    let fail = true;
    mswServer.use(
      http.get(apiUrl('/api/v1/me'), () =>
        fail ? problem(500, 'server_error', 'req-me-1') : HttpResponse.json(me()),
      ),
    );
    serveStats();
    serveDistricts();
    await render(<ProfileTab />);
    expect(screen.getByTestId('profile-loading')).toBeTruthy();
    expect(await screen.findByTestId('profile-error')).toBeTruthy();
    expect(screen.getByText(GENERIC_ERROR)).toBeTruthy();
    expect(screen.getByText(/req-me-1/)).toBeTruthy();
    // Settings (sign-out, deletion) stay reachable while the profile cannot be loaded.
    expect(screen.getByTestId('profile-settings')).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(await screen.findByText('Ali Kaleci')).toBeTruthy();
    expect(await screen.findByLabelText('İlçe: Kadıköy, İstanbul')).toBeTruthy();
    expect(screen.getByLabelText('Seviye: Düzenli')).toBeTruthy();
    expect(screen.getByLabelText('Ali Kaleci profil fotoğrafı')).toBeTruthy();
  });

  it('keeps a statistics failure inside its card with its own retry', async () => {
    serveMe();
    serveDistricts();
    let fail = true;
    mswServer.use(
      http.get(apiUrl('/api/v1/me/stats'), () =>
        fail
          ? problem(500, 'server_error', 'req-stats-1')
          : HttpResponse.json({ tier: 'basic', matchesPlayed: 4, mvpCount: 1 }),
      ),
    );
    await render(<ProfileTab />);
    expect(await screen.findByTestId('stats-error')).toBeTruthy();
    expect(screen.getByText(/req-stats-1/)).toBeTruthy();
    expect(screen.getByText('Ali Kaleci')).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByTestId('stats-retry'));
    expect(await screen.findByLabelText('Oynanan maç: 4')).toBeTruthy();
  });

  it('shows the advanced block only for the full tier, and the photo when there is one', async () => {
    serveMe(me({ avatarUrl: 'https://cdn.test.invalid/avatars/a.webp' }));
    serveDistricts();
    serveStats({
      tier: 'full',
      matchesPlayed: 10,
      mvpCount: 3,
      advanced: {
        matchesPlayedLast30Days: 4,
        mvpRate: 0.3,
        attendanceRate: null,
        distinctVenues: 2,
        distinctTeams: 1,
      },
    });
    await render(<ProfileTab />);
    expect(await screen.findByLabelText('Son 30 günde oynanan: 4')).toBeTruthy();
    expect(screen.getByLabelText('Katılım oranı: Henüz yok')).toBeTruthy();
    expect(screen.getByLabelText(/Maçın oyuncusu oranı: %30/)).toBeTruthy();
    expect(screen.getByTestId('avatar-image').props.source).toEqual({
      uri: 'https://cdn.test.invalid/avatars/a.webp',
    });
  });

  it('never writes the statistics to the device cache key space of persisted roots', async () => {
    serveMe();
    serveDistricts();
    serveStats();
    const client = createTestQueryClient();
    await render(<ProfileTab />, client);
    await screen.findByLabelText('Oynanan maç: 7');
    expect(client.getQueryData(profileKeys.stats())).toEqual({
      tier: 'basic',
      matchesPlayed: 7,
      mvpCount: 2,
    });
    expect(profileKeys.stats()[0]).toBe(queryKeys.me()[0]);
  });
});

describe('edit profile', () => {
  it('sends only the changed fields and the answer replaces the cached profile', async () => {
    serveMe();
    serveDistricts();
    const updated = me({ displayName: 'Ali Kale', position: null, districtId: CANKAYA_ID });
    const bodies = servePatch(() => HttpResponse.json(updated));
    const client = createTestQueryClient();
    await render(<EditProfileScreen />, client);
    const name = await screen.findByLabelText('Görünen ad');
    await fireEvent.changeText(name, '  Ali Kale ');
    await fireEvent.press(screen.getByTestId('profile-position-_none'));
    await fireEvent.changeText(await screen.findByLabelText('İlçe ara'), 'çan');
    await fireEvent.press(screen.getByRole('radio', { name: 'Çankaya, Ankara' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ displayName: 'Ali Kale', position: null, districtId: CANKAYA_ID });
    expect(updateMeRequestSchema.safeParse(bodies[0]).success).toBe(true);
    await waitFor(() => expect(routerCalls()).toEqual([{ method: 'replace', href: '/profil' }]));
    // The create-team screen reads the district from this cached profile (ADR-0050).
    expect(client.getQueryData<MeResponse>(queryKeys.me())?.districtId).toBe(CANKAYA_ID);
  });

  it('leaves without a request when nothing changed', async () => {
    serveMe();
    serveDistricts();
    const bodies = servePatch(() => HttpResponse.json(me()));
    await render(<EditProfileScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(routerCalls()).toEqual([{ method: 'replace', href: '/profil' }]));
    expect(bodies).toEqual([]);
  });

  it('shows the name rule and sends nothing for an invalid name', async () => {
    serveMe();
    serveDistricts();
    const bodies = servePatch(() => HttpResponse.json(me()));
    await render(<EditProfileScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Görünen ad'), 'A');
    await fireEvent.press(screen.getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByText(/en az 2/)).toBeTruthy();
    expect(bodies).toEqual([]);
    expect(routerCalls()).toEqual([]);
  });

  it('marks the field the server refused and stays on the form', async () => {
    serveMe();
    serveDistricts();
    servePatch(() =>
      HttpResponse.json(
        {
          type: 'https://kadro.app/problems/validation_failed',
          title: 'x',
          status: 400,
          code: 'validation_failed',
          requestId: 'req-patch-1',
          errors: [{ path: 'body.displayName', issue: 'invalid_format' }],
        },
        { status: 400, headers: { 'content-type': 'application/problem+json' } },
      ),
    );
    await render(<EditProfileScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Görünen ad'), 'Ali Yeni');
    await fireEvent.press(screen.getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByText('Bu değer kabul edilmedi.')).toBeTruthy();
    expect(screen.getByText('Girdiğin bilgileri kontrol edip tekrar dene.')).toBeTruthy();
    expect(screen.getByText(/req-patch-1/)).toBeTruthy();
    expect(routerCalls()).toEqual([]);
  });

  it('offers a retry instead of the form when the profile cannot be loaded', async () => {
    mswServer.use(http.get(apiUrl('/api/v1/me'), () => problem(500, 'server_error')));
    serveDistricts();
    await render(<EditProfileScreen />);
    expect(await screen.findByTestId('profile-edit-error')).toBeTruthy();
    expect(screen.queryByLabelText('Görünen ad')).toBeNull();
  });

  it('removes the photo only after the confirmation', async () => {
    serveMe(me({ avatarUrl: 'https://cdn.test.invalid/avatars/a.webp' }));
    serveDistricts();
    const bodies = servePatch(() => HttpResponse.json(me()));
    await render(<EditProfileScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Fotoğrafı kaldır' }));
    expect(bodies).toEqual([]);
    await fireEvent.press(screen.getByRole('button', { name: 'Kaldır' }));
    await waitFor(() => expect(bodies).toEqual([{ avatar: null }]));
    expect(updateMeRequestSchema.safeParse(bodies[0]).success).toBe(true);
  });

  it('hides "change photo" without a picker and uploads through presign and complete with one', async () => {
    const reads = serveMe();
    serveDistricts();
    const first = await render(<EditProfileScreen />);
    await screen.findByLabelText('Görünen ad');
    expect(screen.queryByRole('button', { name: 'Fotoğrafı değiştir' })).toBeNull();
    await first.unmount();

    holder.picker = {
      pick: async () => ({ uri: 'file:///photo.jpg', mimeType: 'image/jpeg' }),
      read: async () => new Blob([new Uint8Array(4)], { type: 'image/jpeg' }),
    };
    const steps: string[] = [];
    mswServer.use(
      http.post(apiUrl('/api/v1/uploads/presign'), () => {
        steps.push('presign');
        return HttpResponse.json(
          {
            uploadId: UPLOAD_ID,
            url: STORAGE_URL,
            method: 'PUT',
            headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '4' },
            expiresAt: '2026-10-03T10:05:00.000Z',
          },
          { status: 201 },
        );
      }),
      http.put(STORAGE_URL, () => {
        steps.push('put');
        return new HttpResponse(null, { status: 200 });
      }),
      http.post(apiUrl(`/api/v1/uploads/${UPLOAD_ID}/complete`), () => {
        steps.push('complete');
        return HttpResponse.json({ status: 'processing' }, { status: 202 });
      }),
      http.get(apiUrl(`/api/v1/uploads/${UPLOAD_ID}`), () => {
        steps.push('status');
        return HttpResponse.json({
          id: UPLOAD_ID,
          kind: 'avatar',
          status: 'rejected',
          rejectReason: 'not_an_image',
          url: null,
        });
      }),
    );
    await render(<EditProfileScreen />);
    const before = reads.reads();
    await fireEvent.press(await screen.findByRole('button', { name: 'Fotoğrafı değiştir' }));
    // The first status read follows a one-second pause.
    expect(await screen.findByTestId('photo-notice', {}, { timeout: 3_000 })).toBeTruthy();
    expect(screen.getByText('Fotoğraf işlenemedi. Başka bir fotoğraf dene.')).toBeTruthy();
    expect(steps).toEqual(['presign', 'put', 'complete', 'status']);
    // A rejected photo leaves the profile as it is: no refetch.
    expect(reads.reads()).toBe(before);
  });
});

describe('settings', () => {
  it.each([
    ['light', lightTheme],
    ['dark', darkTheme],
  ] as const)(
    'shows the shared link-coloured back control in the %s scheme',
    async (scheme, theme) => {
      await renderWithProviders(<SettingsScreen />, { i18n: createTestI18n(), scheme });
      const back = screen.getByTestId('back');
      expect(back.props.accessibilityLabel).toBe('Geri');
      expect(StyleSheet.flatten(screen.getByText('‹ Geri').props.style).color).toBe(
        theme.colors.link,
      );
      expect(theme.colors.link).not.toBe(theme.colors.textMuted);
    },
  );

  it('switches the language at once and remembers it on the device', async () => {
    const i18n = createTestI18n();
    await renderWithProviders(<SettingsScreen />, { i18n });
    await fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    expect(await screen.findByText('Settings')).toBeTruthy();
    expect(i18n.language).toBe('en');
    expect(asyncStorageContents().get('kadro.language')).toBe('en');
    expect(screen.getByRole('radio', { name: 'English' }).props.accessibilityState).toMatchObject({
      checked: true,
    });
  });

  it('asks for permission and registers this device once the user turns notifications on', async () => {
    const port = fakePush('undetermined', 'android');
    holder.push = port;
    const bodies: unknown[] = [];
    mswServer.use(
      http.post(apiUrl('/api/v1/me/push-tokens'), async ({ request }) => {
        bodies.push(await request.json());
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await render(<SettingsScreen />);
    expect(await screen.findByTestId('push-undetermined')).toBeTruthy();
    // Nothing is asked or sent before the tap.
    expect(port.requests).toBe(0);
    await fireEvent.press(screen.getByRole('button', { name: 'Bildirimleri aç' }));
    expect(await screen.findByTestId('push-registered')).toBeTruthy();
    expect(port.requests).toBe(1);
    expect(bodies).toEqual([{ expoToken: 'ExponentPushToken[device-1]', platform: 'android' }]);
    expect(pushStore.getState().registered).toBe(true);
    expect(screen.queryByTestId('push-enable')).toBeNull();
  });

  it('shows a refused or unavailable push state without a button, and a server failure with retry', async () => {
    holder.push = fakePush('denied');
    const denied = await render(<SettingsScreen />);
    expect(await screen.findByTestId('push-denied')).toBeTruthy();
    expect(screen.queryByTestId('push-enable')).toBeNull();
    await denied.unmount();

    holder.push = fakePush('undetermined', null);
    const unavailable = await render(<SettingsScreen />);
    expect(await screen.findByTestId('push-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('push-enable')).toBeNull();
    await unavailable.unmount();

    holder.push = fakePush('granted');
    mswServer.use(
      http.post(apiUrl('/api/v1/me/push-tokens'), () => problem(500, 'server_error', 'req-push-1')),
    );
    await render(<SettingsScreen />);
    expect(await screen.findByTestId('push-granted')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Bu cihazı kaydet' }));
    expect(await screen.findByText(GENERIC_ERROR)).toBeTruthy();
    expect(pushStore.getState().registered).toBe(false);
    expect(screen.getByTestId('push-enable')).toBeTruthy();
  });

  it('opens the sample-labelled legal pages, or says they are not set up', async () => {
    const none = await render(<SettingsScreen />);
    expect(screen.getByTestId('legal-unavailable')).toBeTruthy();
    await none.unmount();

    holder.legal = [
      { key: 'privacy', url: 'https://kadro.app/gizlilik' },
      { key: 'kvkk', url: 'https://kadro.app/kvkk-aydinlatma' },
      { key: 'deletion', url: 'https://kadro.app/hesap-silme' },
    ];
    await render(<SettingsScreen />);
    expect(
      screen.getByText('Bu metinler örnek metindir; hukuki inceleme sonrası güncellenecektir.'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('link', { name: 'KVKK aydınlatma metni' }));
    expect(openedURLs()).toEqual(['https://kadro.app/kvkk-aydinlatma']);
  });

  it('signs out of this device with the server revocation and a full local cleanup', async () => {
    const logouts = countLogout();
    const cleared: string[] = [];
    const unsubscribe = session.onSignOut((reason) => {
      cleared.push(reason);
    });
    try {
      await render(<SettingsScreen />);
      await fireEvent.press(screen.getByRole('button', { name: 'Çıkış yap' }));
      await waitFor(() => expect(secureStoreContents().size).toBe(0));
      expect(logouts()).toBe(1);
      expect(session.hasSession()).toBe(false);
      expect(cleared).toEqual(['user']);
    } finally {
      unsubscribe();
    }
  });

  it('opens the account deletion screen', async () => {
    await render(<SettingsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Hesabımı sil' }));
    expect(routerCalls()).toEqual([{ method: 'push', href: '/ayarlar/hesabi-sil' }]);
  });
});

async function reachProof(): Promise<void> {
  await fireEvent.press(await screen.findByRole('button', { name: 'Devam et' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Evet, devam et' }));
}

describe('account deletion', () => {
  it('re-authenticates with the password, starts the deletion and clears the device', async () => {
    serveMe();
    const logouts = countLogout();
    const bodies = serveDelete(() =>
      HttpResponse.json({ graceUntil: GRACE_UNTIL }, { status: 202 }),
    );
    const client = createTestQueryClient();
    // What the root layout registers: every sign-out drops the query caches.
    const unsubscribe = session.onSignOut(() => client.clear());
    try {
      await render(<DeleteAccountScreen />, client);
      expect(await screen.findByTestId('deletion-explain')).toBeTruthy();
      await reachProof();
      await fireEvent.changeText(screen.getByLabelText('Şifren'), 'my-current-password');
      await fireEvent.press(screen.getByRole('button', { name: 'Hesabımı sil' }));
      // Nothing is sent before the last confirmation.
      expect(bodies).toEqual([]);
      await fireEvent.press(screen.getByRole('button', { name: 'Evet, hesabımı sil' }));
      await waitFor(() => expect(session.hasSession()).toBe(false));
      expect(bodies).toEqual([{ password: 'my-current-password' }]);
      expect(deleteAccountRequestSchema.safeParse(bodies[0]).success).toBe(true);
      expect(deletionNotice.getState()).toEqual({ pending: true, graceUntil: GRACE_UNTIL });
      expect(routerCalls()).toEqual([{ method: 'replace', href: '/ayarlar/hesap-silindi' }]);
      // The server already revoked every session: no logout call, tokens and caches gone.
      expect(logouts()).toBe(0);
      expect(secureStoreContents().size).toBe(0);
      expect(client.getQueryData(queryKeys.me())).toBeUndefined();
    } finally {
      unsubscribe();
    }
  });

  it('keeps the session and the typed password and says the password was refused, without a refresh', async () => {
    serveMe();
    const refreshes = countRefresh();
    const bodies = serveDelete(() => problem(401, 'reauth_required', 'req-del-1'));
    await render(<DeleteAccountScreen />);
    await reachProof();
    await fireEvent.changeText(screen.getByLabelText('Şifren'), 'wrong-password');
    await fireEvent.press(screen.getByRole('button', { name: 'Hesabımı sil' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Evet, hesabımı sil' }));
    expect(
      await screen.findByText(
        'Şifren ya da kimlik doğrulaman kabul edilmedi. Kontrol edip tekrar dene.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(GENERIC_ERROR)).toBeNull();
    expect(screen.getByText(/req-del-1/)).toBeTruthy();
    expect(bodies).toHaveLength(1);
    expect(refreshes()).toBe(0);
    expect(session.hasSession()).toBe(true);
    expect(screen.getByLabelText('Şifren').props.value).toBe('wrong-password');
    expect(deletionNotice.getState()).toEqual(NO_DELETION_NOTICE);
    expect(routerCalls()).toEqual([]);
  });

  it('asks for the password before sending anything', async () => {
    serveMe();
    const bodies = serveDelete(() =>
      HttpResponse.json({ graceUntil: GRACE_UNTIL }, { status: 202 }),
    );
    await render(<DeleteAccountScreen />);
    await reachProof();
    await fireEvent.press(screen.getByRole('button', { name: 'Hesabımı sil' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Evet, hesabımı sil' }));
    expect(await screen.findByText('Şifreni yaz.')).toBeTruthy();
    expect(bodies).toEqual([]);
  });

  it('sends one request while it runs, however often the confirmation is pressed', async () => {
    serveMe();
    const gate = deferred();
    const bodies = serveDelete(() =>
      HttpResponse.json({ graceUntil: GRACE_UNTIL }, { status: 202 }),
    );
    mswServer.use(
      http.delete(apiUrl('/api/v1/me'), async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        await gate.promise;
        return HttpResponse.json({ graceUntil: GRACE_UNTIL }, { status: 202 });
      }),
    );
    await render(<DeleteAccountScreen />);
    await reachProof();
    await fireEvent.changeText(screen.getByLabelText('Şifren'), 'my-current-password');
    await fireEvent.press(screen.getByRole('button', { name: 'Hesabımı sil' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Evet, hesabımı sil' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    // While the request runs, the action button is busy and a second confirmation sends nothing.
    await fireEvent.press(screen.getByRole('button', { name: 'Hesabımı sil' }));
    const again = screen.queryByRole('button', { name: 'Evet, hesabımı sil' });
    if (again !== null) {
      await fireEvent.press(again);
    }
    gate.resolve();
    await waitFor(() => expect(session.hasSession()).toBe(false));
    expect(bodies).toHaveLength(1);
  });

  it('requires the TOTP code of a staff account and sends it with the password', async () => {
    serveMe(me({ role: 'moderator' }));
    const bodies = serveDelete(() =>
      HttpResponse.json({ graceUntil: GRACE_UNTIL }, { status: 202 }),
    );
    await render(<DeleteAccountScreen />);
    await reachProof();
    await fireEvent.changeText(screen.getByLabelText('Şifren'), 'my-current-password');
    await fireEvent.press(screen.getByRole('button', { name: 'Hesabımı sil' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Evet, hesabımı sil' }));
    expect(await screen.findByText('6 haneli kodu gir.')).toBeTruthy();
    expect(bodies).toEqual([]);
    await fireEvent.changeText(screen.getByLabelText('Doğrulama kodu'), '123456');
    await fireEvent.press(screen.getByRole('button', { name: 'Hesabımı sil' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Evet, hesabımı sil' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ password: 'my-current-password', totpCode: '123456' });
  });

  it('re-authenticates an Apple-only account with a fresh nonce-bound Apple token', async () => {
    serveMe(me({ providers: { password: false, apple: true, google: false } }));
    const bodies = serveDelete(() =>
      HttpResponse.json({ graceUntil: GRACE_UNTIL }, { status: 202 }),
    );
    await render(<DeleteAccountScreen />);
    await reachProof();
    expect(screen.queryByLabelText('Şifren')).toBeNull();
    expect(screen.getByTestId('deletion-apple')).toBeTruthy();

    // Cancelling the Apple sheet sends nothing.
    __scriptApple({ outcome: { kind: 'cancel' } });
    await fireEvent.press(
      screen.getByRole('button', { name: 'Apple ile doğrula ve hesabımı sil' }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Evet, hesabımı sil' }));
    await waitFor(() => expect(appleSignInCalls()).toHaveLength(1));
    expect(bodies).toEqual([]);
    expect(session.hasSession()).toBe(true);

    const token = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhcHBsZSJ9.c2lnbmF0dXJl';
    __scriptApple({ outcome: { kind: 'credential', identityToken: token } });
    await fireEvent.press(
      screen.getByRole('button', { name: 'Apple ile doğrula ve hesabımı sil' }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Evet, hesabımı sil' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    const body = bodies[0] as { provider: string; identityToken: string; nonce: string };
    expect(body.provider).toBe('apple');
    expect(body.identityToken).toBe(token);
    // Apple got the SHA-256 of the raw nonce the server receives.
    expect(appleSignInCalls()[1]?.nonce).toBe(
      createHash('sha256').update(body.nonce).digest('hex'),
    );
    expect(deleteAccountRequestSchema.safeParse(body).success).toBe(true);
    await waitFor(() => expect(session.hasSession()).toBe(false));
  });

  it('sends a Google-only account to the web deletion page instead of a form', async () => {
    serveMe(me({ providers: { password: false, apple: false, google: true } }));
    holder.legal = [{ key: 'deletion', url: 'https://kadro.app/hesap-silme' }];
    const bodies = serveDelete(() =>
      HttpResponse.json({ graceUntil: GRACE_UNTIL }, { status: 202 }),
    );
    await render(<DeleteAccountScreen />);
    await reachProof();
    expect(screen.getByTestId('deletion-web')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hesabımı sil' })).toBeNull();
    await fireEvent.press(screen.getByRole('link', { name: 'Hesap silme sayfası' }));
    expect(openedURLs()).toEqual(['https://kadro.app/hesap-silme']);
    expect(bodies).toEqual([]);
  });

  it('shows specific copy for a missing TOTP code, the last admin and too many attempts', async () => {
    serveMe(me({ role: 'admin' }));
    const answers = [
      problem(401, 'step_up_required', 'req-a'),
      problem(409, 'last_admin', 'req-b'),
      problem(429, 'rate_limited', 'req-c'),
    ];
    serveDelete(() => answers.shift() ?? problem(500, 'server_error'));
    await render(<DeleteAccountScreen />);
    await reachProof();
    await fireEvent.changeText(screen.getByLabelText('Şifren'), 'my-current-password');
    await fireEvent.changeText(screen.getByLabelText('Doğrulama kodu'), '123456');
    const expected = [
      'Doğrulama kodu eksik ya da hatalı. Uygulamandaki güncel kodu gir.',
      'Son yönetici hesabı silinemez. Önce başka bir yönetici ata.',
      'Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.',
    ];
    for (const message of expected) {
      await fireEvent.press(screen.getByRole('button', { name: 'Hesabımı sil' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Evet, hesabımı sil' }));
      expect(await screen.findByText(message)).toBeTruthy();
    }
    expect(screen.getByLabelText('Doğrulama kodu').props.value).toBe('123456');
    expect(session.hasSession()).toBe(true);
  });

  it('treats a repeat after a lost answer (deletion_pending) as a pending deletion', async () => {
    serveMe();
    const logouts = countLogout();
    serveDelete(() => problem(409, 'deletion_pending'));
    await render(<DeleteAccountScreen />);
    await reachProof();
    await fireEvent.changeText(screen.getByLabelText('Şifren'), 'my-current-password');
    await fireEvent.press(screen.getByRole('button', { name: 'Hesabımı sil' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Evet, hesabımı sil' }));
    await waitFor(() => expect(session.hasSession()).toBe(false));
    expect(deletionNotice.getState()).toEqual({ pending: true, graceUntil: null });
    expect(routerCalls()).toEqual([{ method: 'replace', href: '/ayarlar/hesap-silindi' }]);
    expect(logouts()).toBe(0);
    expect(secureStoreContents().size).toBe(0);
  });

  it('treats account_deactivated on the repeat as a pending deletion too', async () => {
    serveMe();
    const refreshes = countRefresh();
    serveDelete(() => problem(401, 'account_deactivated'));
    await render(<DeleteAccountScreen />);
    await reachProof();
    await fireEvent.changeText(screen.getByLabelText('Şifren'), 'my-current-password');
    await fireEvent.press(screen.getByRole('button', { name: 'Hesabımı sil' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Evet, hesabımı sil' }));
    await waitFor(() =>
      expect(deletionNotice.getState()).toEqual({ pending: true, graceUntil: null }),
    );
    expect(routerCalls()).toEqual([{ method: 'replace', href: '/ayarlar/hesap-silindi' }]);
    expect(session.hasSession()).toBe(false);
    // The client tried one refresh for the rejected token, which the server refused.
    expect(refreshes()).toBe(1);
  });

  it('offers a retry, not the form, when the profile cannot be loaded', async () => {
    mswServer.use(http.get(apiUrl('/api/v1/me'), () => problem(500, 'server_error', 'req-me-9')));
    await render(<DeleteAccountScreen />);
    expect(await screen.findByTestId('deletion-error')).toBeTruthy();
    expect(screen.getByText(/req-me-9/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Devam et' })).toBeNull();
  });
});

describe('after the deletion request', () => {
  it('shows the end of the grace period and how to cancel, then goes to the entry screen', async () => {
    deletionNotice.setState({ pending: true, graceUntil: GRACE_UNTIL });
    await render(<DeletionNoticeScreen />);
    expect(screen.getByText(/tarihinde kalıcı olarak silinecek/)).toBeTruthy();
    expect(
      screen.getByText(
        'Fikrini değiştirirsen 7 gün dolmadan tekrar giriş yapman yeterli; silme iptal edilir.',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Giriş ekranına dön' }));
    expect(routerCalls()).toEqual([{ method: 'replace', href: '/' }]);
    expect(deletionNotice.getState()).toEqual(NO_DELETION_NOTICE);
  });

  it('explains the grace period without a date after a cold start', async () => {
    await render(<DeletionNoticeScreen />);
    expect(
      screen.getByText('Silme isteğini aldık. Hesabın 7 gün sonra kalıcı olarak silinecek.'),
    ).toBeTruthy();
  });

  it('sends a signed-in visitor without a request on this device to the profile', async () => {
    authStore.setState({ status: 'signedIn' });
    await render(<DeletionNoticeScreen />);
    expect(screen.getByTestId('deletion-done-stray')).toBeTruthy();
    expect(screen.queryByText('Hesabın kapatıldı')).toBeNull();
    await waitFor(() => expect(routerCalls()).toEqual([{ method: 'replace', href: '/profil' }]));
  });

  it('keeps explaining a request made on this device while still signed in', async () => {
    authStore.setState({ status: 'signedIn' });
    deletionNotice.setState({ pending: true, graceUntil: null });
    await render(<DeletionNoticeScreen />);
    expect(screen.getByText('Hesabın kapatıldı')).toBeTruthy();
    expect(routerCalls()).toEqual([]);
  });

  it('shows the grace explanation on the entry screen when the notice screen did not survive', async () => {
    const first = await render(<WelcomeScreen />);
    expect(screen.queryByTestId('welcome-deletion-pending')).toBeNull();
    await first.unmount();
    deletionNotice.setState({ pending: true, graceUntil: null });
    await render(<WelcomeScreen />);
    expect(screen.getByTestId('welcome-deletion-pending')).toBeTruthy();
    expect(
      screen.getByText('Silme isteğini aldık. Hesabın 7 gün sonra kalıcı olarak silinecek.'),
    ).toBeTruthy();
  });

  it('tells on the sign-in screen that signing in cancels a pending deletion', async () => {
    await render(<SignInScreen />);
    expect(
      screen.getByText(
        'Hesabını silme isteği verdiysen 7 gün içinde giriş yapman silmeyi iptal eder ve hesabını yeniden açar.',
      ),
    ).toBeTruthy();
  });
});

describe('district picker data', () => {
  it('reads the districts from the shared open-call key', async () => {
    serveMe();
    serveDistricts();
    const client = createTestQueryClient();
    await render(<EditProfileScreen />, client);
    await screen.findByLabelText('İlçe ara');
    await waitFor(() =>
      expect(client.getQueryData(callKeys.districts())).toEqual({ items: DISTRICTS }),
    );
  });
});
