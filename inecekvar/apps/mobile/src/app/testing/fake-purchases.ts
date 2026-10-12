import { PlusOffer, PurchaseOutcome, PurchasesAdapter } from '../plus/purchases';

/** Deterministic plans of the fake store; the ids are test-only and never shipped. */
export const FAKE_OFFERS: readonly PlusOffer[] = [
  { id: 'iv_fake_plus_monthly', price: 29.99, currency: 'TRY', period: 'month' },
  { id: 'iv_fake_plus_yearly', price: 249.99, currency: 'TRY', period: 'year' },
];

export type FakeStoreFailure = 'identify' | 'offers' | 'purchase' | 'restore';

/**
 * A store for tests (it lives under `testing/`, which no production file imports, so it is not
 * in any build; `apps/mobile` specs check that). Every call is recorded; the controls decide
 * the next answers. Granting Plus here changes only what the fake store reports: the app still
 * leaves every pack decision to the API.
 */
export class FakePurchases implements PurchasesAdapter {
  readonly kind = 'fake' as const;
  readonly unavailable = null;
  readonly calls: string[] = [];
  offersList: PlusOffer[] = [...FAKE_OFFERS];
  private nextOutcome: PurchaseOutcome = 'purchased';
  private failing = new Set<FakeStoreFailure>();
  private active = false;
  identifiedAs: string | null = null;

  /** The next purchase ends with this outcome (the user cancels in the store sheet). */
  answerNextPurchase(outcome: PurchaseOutcome): void {
    this.nextOutcome = outcome;
  }

  fail(step: FakeStoreFailure, failing = true): void {
    if (failing) this.failing.add(step);
    else this.failing.delete(step);
  }

  /** What the store reports about the entitlement, for example after a restore. */
  setStoreEntitlement(active: boolean): void {
    this.active = active;
  }

  async identify(appUserId: string): Promise<void> {
    this.calls.push(`identify:${appUserId}`);
    this.check('identify');
    this.identifiedAs = appUserId;
  }

  async offers(): Promise<PlusOffer[]> {
    this.calls.push('offers');
    this.check('offers');
    return [...this.offersList];
  }

  async purchase(offerId: string): Promise<PurchaseOutcome> {
    this.calls.push(`purchase:${offerId}`);
    this.check('purchase');
    const outcome = this.nextOutcome;
    this.nextOutcome = 'purchased';
    if (outcome === 'purchased') this.active = true;
    return outcome;
  }

  async restore(): Promise<void> {
    this.calls.push('restore');
    this.check('restore');
  }

  async storeSaysPlus(): Promise<boolean> {
    this.calls.push('storeSaysPlus');
    return this.active;
  }

  async forget(): Promise<void> {
    this.calls.push('forget');
    this.identifiedAs = null;
    this.active = false;
  }

  private check(step: FakeStoreFailure): void {
    if (this.failing.has(step)) throw new Error(`fake store: ${step} failed`);
  }
}
