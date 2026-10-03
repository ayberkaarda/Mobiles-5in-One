import { describe, expect, it, vi } from 'vitest';

import { runPurchase, runRestore } from '../src/billing/flow';
import { manageSubscriptionUrl, storeTermsUrl } from '../src/billing/links';
import {
  BillingError,
  type BillingPort,
  PRO_PRODUCT_IDS,
  unavailableBillingPort,
} from '../src/billing/port';
import {
  createPurchasesPort,
  type PurchasesSdk,
  type SdkPackage,
} from '../src/billing/purchases-port';

const USER_ID = '0192a0b0-0000-7000-8000-0000000000f1';
const OTHER_ID = '0192a0b0-0000-7000-8000-0000000000f2';

function pack(identifier: string, priceString: string): SdkPackage {
  return { product: { identifier, priceString } };
}

/** An in-memory stand-in for the RevenueCat SDK; it records every call. */
function fakeSdk(
  options: {
    current?: SdkPackage[];
    others?: Record<string, SdkPackage[]>;
    purchaseError?: unknown;
    restoreError?: unknown;
    offeringsError?: unknown;
    managementURL?: string | null;
  } = {},
) {
  const calls: string[] = [];
  const purchased: SdkPackage[] = [];
  const sdk: PurchasesSdk = {
    configure: ({ apiKey, appUserID }) => {
      calls.push(`configure:${apiKey}:${appUserID}`);
    },
    logIn: async (id) => {
      calls.push(`logIn:${id}`);
    },
    logOut: async () => {
      calls.push('logOut');
    },
    getOfferings: async () => {
      calls.push('getOfferings');
      if (options.offeringsError !== undefined) {
        throw options.offeringsError as Error;
      }
      return {
        current: options.current === undefined ? null : { availablePackages: options.current },
        all: Object.fromEntries(
          Object.entries(options.others ?? {}).map(([key, list]) => [
            key,
            { availablePackages: list },
          ]),
        ),
      };
    },
    purchasePackage: async (item) => {
      calls.push('purchase');
      if (options.purchaseError !== undefined) {
        throw options.purchaseError as Error;
      }
      purchased.push(item);
    },
    restorePurchases: async () => {
      calls.push('restore');
      if (options.restoreError !== undefined) {
        throw options.restoreError as Error;
      }
    },
    getCustomerInfo: async () => ({ managementURL: options.managementURL ?? null }),
  };
  return { sdk, calls, purchased };
}

const MONTHLY = pack(PRO_PRODUCT_IDS.monthly, '49,99 TL');
const YEARLY = pack(PRO_PRODUCT_IDS.yearly, '399,99 TL');

async function failureOf(task: Promise<unknown>): Promise<string> {
  try {
    await task;
  } catch (error) {
    return error instanceof BillingError ? error.kind : 'not-a-billing-error';
  }
  return 'no-error';
}

