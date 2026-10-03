import { fireEvent, screen, waitFor } from '@testing-library/react-native/pure';
import { http, HttpResponse } from 'msw';
import { type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProfileTab from '../app/(tabs)/profil/index';
import SettingsScreen from '../app/ayarlar/index';
import PaywallScreen from '../app/kadro-pro';
import CreateTeamScreen from '../app/takim/yeni';
import { session } from '../src/api/instance';
import { useBillingIdentity } from '../src/billing/hooks';
import { BillingError, type BillingOffer, type BillingPort } from '../src/billing/port';
import { type Entitlements, type MeResponse } from '../src/profile/contracts';
import { type LegalLink } from '../src/settings/legal';
import { issueTokens, problem } from './support/api';
import { __resetOpenedURLs, openedURLs } from './support/expo-linking';
import { routerCalls } from './support/expo-router';
import { createTestI18n } from './support/i18n';
import { apiUrl, mswServer } from './support/msw';
import { renderWithProviders, TestProviders } from './support/render';

const holder = vi.hoisted(() => ({
  port: null as BillingPort | null,
  legal: [] as LegalLink[],
}));

vi.mock('expo-image', () => import('./support/expo-image'));

vi.mock('../src/api/instance', async () => {
  const { createTestApi } = await import('./support/api');
  const { api, session: testSession } = createTestApi();
  return { api, session: testSession };
});

vi.mock('../src/profile/instance', async () => {
  const { api } = await import('../src/api/instance');
  const { createProfileApi } = await import('../src/profile/profile-api');
  return { profileApi: createProfileApi(api), avatarPicker: null };
});

vi.mock('../src/settings/instance', async () => {
  const { createPushStore } = await import('../src/settings/push');
  return {
    get appLegalLinks() {
      return holder.legal;
    },
    pushPort: {
      platform: null,
      permission: async () => 'undetermined',
      requestPermission: async () => 'granted',
      expoToken: async () => null,
    },
    pushStore: createPushStore(),
  };
});

// The paywall screens use this port; tests set a fake one.
vi.mock('../src/billing/instance', () => ({
  get billing() {
    return holder.port;
  },
}));

const ME_ID = '0192a0b0-0000-7000-8000-0000000000f1';
const KADIKOY_ID = '0192a0b0-0000-7000-8000-0000000000d1';

const NO_PRO: Entitlements = { pro: false, status: 'none', expiresAt: null, store: null };
const PRO: Entitlements = {
  pro: true,
  status: 'active',
  expiresAt: '2027-01-15T10:00:00.000Z',
  store: 'app_store',
};

const OFFERS: readonly BillingOffer[] = [
  { id: 'kadro_pro_monthly', period: 'monthly', priceString: '49,99 TL' },
  { id: 'kadro_pro_yearly', period: 'yearly', priceString: '399,99 TL' },
];

function me(entitlements?: Entitlements): MeResponse {
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
    ...(entitlements === undefined ? {} : { entitlements }),
  };
}

/** `GET me` answers from a mutable slot, so a test can flip the server's Pro state. */
function serveMe(initial?: Entitlements) {
  const state = { entitlements: initial, reads: 0 };
  mswServer.use(
    http.get(apiUrl('/api/v1/me'), () => {
      state.reads += 1;
      return HttpResponse.json(me(state.entitlements));
    }),
    http.get(apiUrl('/api/v1/me/stats'), () =>
      HttpResponse.json({ tier: 'basic', matchesPlayed: 1, mvpCount: 0 }),
    ),
    http.get(apiUrl('/api/v1/districts'), () => HttpResponse.json({ items: [] })),
  );
  return state;
}

interface FakeBilling extends BillingPort {
  readonly calls: string[];
}

