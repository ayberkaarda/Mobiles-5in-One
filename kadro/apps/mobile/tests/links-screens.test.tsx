import { fireEvent, screen, waitFor } from '@testing-library/react-native/pure';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import OpenCallsTab from '../app/(tabs)/eksik-var/index';
import SettingsScreen from '../app/ayarlar/index';
import WelcomeScreen from '../app/index';
import { session } from '../src/api/instance';
import { authStore } from '../src/auth-store';
import { type DistrictPublic } from '../src/calls/contracts';
import { pendingLink } from '../src/links/instance';
import { PUSH_PROMPT_STORAGE_KEY } from '../src/notifications/prompt';
import { PushPrompt } from '../src/notifications/PushPrompt';
import { pushStore } from '../src/settings/push-instance';
import { type PushPermission, type PushPort } from '../src/settings/push';
import { issueTokens } from './support/api';
import AsyncStorage from './support/async-storage';
import { __resetSettingsOpened, settingsOpenCount } from './support/expo-linking';
import { __setSearchParams } from './support/expo-router';
import { apiUrl, mswServer } from './support/msw';
import { renderWithProviders } from './support/render';

const holder = vi.hoisted(() => ({ push: null as PushPort | null }));

vi.mock('expo-image', () => import('./support/expo-image'));

// The screens use the app's API client; here it is wired to the MSW base URL.
vi.mock('../src/api/instance', async () => {
  const { createTestApi } = await import('./support/api');
  const { api, session: testSession } = createTestApi();
  return { api, session: testSession };
});

// The settings screen links to the store's subscription page through the billing port; no store
// is reachable in these tests.
vi.mock('../src/billing/instance', async () => {
  const { unavailableBillingPort } = await import('../src/billing/port');
  return { billing: unavailableBillingPort };
});

vi.mock('../src/profile/instance', async () => {
  const { api } = await import('../src/api/instance');
  const { createProfileApi } = await import('../src/profile/profile-api');
  return { profileApi: createProfileApi(api), avatarPicker: null };
});

// The push port is set per test; the native module is never loaded.
vi.mock('../src/settings/push-instance', async () => {
  const { createPushStore } = await import('../src/settings/push');
  return {
    get pushPort() {
      return holder.push;
    },
    pushStore: createPushStore(),
  };
});

vi.mock('../src/settings/instance', async () => {
  const pushInstance = await import('../src/settings/push-instance');
  return {
    appLegalLinks: [],
    get pushPort() {
      return pushInstance.pushPort;
    },
    pushStore: pushInstance.pushStore,
  };
});

const CODE = 'abcdefghijklmnopqrstuv';
const KADIKOY_ID = '0192a0b0-0000-7000-8000-0000000000d1';
const CANKAYA_ID = '0192a0b0-0000-7000-8000-0000000000d2';

function fakePush(permission: PushPermission, answer: PushPermission = 'granted') {
  const port: PushPort & { prompts: number; reads: number } = {
    prompts: 0,
    reads: 0,
    platform: 'ios',
    permission: async () => {
      port.reads += 1;
      return permission;
    },
    requestPermission: async () => {
      port.prompts += 1;
      return answer;
    },
    expoToken: async () => 'ExponentPushToken[device-1]',
  };
  return port;
}

function district(id: string, provinceSlug: string, slug: string, name: string): DistrictPublic {
  return {
    id,
    province: provinceSlug,
    provinceSlug,
    name,
    slug,
    centroid: { latitude: 41, longitude: 29 },
  };
}

beforeEach(() => {
  holder.push = fakePush('undetermined');
  pushStore.setState({ registered: false });
  pendingLink.setState({ target: null });
  __resetSettingsOpened();
});

describe('invite link while signed out', () => {
  beforeEach(() => {
    authStore.setState({ status: 'signedOut' });
  });

  it('tells the user on the entry screen that an invite waits for the sign-in', async () => {
    pendingLink.setState({ target: { kind: 'teamInvite', code: CODE } });
    await renderWithProviders(<WelcomeScreen />);
    expect(screen.getByTestId('welcome-invite-pending')).toBeTruthy();
    expect(screen.getByText(/Bir takım daveti seni bekliyor/)).toBeTruthy();
  });

  it('shows no invite notice for another held link or none', async () => {
    pendingLink.setState({ target: { kind: 'venue', slug: 'moda-kadikoy' } });
    await renderWithProviders(<WelcomeScreen />);
    expect(screen.queryByTestId('welcome-invite-pending')).toBeNull();
  });
});

