import {
  BillingError,
  type BillingFailure,
  type BillingOffer,
  type BillingPeriod,
  type BillingPort,
  PRO_PRODUCT_IDS,
} from './port';

/** The part of a store package the port reads. */
export interface SdkPackage {
  readonly product: { readonly identifier: string; readonly priceString: string };
}

interface SdkOffering {
  readonly availablePackages: readonly SdkPackage[];
}

/** The slice of `react-native-purchases` the port uses; a fake implements it in tests. */
export interface PurchasesSdk {
  configure(configuration: { apiKey: string; appUserID: string }): void;
  logIn(appUserID: string): Promise<unknown>;
  logOut(): Promise<unknown>;
  getOfferings(): Promise<{
    readonly current: SdkOffering | null;
    readonly all: Readonly<Record<string, SdkOffering>>;
  }>;
  purchasePackage(pack: SdkPackage): Promise<unknown>;
  restorePurchases(): Promise<unknown>;
  getCustomerInfo(): Promise<{ readonly managementURL: string | null }>;
}

/** `PURCHASES_ERROR_CODE` values the port tells apart (they are strings in the SDK). */
export interface SdkErrorCodes {
  readonly cancelled: string;
  readonly pending: string;
  readonly network: readonly string[];
  readonly alreadyOwned: readonly string[];
  readonly store: readonly string[];
}

/** RevenueCat error codes: cancelled 1, pending 20, network 10 / offline 35, store 2 / 3. */
export const SDK_ERROR_CODES: SdkErrorCodes = {
  cancelled: '1',
  pending: '20',
  network: ['10', '35'],
  alreadyOwned: ['6', '7'],
  store: ['2', '3'],
};

function failureOf(error: unknown, codes: SdkErrorCodes): BillingFailure {
  if (error instanceof BillingError) {
    return error.kind;
  }
  if (typeof error !== 'object' || error === null) {
    return 'unknown';
  }
  const { code, userCancelled } = error as { code?: unknown; userCancelled?: unknown };
  const text = typeof code === 'string' || typeof code === 'number' ? String(code) : '';
  if (userCancelled === true || text === codes.cancelled) {
    return 'cancelled';
  }
  if (text === codes.pending) {
    return 'pending';
  }
  if (codes.network.includes(text)) {
    return 'network';
  }
  if (codes.alreadyOwned.includes(text)) {
    return 'alreadyOwned';
  }
  if (codes.store.includes(text)) {
    return 'store';
  }
  return 'unknown';
}

/** Play Store product ids carry the base plan (`<id>:<basePlan>`). */
function periodOf(productIdentifier: string): BillingPeriod | null {
  const id = productIdentifier.split(':')[0];
  if (id === PRO_PRODUCT_IDS.monthly) {
    return 'monthly';
  }
  return id === PRO_PRODUCT_IDS.yearly ? 'yearly' : null;
}

function productIdOf(period: BillingPeriod): string {
  return period === 'monthly' ? PRO_PRODUCT_IDS.monthly : PRO_PRODUCT_IDS.yearly;
}

interface Listed {
  readonly offer: BillingOffer;
  readonly pack: SdkPackage;
}

/**
 * RevenueCat behind the billing port. The SDK is configured on the first `logIn` with the user id
 * as `appUserID`, so no anonymous RevenueCat id is ever created for a signed-in user. Not
 * exercised against the real service (no account or keys exist); the unit tests use a fake SDK.
 */
export function createPurchasesPort({
  sdk,
  apiKey,
  codes = SDK_ERROR_CODES,
}: {
  readonly sdk: PurchasesSdk;
  readonly apiKey: string;
  readonly codes?: SdkErrorCodes;
}): BillingPort {
  let configured = false;
  let currentUser: string | null = null;
  // Identity changes run one after the other: a quick sign-out and sign-in must not interleave.
  let identity: Promise<void> = Promise.resolve();
  let listed = new Map<string, Listed>();

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    const next = identity.then(task);
    identity = next.catch(() => undefined);
    return next;
  };

  const guard = async <T>(task: () => Promise<T>): Promise<T> => {
    try {
      return await task();
    } catch (error) {
      throw new BillingError(failureOf(error, codes), { cause: error });
    }
  };

  const requireIdentity = async (): Promise<void> => {
    await identity;
    if (!configured || currentUser === null) {
      throw new BillingError('unavailable');
    }
  };

  const loadOffers = async (): Promise<readonly BillingOffer[]> => {
    await requireIdentity();
    const offerings = await guard(() => sdk.getOfferings());
    const found = new Map<string, Listed>();
    for (const offering of [offerings.current, ...Object.values(offerings.all)]) {
      for (const pack of offering?.availablePackages ?? []) {
        const period = periodOf(pack.product.identifier);
        if (period !== null && !found.has(productIdOf(period))) {
          const offer: BillingOffer = {
            id: productIdOf(period),
            period,
            priceString: pack.product.priceString,
          };
          found.set(offer.id, { offer, pack });
        }
      }
    }
    listed = found;
    return (['monthly', 'yearly'] as const).flatMap((period) => {
      const entry = found.get(productIdOf(period));
      return entry === undefined ? [] : [entry.offer];
    });
  };

  return {
    available: true,
    logIn: (userId) =>
      enqueue(async () => {
        if (!configured) {
          sdk.configure({ apiKey, appUserID: userId });
          configured = true;
          currentUser = userId;
          return;
        }
        if (currentUser !== userId) {
          await sdk.logIn(userId);
          currentUser = userId;
        }
      }),
    logOut: () =>
      enqueue(async () => {
        if (configured && currentUser !== null) {
          currentUser = null;
          listed = new Map();
          await sdk.logOut();
        }
      }),
    loadOffers,
    async purchase(offerId) {
      await requireIdentity();
      let entry = listed.get(offerId);
      if (entry === undefined) {
        await loadOffers();
        entry = listed.get(offerId);
      }
      if (entry === undefined) {
        throw new BillingError('unavailable');
      }
      const { pack } = entry;
      await guard(() => sdk.purchasePackage(pack));
    },
    async restore() {
      await requireIdentity();
      await guard(() => sdk.restorePurchases());
    },
    async managementUrl() {
      await identity;
      if (!configured || currentUser === null) {
        return null;
      }
      try {
        return (await sdk.getCustomerInfo()).managementURL;
      } catch {
        return null;
      }
    },
  };
}