function fakeBilling(
  options: {
    available?: boolean;
    offers?: readonly BillingOffer[];
    offersError?: BillingError;
    purchase?: (id: string) => Promise<void>;
    restore?: () => Promise<void>;
    managementUrl?: string | null;
  } = {},
): FakeBilling {
  const calls: string[] = [];
  return {
    calls,
    available: options.available ?? true,
    logIn: async (id) => {
      calls.push(`logIn:${id}`);
    },
    logOut: async () => {
      calls.push('logOut');
    },
    loadOffers: async () => {
      calls.push('loadOffers');
      if (options.offersError !== undefined) {
        throw options.offersError;
      }
      return options.offers ?? OFFERS;
    },
    purchase: async (id) => {
      calls.push(`purchase:${id}`);
      await options.purchase?.(id);
    },
    restore: async () => {
      calls.push('restore');
      await options.restore?.();
    },
    managementUrl: async () => options.managementUrl ?? null,
  };
}

function render(ui: ReactElement) {
  return renderWithProviders(ui, { i18n: createTestI18n() });
}

beforeEach(async () => {
  holder.port = fakeBilling();
  holder.legal = [];
  __resetOpenedURLs();
  await session.establish(issueTokens());
});

describe('paywall', () => {
  it('lists the monthly and yearly offers with their store prices and the renewal terms', async () => {
    serveMe(NO_PRO);
    holder.legal = [{ key: 'privacy', url: 'https://kadro.test.invalid/gizlilik' }];
    await render(<PaywallScreen />);
    expect(await screen.findByRole('radio', { name: 'Aylık: 49,99 TL' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Yıllık: 399,99 TL' })).toBeTruthy();
    expect(screen.getByTestId('paywall-benefit-unlimitedTeams')).toBeTruthy();
    expect(screen.getByText(/otomatik yenilenir/)).toBeTruthy();
    // Store terms (iOS in the test double) and the sample-labelled privacy page.
    await fireEvent.press(screen.getByRole('link', { name: 'Kullanım koşulları (mağaza)' }));
    await fireEvent.press(screen.getByRole('link', { name: 'Gizlilik politikası' }));
    expect(openedURLs()).toEqual([
      'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/',
      'https://kadro.test.invalid/gizlilik',
    ]);
    expect(screen.getByText(/örnek metindir/)).toBeTruthy();
  });

  it('buys the chosen offer and shows Pro only once the server reports it', async () => {
    const server = serveMe(NO_PRO);
    const port = fakeBilling({
      purchase: async () => {
        // The webhook has been applied by the time the app asks again.
        server.entitlements = PRO;
      },
    });
    holder.port = port;
    await render(<PaywallScreen />);
    await fireEvent.press(await screen.findByRole('radio', { name: 'Aylık: 49,99 TL' }));
    await fireEvent.press(screen.getByTestId('paywall-subscribe'));
    expect(await screen.findByTestId('paywall-outcome-pro')).toBeTruthy();
    expect(port.calls).toContain('purchase:kadro_pro_monthly');
    // The profile was re-read from the server and now says Pro: no offers, an active notice.
    expect(await screen.findByTestId('paywall-active')).toBeTruthy();
    expect(screen.queryByTestId('paywall-subscribe')).toBeNull();
    expect(screen.queryByTestId('paywall-restore')).toBeNull();
  });

  it('defaults to the yearly offer', async () => {
    serveMe(NO_PRO);
    const port = fakeBilling({ purchase: () => Promise.reject(new BillingError('cancelled')) });
    holder.port = port;
    await render(<PaywallScreen />);
    await screen.findByRole('radio', { name: 'Yıllık: 399,99 TL' });
    await fireEvent.press(screen.getByTestId('paywall-subscribe'));
    await screen.findByTestId('paywall-outcome-cancelled');
    expect(port.calls).toContain('purchase:kadro_pro_yearly');
  });

  it.each([
    ['cancelled', 'cancelled', /iptal edildi/],
    ['pending', 'pending', /onayı bekliyor/],
    ['network', 'network', /Bağlantı kurulamadı/],
    ['store', 'store', /Mağaza işlemi/],
    ['unknown', 'error', /tamamlanamadı/],
  ] as const)('shows the %s purchase failure without granting Pro', async (kind, outcome, text) => {
    const server = serveMe(NO_PRO);
    holder.port = fakeBilling({ purchase: () => Promise.reject(new BillingError(kind)) });
    await render(<PaywallScreen />);
    await fireEvent.press(await screen.findByTestId('paywall-subscribe'));
    expect(await screen.findByTestId(`paywall-outcome-${outcome}`)).toBeTruthy();
    expect(screen.getByText(text)).toBeTruthy();
    // The offers stay available for another try and the server was not asked to confirm.
    expect(screen.getByTestId('paywall-subscribe')).toBeTruthy();
    expect(server.reads).toBe(1);
  });

  it('says the purchase is still being activated when the server does not report Pro yet', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      serveMe(NO_PRO);
      await render(<PaywallScreen />);
      await fireEvent.press(await screen.findByTestId('paywall-subscribe'));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await screen.findByTestId('paywall-outcome-processing')).toBeTruthy();
      expect(screen.queryByTestId('paywall-active')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores purchases: Pro from the server, or an honest nothing-found', async () => {
    const server = serveMe(NO_PRO);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const port = fakeBilling();
      holder.port = port;
      await render(<PaywallScreen />);
      await fireEvent.press(await screen.findByTestId('paywall-restore'));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await screen.findByTestId('paywall-outcome-notFound')).toBeTruthy();
      expect(port.calls).toContain('restore');
      server.entitlements = PRO;
      await fireEvent.press(screen.getByTestId('paywall-restore'));
      expect(await screen.findByTestId('paywall-outcome-pro')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a restore network failure', async () => {
    serveMe(NO_PRO);
    holder.port = fakeBilling({ restore: () => Promise.reject(new BillingError('network')) });
    await render(<PaywallScreen />);
    await fireEvent.press(await screen.findByTestId('paywall-restore'));
    expect(await screen.findByTestId('paywall-outcome-network')).toBeTruthy();
  });

  it('explains an unavailable build and offers no purchase', async () => {
    serveMe(NO_PRO);
    holder.port = fakeBilling({ available: false });
    await render(<PaywallScreen />);
    expect(await screen.findByTestId('paywall-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('paywall-subscribe')).toBeNull();
    expect(screen.queryByTestId('paywall-restore')).toBeNull();
  });

  it('shows a price list failure with retry, and an empty list as such', async () => {
    serveMe(NO_PRO);
    let failing = true;
    const port = fakeBilling();
    port.loadOffers = async () => {
      if (failing) {
        throw new BillingError('network');
      }
      return [];
    };
    holder.port = port;
    await render(<PaywallScreen />);
    expect(await screen.findByTestId('paywall-offers-error')).toBeTruthy();
    expect(screen.getByText(/Bağlantı kurulamadı/)).toBeTruthy();
    failing = false;
    await fireEvent.press(screen.getByTestId('paywall-offers-retry'));
    expect(await screen.findByTestId('paywall-empty')).toBeTruthy();
  });

  it('shows no upsell to a Pro user, only the status and the way to manage it', async () => {
    serveMe(PRO);
    holder.port = fakeBilling({ managementUrl: 'https://manage.test.invalid/subs' });
    await render(<PaywallScreen />);
    expect(await screen.findByTestId('paywall-active')).toBeTruthy();
    expect(screen.getByText(/Yenileme ya da bitiş tarihi/)).toBeTruthy();
    expect(screen.queryByTestId('paywall-subscribe')).toBeNull();
    await fireEvent.press(screen.getByRole('link', { name: 'Aboneliği yönet' }));
    await waitFor(() => expect(openedURLs()).toEqual(['https://manage.test.invalid/subs']));
  });
});

describe('pro entry points', () => {
  it('shows the locked statistics hint on the profile of a free user and opens the paywall', async () => {
    serveMe(NO_PRO);
    await render(<ProfileTab />);
    expect(await screen.findByTestId('profile-pro-upsell')).toBeTruthy();
    expect(screen.queryByTestId('profile-pro')).toBeNull();
    await fireEvent.press(screen.getByTestId('profile-pro-upsell-open'));
    expect(routerCalls()).toEqual([{ method: 'push', href: '/kadro-pro' }]);
  });

  it('treats a profile without the entitlements member as free', async () => {
    serveMe(undefined);
    await render(<ProfileTab />);
    expect(await screen.findByTestId('profile-pro-upsell')).toBeTruthy();
  });

  it('shows the Pro badge and no upsell on the profile of a Pro user', async () => {
    serveMe(PRO);
    await render(<ProfileTab />);
    expect(await screen.findByTestId('profile-pro')).toBeTruthy();
    expect(screen.queryByTestId('profile-pro-upsell')).toBeNull();
  });

  it('hints at the one-team limit on the create-team screen for a free user only', async () => {
    serveMe(NO_PRO);
    await render(<CreateTeamScreen />);
    expect(await screen.findByTestId('create-team-pro-upsell')).toBeTruthy();
    expect(screen.getByText(/en fazla bir takım/)).toBeTruthy();
  });

  it('offers the paywall again when the server refuses a second team', async () => {
    serveMe(PRO);
    mswServer.use(
      http.post(apiUrl('/api/v1/teams'), () => problem(403, 'entitlement_required', 'req-team-9')),
    );
    await render(<CreateTeamScreen />);
    await screen.findByTestId('team-name');
    expect(screen.queryByTestId('create-team-pro-upsell')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('team-name'), 'Yeni Takım');
    await fireEvent.press(await screen.findByTestId('create-team-submit'));
    expect(await screen.findByTestId('create-team-pro-upsell')).toBeTruthy();
  });

  it('settings: free users see the upsell and no manage link', async () => {
    serveMe(NO_PRO);
    await render(<SettingsScreen />);
    expect(await screen.findByTestId('settings-pro-upsell')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Aboneliği yönet' })).toBeNull();
  });

  it('settings: a subscriber gets the manage link with the store default page', async () => {
    serveMe(PRO);
    await render(<SettingsScreen />);
    await fireEvent.press(await screen.findByRole('link', { name: 'Aboneliği yönet' }));
    await waitFor(() =>
      expect(openedURLs()).toEqual(['https://apps.apple.com/account/subscriptions']),
    );
    expect(screen.queryByTestId('settings-pro-upsell')).toBeNull();
  });

  it('settings: a lapsed subscriber (expired) can still reach store management', async () => {
    serveMe({
      pro: false,
      status: 'expired',
      expiresAt: '2026-01-01T00:00:00.000Z',
      store: 'app_store',
    });
    await render(<SettingsScreen />);
    expect(await screen.findByRole('link', { name: 'Aboneliği yönet' })).toBeTruthy();
    expect(screen.getByTestId('settings-pro-upsell')).toBeTruthy();
  });
});

describe('store customer identity', () => {
  function Identity({
    port,
    status,
    userId,
  }: {
    readonly port: BillingPort;
    readonly status: 'unknown' | 'signedIn' | 'signedOut';
    readonly userId: string | undefined;
  }) {
    useBillingIdentity(port, status, userId);
    return null;
  }

  it('logs the user id in once signed in and the profile is known', async () => {
    const port = fakeBilling();
    const i18n = createTestI18n();
    const { rerender } = await renderWithProviders(
      <Identity port={port} status="signedIn" userId={undefined} />,
      { i18n },
    );
    expect(port.calls).toEqual([]);
    await rerender(
      <TestProviders i18n={i18n}>
        <Identity port={port} status="signedIn" userId={ME_ID} />
      </TestProviders>,
    );
    await waitFor(() => expect(port.calls).toEqual([`logIn:${ME_ID}`]));
  });

  it('does nothing when signed out or when the store is not configured', async () => {
    const port = fakeBilling();
    await render(<Identity port={port} status="signedOut" userId={ME_ID} />);
    const closed = fakeBilling({ available: false });
    await render(<Identity port={closed} status="signedIn" userId={ME_ID} />);
    expect(port.calls).toEqual([]);
    expect(closed.calls).toEqual([]);
  });
});