describe('district link', () => {
  beforeEach(async () => {
    await session.establish(issueTokens());
    mswServer.use(
      http.get(apiUrl('/api/v1/districts'), () =>
        HttpResponse.json({
          items: [
            district(KADIKOY_ID, 'istanbul', 'kadikoy', 'Kadıköy'),
            district(CANKAYA_ID, 'ankara', 'cankaya', 'Çankaya'),
          ],
        }),
      ),
    );
  });

  function serveList(): string[] {
    const queries: string[] = [];
    mswServer.use(
      http.get(apiUrl('/api/v1/open-calls'), ({ request }) => {
        queries.push(new URL(request.url).search);
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    return queries;
  }

  it('filters the Eksik Var list by the district the link names', async () => {
    const queries = serveList();
    __setSearchParams({ il: 'ankara', ilce: 'cankaya' });
    await renderWithProviders(<OpenCallsTab />);
    await waitFor(() => expect(queries).toContain(`?limit=20&district=${CANKAYA_ID}`));
    expect(screen.getByRole('button', { name: 'Filtrele (1)' })).toBeTruthy();
    expect(screen.queryByTestId('district-link-missing')).toBeNull();
  });

  it('shows all calls with a notice when the district does not exist', async () => {
    const queries = serveList();
    __setSearchParams({ il: 'istanbul', ilce: 'yok' });
    await renderWithProviders(<OpenCallsTab />);
    expect(await screen.findByTestId('district-link-missing')).toBeTruthy();
    expect(queries.every((query) => !query.includes('district='))).toBe(true);
  });
});

describe('notification card', () => {
  beforeEach(async () => {
    await session.establish(issueTokens());
  });

  it('explains notifications and asks the system only on the tap', async () => {
    const port = fakePush('undetermined');
    holder.push = port;
    const bodies: unknown[] = [];
    mswServer.use(
      http.post(apiUrl('/api/v1/me/push-tokens'), async ({ request }) => {
        bodies.push(await request.json());
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await renderWithProviders(<PushPrompt />);
    expect(await screen.findByTestId('push-prompt')).toBeTruthy();
    expect(screen.getByText('Maçlarını kaçırma')).toBeTruthy();
    expect(port.prompts).toBe(0);

    await fireEvent.press(screen.getByRole('button', { name: 'Bildirimleri aç' }));
    await waitFor(() => expect(screen.queryByTestId('push-prompt')).toBeNull());
    expect(port.prompts).toBe(1);
    expect(bodies).toEqual([{ expoToken: 'ExponentPushToken[device-1]', platform: 'ios' }]);
    expect(pushStore.getState().registered).toBe(true);
  });

  it('hides for good on "not now"', async () => {
    await renderWithProviders(<PushPrompt />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Şimdi değil' }));
    expect(screen.queryByTestId('push-prompt')).toBeNull();
    await waitFor(async () =>
      expect(await AsyncStorage.getItem(PUSH_PROMPT_STORAGE_KEY)).toBe('dismissed'),
    );
  });

  it('stays hidden once dismissed or decided, and never reads an unavailable port', async () => {
    const settle = async (port: ReturnType<typeof fakePush>): Promise<void> => {
      holder.push = port;
      const view = await renderWithProviders(<PushPrompt />);
      await waitFor(() => expect(port.reads).toBe(1));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(screen.queryByTestId('push-prompt')).toBeNull();
      await view.unmount();
    };
    await AsyncStorage.setItem(PUSH_PROMPT_STORAGE_KEY, 'dismissed');
    await settle(fakePush('undetermined'));
    await AsyncStorage.removeItem(PUSH_PROMPT_STORAGE_KEY);
    await settle(fakePush('granted'));
    await settle(fakePush('denied'));

    const unavailable = { ...fakePush('undetermined'), platform: null };
    holder.push = unavailable;
    await renderWithProviders(<PushPrompt />);
    expect(screen.queryByTestId('push-prompt')).toBeNull();
    expect(unavailable.reads).toBe(0);
  });
});

describe('settings with notifications turned off', () => {
  beforeEach(async () => {
    await session.establish(issueTokens());
  });

  it('offers the phone settings', async () => {
    holder.push = fakePush('denied');
    await renderWithProviders(<SettingsScreen />);
    expect(await screen.findByTestId('push-denied')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Telefon ayarlarını aç' }));
    expect(settingsOpenCount()).toBe(1);
  });
});
