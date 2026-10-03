/**
 * The store side of Kadro Pro behind one small port. The app and its tests only know this
 * interface; the RevenueCat SDK sits behind `purchases-port.ts`. Pro state never comes from here:
 * a successful purchase only triggers a refresh of `GET /api/v1/me` (the server decides).
 */

/** Store products of Kadro Pro (ADR-0063 decision 2). */
export const PRO_PRODUCT_IDS = {
  monthly: 'kadro_pro_monthly',
  yearly: 'kadro_pro_yearly',
} as const;
export type BillingPeriod = keyof typeof PRO_PRODUCT_IDS;

export interface BillingOffer {
  /** Stable id of the offer inside the port (the product id). */
  readonly id: string;
  readonly period: BillingPeriod;
  /** Localised price as the store formats it. */
  readonly priceString: string;
}

/**
 * - `cancelled`: the user closed the store sheet.
 * - `pending`: the store holds the payment for approval (ask to buy, deferred payment).
 * - `network`: no connection to the store or RevenueCat.
 * - `alreadyOwned`: the store account already owns the product.
 * - `store`: the store refused or had a problem.
 * - `unavailable`: no SDK key for this platform, or the SDK is not set up yet.
 * - `unknown`: anything else.
 */
export type BillingFailure =
  'cancelled' | 'pending' | 'network' | 'alreadyOwned' | 'store' | 'unavailable' | 'unknown';

export class BillingError extends Error {
  readonly kind: BillingFailure;

  constructor(kind: BillingFailure, options?: { readonly cause?: unknown }) {
    super(`billing ${kind}`, { cause: options?.cause });
    this.name = 'BillingError';
    this.kind = kind;
  }
}

export interface BillingPort {
  /** `false` when this build has no SDK key for the platform: the paywall explains it. */
  readonly available: boolean;
  /** Ties the store customer to the Kadro user id (`app_user_id`, ADR-0063 decision 1). */
  logIn(userId: string): Promise<void>;
  /** Forgets the customer; safe to call when nobody is logged in. */
  logOut(): Promise<void>;
  /** The Pro products the store lists, monthly first. Empty when none is configured. */
  loadOffers(): Promise<readonly BillingOffer[]>;
  /** Starts the store purchase of an offer. Resolves when the store reports success. */
  purchase(offerId: string): Promise<void>;
  /** Asks the store for the purchases of this store account. */
  restore(): Promise<void>;
  /** The subscription management page the SDK knows, when it knows one. */
  managementUrl(): Promise<string | null>;
}

/** Port of a build without store configuration: everything is closed, nothing throws at start-up. */
export const unavailableBillingPort: BillingPort = {
  available: false,
  logIn: () => Promise.resolve(),
  logOut: () => Promise.resolve(),
  loadOffers: () => Promise.reject(new BillingError('unavailable')),
  purchase: () => Promise.reject(new BillingError('unavailable')),
  restore: () => Promise.reject(new BillingError('unavailable')),
  managementUrl: () => Promise.resolve(null),
};

/** The failure kind of any thrown value. */
export function billingFailure(error: unknown): BillingFailure {
  return error instanceof BillingError ? error.kind : 'unknown';
}
