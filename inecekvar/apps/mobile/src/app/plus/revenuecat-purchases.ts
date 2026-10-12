import { Purchases, type PurchasesPackage } from '@revenuecat/purchases-capacitor';
import { PLUS_ENTITLEMENT, PlusOffer, PurchaseOutcome, PurchasesAdapter } from './purchases';

type PurchasesApi = Pick<
  typeof Purchases,
  | 'configure'
  | 'isConfigured'
  | 'logIn'
  | 'logOut'
  | 'getOfferings'
  | 'purchasePackage'
  | 'restorePurchases'
  | 'getCustomerInfo'
>;

function periodOf(pkg: PurchasesPackage): PlusOffer['period'] {
  if (pkg.packageType === 'MONTHLY') return 'month';
  if (pkg.packageType === 'ANNUAL') return 'year';
  return 'other';
}

function cancelled(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'userCancelled' in error
    ? (error as { userCancelled?: boolean }).userCancelled === true
    : false;
}

/**
 * Thin binding of `@revenuecat/purchases-capacitor` (native only, ADR-0004). Loaded lazily by
 * `createPurchasesAdapter` inside the native shell with the public SDK key; never on the web.
 * It holds no secret: the public key identifies the app to RevenueCat, the webhook secret and
 * the REST key live on the server (phase 5).
 */
export class RevenueCatPurchases implements PurchasesAdapter {
  readonly kind = 'revenuecat' as const;
  readonly unavailable = null;
  private packages = new Map<string, PurchasesPackage>();

  constructor(
    private readonly publicKey: string,
    private readonly api: PurchasesApi = Purchases,
  ) {}

  async identify(appUserId: string): Promise<void> {
    const { isConfigured } = await this.api.isConfigured();
    if (!isConfigured) {
      await this.api.configure({ apiKey: this.publicKey, appUserID: appUserId });
    } else {
      await this.api.logIn({ appUserID: appUserId });
    }
  }

  async offers(): Promise<PlusOffer[]> {
    const offerings = await this.api.getOfferings();
    const available = offerings.current?.availablePackages ?? [];
    this.packages = new Map(available.map((pkg) => [pkg.identifier, pkg]));
    return available.map((pkg) => ({
      id: pkg.identifier,
      price: pkg.product.price,
      currency: pkg.product.currencyCode,
      period: periodOf(pkg),
    }));
  }

  async purchase(offerId: string): Promise<PurchaseOutcome> {
    const pkg = this.packages.get(offerId);
    if (!pkg) throw new Error('unknown offer');
    try {
      await this.api.purchasePackage({ aPackage: pkg });
      return 'purchased';
    } catch (error) {
      if (cancelled(error)) return 'cancelled';
      throw error;
    }
  }

  async restore(): Promise<void> {
    await this.api.restorePurchases();
  }

  async storeSaysPlus(): Promise<boolean> {
    const { customerInfo } = await this.api.getCustomerInfo();
    return customerInfo.entitlements.active[PLUS_ENTITLEMENT] !== undefined;
  }

  async forget(): Promise<void> {
    try {
      const { isConfigured } = await this.api.isConfigured();
      if (isConfigured) await this.api.logOut();
    } catch {
      // An anonymous RevenueCat user cannot log out; nothing to forget then.
    }
  }
}