describe('purchases port', () => {
  it('configures the SDK once with the user id as app user id, then switches with logIn', async () => {
    const { sdk, calls } = fakeSdk();
    const port = createPurchasesPort({ sdk, apiKey: 'test-sdk-key' });
    await port.logIn(USER_ID);
    await port.logIn(USER_ID);
    await port.logIn(OTHER_ID);
    expect(calls).toEqual([`configure:test-sdk-key:${USER_ID}`, `logIn:${OTHER_ID}`]);
  });

  it('logs out only a logged-in customer and logs the same user in again afterwards', async () => {
    const { sdk, calls } = fakeSdk();
    const port = createPurchasesPort({ sdk, apiKey: 'test-sdk-key' });
    await port.logOut();
    expect(calls).toEqual([]);
    await port.logIn(USER_ID);
    await port.logOut();
    await port.logOut();
    await port.logIn(USER_ID);
    expect(calls).toEqual([`configure:test-sdk-key:${USER_ID}`, 'logOut', `logIn:${USER_ID}`]);
  });

  it('refuses store calls before a user is logged in', async () => {
    const { sdk, calls } = fakeSdk({ current: [MONTHLY] });
    const port = createPurchasesPort({ sdk, apiKey: 'test-sdk-key' });
    expect(await failureOf(port.loadOffers())).toBe('unavailable');
    expect(await failureOf(port.purchase(PRO_PRODUCT_IDS.monthly))).toBe('unavailable');
    expect(await failureOf(port.restore())).toBe('unavailable');
    expect(await port.managementUrl()).toBeNull();
    expect(calls).toEqual([]);
  });

  it('lists only the two Pro products, monthly first, from any offering', async () => {
    const { sdk } = fakeSdk({
      current: [pack('other_product', '1 TL'), YEARLY],
      others: { extra: [pack(`${PRO_PRODUCT_IDS.monthly}:base-plan`, '49,99 TL'), YEARLY] },
    });
    const port = createPurchasesPort({ sdk, apiKey: 'test-sdk-key' });
    await port.logIn(USER_ID);
    expect(await port.loadOffers()).toEqual([
      { id: 'kadro_pro_monthly', period: 'monthly', priceString: '49,99 TL' },
      { id: 'kadro_pro_yearly', period: 'yearly', priceString: '399,99 TL' },
    ]);
  });

  it('returns no offers when the store lists none', async () => {
    const { sdk } = fakeSdk();
    const port = createPurchasesPort({ sdk, apiKey: 'test-sdk-key' });
    await port.logIn(USER_ID);
    expect(await port.loadOffers()).toEqual([]);
  });

  it('purchases the package behind an offer, loading the list first when needed', async () => {
    const { sdk, calls, purchased } = fakeSdk({ current: [MONTHLY, YEARLY] });
    const port = createPurchasesPort({ sdk, apiKey: 'test-sdk-key' });
    await port.logIn(USER_ID);
    await port.purchase(PRO_PRODUCT_IDS.yearly);
    expect(purchased).toEqual([YEARLY]);
    expect(calls).toContain('getOfferings');
    expect(await failureOf(port.purchase('unknown_product'))).toBe('unavailable');
  });

  it.each([
    ['user cancelled flag', { userCancelled: true, code: '1' }, 'cancelled'],
    ['cancelled code', { code: '1' }, 'cancelled'],
    ['pending payment', { code: '20' }, 'pending'],
    ['network error', { code: '10' }, 'network'],
    ['offline', { code: '35' }, 'network'],
    ['already purchased', { code: '6' }, 'alreadyOwned'],
    ['store problem', { code: '2' }, 'store'],
    ['numeric code', { code: 20 }, 'pending'],
    ['unknown code', { code: '99' }, 'unknown'],
    ['not an object', 'boom', 'unknown'],
  ])('maps a purchase failure (%s) to %s', async (_name, error, kind) => {
    const { sdk } = fakeSdk({ current: [MONTHLY], purchaseError: error });
    const port = createPurchasesPort({ sdk, apiKey: 'test-sdk-key' });
    await port.logIn(USER_ID);
    expect(await failureOf(port.purchase(PRO_PRODUCT_IDS.monthly))).toBe(kind);
  });

  it('maps restore and offering failures too', async () => {
    const restoring = fakeSdk({ restoreError: { code: '10' } });
    const port = createPurchasesPort({ sdk: restoring.sdk, apiKey: 'test-sdk-key' });
    await port.logIn(USER_ID);
    expect(await failureOf(port.restore())).toBe('network');

    const listing = fakeSdk({ offeringsError: { code: '2' } });
    const other = createPurchasesPort({ sdk: listing.sdk, apiKey: 'test-sdk-key' });
    await other.logIn(USER_ID);
    expect(await failureOf(other.loadOffers())).toBe('store');
  });

  it('reads the management URL from the customer info, and null when that fails', async () => {
    const { sdk } = fakeSdk({ managementURL: 'https://manage.test.invalid/subscriptions' });
    const port = createPurchasesPort({ sdk, apiKey: 'test-sdk-key' });
    await port.logIn(USER_ID);
    expect(await port.managementUrl()).toBe('https://manage.test.invalid/subscriptions');
    const broken: PurchasesSdk = {
      ...sdk,
      getCustomerInfo: () => Promise.reject(new Error('offline')),
    };
    const second = createPurchasesPort({ sdk: broken, apiKey: 'test-sdk-key' });
    await second.logIn(USER_ID);
    expect(await second.managementUrl()).toBeNull();
  });
});

describe('unavailable port', () => {
  it('is closed: logIn and logOut are no-ops, store calls fail as unavailable', async () => {
    expect(unavailableBillingPort.available).toBe(false);
    await unavailableBillingPort.logIn(USER_ID);
    await unavailableBillingPort.logOut();
    expect(await failureOf(unavailableBillingPort.loadOffers())).toBe('unavailable');
    expect(await failureOf(unavailableBillingPort.purchase('x'))).toBe('unavailable');
    expect(await unavailableBillingPort.managementUrl()).toBeNull();
  });
});

