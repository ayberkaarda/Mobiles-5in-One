import { type BillingPort, billingFailure } from './port';

/**
 * Result of a purchase or restore as the screen shows it.
 * - `pro`: the server now reports Pro (`me.entitlements.pro`).
 * - `processing`: the store accepted the purchase but the server does not report Pro yet (the
 *   RevenueCat webhook may lag); the paywall tells the user to check back shortly.
 * - `notFound`: a restore finished and the server still reports no Pro.
 * - the rest are store failures (`BillingFailure`) shown with their own copy.
 */
export type PurchaseOutcome =
  | 'pro'
  | 'processing'
  | 'notFound'
  | 'cancelled'
  | 'pending'
  | 'network'
  | 'store'
  | 'unavailable'
  | 'error';

export interface FlowDeps {
  readonly port: BillingPort;
  /** Re-reads `GET /api/v1/me` and reports whether the server says Pro. May throw. */
  readonly refreshPro: () => Promise<boolean>;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Server reads after a store success before giving up (the webhook is asynchronous). */
  readonly attempts?: number;
  readonly delayMs?: number;
}

const DEFAULT_ATTEMPTS = 4;
const DEFAULT_DELAY_MS = 2_000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Pro is whatever the server reports; a failed read counts as "not yet", never as Pro. */
async function confirmPro({
  refreshPro,
  sleep = defaultSleep,
  attempts = DEFAULT_ATTEMPTS,
  delayMs = DEFAULT_DELAY_MS,
}: FlowDeps): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await sleep(delayMs);
    }
    try {
      if (await refreshPro()) {
        return true;
      }
    } catch {
      // The server read failed (offline, 5xx): try again, then report "processing".
    }
  }
  return false;
}

function failureOutcome(error: unknown): PurchaseOutcome {
  const kind = billingFailure(error);
  switch (kind) {
    case 'cancelled':
    case 'pending':
    case 'network':
    case 'store':
    case 'unavailable':
      return kind;
    case 'alreadyOwned':
      // The store account owns it already: the server may know; otherwise a restore is next.
      return 'processing';
    case 'unknown':
      return 'error';
  }
}

/** Buys an offer, then asks the server whether Pro is active. */
export async function runPurchase(deps: FlowDeps, offerId: string): Promise<PurchaseOutcome> {
  try {
    await deps.port.purchase(offerId);
  } catch (error) {
    const outcome = failureOutcome(error);
    if (outcome !== 'processing') {
      return outcome;
    }
  }
  return (await confirmPro(deps)) ? 'pro' : 'processing';
}

/** Restores the store account's purchases, then asks the server whether Pro is active. */
export async function runRestore(deps: FlowDeps): Promise<PurchaseOutcome> {
  try {
    await deps.port.restore();
  } catch (error) {
    return failureOutcome(error) === 'processing' ? 'notFound' : failureOutcome(error);
  }
  return (await confirmPro(deps)) ? 'pro' : 'notFound';
}
