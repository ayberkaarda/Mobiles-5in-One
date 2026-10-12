import { InjectionToken, inject } from '@angular/core';
import { IS_NATIVE_PLATFORM } from '@inecekvar/data-access';
import { environment } from '../../environments/environment';

/** One Plus package as the store sells it. */
export interface PlusOffer {
  id: string;
  /** Store price in major units, for `Intl.NumberFormat` with `currency`. */
  price: number;
  currency: string;
  period: 'month' | 'year' | 'other';
}

export type PurchaseOutcome = 'purchased' | 'cancelled';

/** Why purchases are not offered on this runtime. */
export type PurchasesUnavailable = 'web' | 'not-configured';

/**
 * The store behind Plus. Native builds bind RevenueCat; the web and builds without a public SDK
 * key bind an adapter that sells nothing. Tests bind a deterministic fake. What an adapter
 * reports about the entitlement is a hint for the screen only: the API decides every pack
 * download from its own subscription records (ADR-0024).
 */
export interface PurchasesAdapter {
  readonly kind: 'revenuecat' | 'unavailable' | 'fake';
  /** Set when `kind` is `unavailable`. */
  readonly unavailable: PurchasesUnavailable | null;
  /** Binds purchases to the API account id (the webhook rejects unknown app user ids). */
  identify(appUserId: string): Promise<void>;
  offers(): Promise<PlusOffer[]>;
  purchase(offerId: string): Promise<PurchaseOutcome>;
  restore(): Promise<void>;
  /** The store's own view; informational, never used to unlock anything. */
  storeSaysPlus(): Promise<boolean>;
  /** Forgets the account in the store SDK (sign-out, account deletion). */
  forget(): Promise<void>;
}

/** The RevenueCat entitlement id that Plus maps to (phase 5 configures it in RevenueCat). */
export const PLUS_ENTITLEMENT = 'plus';

class UnavailablePurchases implements PurchasesAdapter {
  readonly kind = 'unavailable' as const;
  constructor(readonly unavailable: PurchasesUnavailable) {}
  async identify(): Promise<void> {
    return undefined;
  }
  async offers(): Promise<PlusOffer[]> {
    return [];
  }
  async purchase(): Promise<PurchaseOutcome> {
    throw new Error(`purchases unavailable: ${this.unavailable}`);
  }
  async restore(): Promise<void> {
    throw new Error(`purchases unavailable: ${this.unavailable}`);
  }
  async storeSaysPlus(): Promise<boolean> {
    return false;
  }
  async forget(): Promise<void> {
    return undefined;
  }
}

/**
 * Picks the adapter: RevenueCat only inside the native shell and only with a public SDK key
 * from the build environment. On the web the plugin module is never imported.
 */
export function createPurchasesAdapter(native: boolean, publicKey: string): PurchasesAdapter {
  if (!native) return new UnavailablePurchases('web');
  if (!/^(goog|appl)_[A-Za-z0-9]{8,}$/.test(publicKey)) {
    return new UnavailablePurchases('not-configured');
  }
  return new LazyRevenueCat(publicKey);
}

/** Loads the RevenueCat adapter (and the plugin) on first use, outside the initial bundle. */
class LazyRevenueCat implements PurchasesAdapter {
  readonly kind = 'revenuecat' as const;
  readonly unavailable = null;
  private adapter: Promise<PurchasesAdapter> | null = null;

  constructor(private readonly publicKey: string) {}

  private get(): Promise<PurchasesAdapter> {
    this.adapter ??= import('./revenuecat-purchases').then(
      ({ RevenueCatPurchases }) => new RevenueCatPurchases(this.publicKey),
    );
    return this.adapter;
  }

  async identify(appUserId: string) {
    return (await this.get()).identify(appUserId);
  }
  async offers() {
    return (await this.get()).offers();
  }
  async purchase(offerId: string) {
    return (await this.get()).purchase(offerId);
  }
  async restore() {
    return (await this.get()).restore();
  }
  async storeSaysPlus() {
    return (await this.get()).storeSaysPlus();
  }
  async forget() {
    if (this.adapter === null) return;
    return (await this.adapter).forget();
  }
}

export const PURCHASES_ADAPTER = new InjectionToken<PurchasesAdapter>('PURCHASES_ADAPTER', {
  providedIn: 'root',
  factory: () =>
    createPurchasesAdapter(inject(IS_NATIVE_PLATFORM), environment.revenueCatPublicKey),
});