function fakePort(overrides: Partial<BillingPort> = {}): BillingPort {
  return {
    available: true,
    logIn: async () => undefined,
    logOut: async () => undefined,
    loadOffers: async () => [],
    purchase: async () => undefined,
    restore: async () => undefined,
    managementUrl: async () => null,
    ...overrides,
  };
}

const noSleep = async (): Promise<void> => undefined;

describe('purchase and restore flow', () => {
  it('reports pro only when the server says so after the store succeeded', async () => {
    const refreshPro = vi.fn().mockResolvedValue(true);
    expect(await runPurchase({ port: fakePort(), refreshPro, sleep: noSleep }, 'x')).toBe('pro');
    expect(refreshPro).toHaveBeenCalledTimes(1);
  });

  it('keeps asking the server while the webhook lags, then gives up as processing', async () => {
    const answers = [false, false, true];
    const refreshPro = vi.fn(async () => answers.shift() ?? false);
    const sleep = vi.fn(noSleep);
    expect(await runPurchase({ port: fakePort(), refreshPro, sleep }, 'x')).toBe('pro');
    expect(refreshPro).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);

    const never = vi.fn().mockResolvedValue(false);
    expect(
      await runPurchase({ port: fakePort(), refreshPro: never, sleep: noSleep, attempts: 3 }, 'x'),
    ).toBe('processing');
    expect(never).toHaveBeenCalledTimes(3);
  });

  it('treats a failing server read as not yet pro, never as pro', async () => {
    const refreshPro = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await runPurchase({ port: fakePort(), refreshPro, sleep: noSleep }, 'x')).toBe(
      'processing',
    );
  });

  it.each([
    ['cancelled', 'cancelled'],
    ['pending', 'pending'],
    ['network', 'network'],
    ['store', 'store'],
    ['unavailable', 'unavailable'],
    ['unknown', 'error'],
  ] as const)('maps a %s store failure to %s without asking the server', async (kind, outcome) => {
    const refreshPro = vi.fn().mockResolvedValue(true);
    const port = fakePort({ purchase: () => Promise.reject(new BillingError(kind)) });
    expect(await runPurchase({ port, refreshPro, sleep: noSleep }, 'x')).toBe(outcome);
    expect(refreshPro).not.toHaveBeenCalled();
  });

  it('checks the server when the store account already owns the product', async () => {
    const refreshPro = vi.fn().mockResolvedValue(true);
    const port = fakePort({ purchase: () => Promise.reject(new BillingError('alreadyOwned')) });
    expect(await runPurchase({ port, refreshPro, sleep: noSleep }, 'x')).toBe('pro');
  });

  it('restores: pro when the server agrees, notFound when it does not, failures as such', async () => {
    const yes = vi.fn().mockResolvedValue(true);
    expect(await runRestore({ port: fakePort(), refreshPro: yes, sleep: noSleep })).toBe('pro');
    const no = vi.fn().mockResolvedValue(false);
    expect(
      await runRestore({ port: fakePort(), refreshPro: no, sleep: noSleep, attempts: 2 }),
    ).toBe('notFound');
    const port = fakePort({ restore: () => Promise.reject(new BillingError('network')) });
    expect(await runRestore({ port, refreshPro: yes, sleep: noSleep })).toBe('network');
  });
});

describe('store links', () => {
  it('prefers the SDK management URL when it is https, else the store default', () => {
    expect(manageSubscriptionUrl('https://manage.test.invalid/x', 'ios')).toBe(
      'https://manage.test.invalid/x',
    );
    expect(manageSubscriptionUrl('http://insecure.test.invalid', 'ios')).toBe(
      'https://apps.apple.com/account/subscriptions',
    );
    expect(manageSubscriptionUrl(null, 'android')).toBe(
      'https://play.google.com/store/account/subscriptions',
    );
    expect(manageSubscriptionUrl(null, 'web')).toBeNull();
  });

  it('links the standard store terms per platform', () => {
    expect(storeTermsUrl('ios')).toContain('apple.com/legal');
    expect(storeTermsUrl('android')).toContain('play.google.com');
    expect(storeTermsUrl('web')).toBeNull();
  });
});
