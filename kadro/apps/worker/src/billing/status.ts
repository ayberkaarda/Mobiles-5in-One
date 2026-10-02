import {
  PRO_PRODUCT_IDS,
  type ProProductId,
  type SubscriptionStatus,
  type SubscriptionStore,
} from '@kadro/contracts';

/**
 * Mapping of RevenueCat events and subscriber snapshots onto the normalized subscription state of
 * ADR-0063. Only `active` and `grace_period` grant Pro, so an event that announces a future end
 * (cancellation, pause, billing issue) keeps the in-force status until the expiry it carries has
 * passed; the `EXPIRATION` event or the nightly reconciliation then records the end.
 */

/**
 * Pro product of a store product id. Play Store subscriptions arrive as
 * `<productId>:<basePlanId>`, so only the part before the first colon is compared. `null` for a
 * product outside Kadro Pro.
 */
export function proProductOf(productId: string | null | undefined): ProProductId | null {
  if (productId === null || productId === undefined) {
    return null;
  }
  const base = productId.split(':', 1)[0] ?? '';
  return (PRO_PRODUCT_IDS as readonly string[]).includes(base) ? (base as ProProductId) : null;
}

/** RevenueCat `store` values mapped onto the closed set stored in `subscriptions.store`. */
export function subscriptionStoreOf(store: string | null | undefined): SubscriptionStore | null {
  switch (store) {
    case undefined:
    case null:
    case '':
      return null;
    case 'APP_STORE':
    case 'MAC_APP_STORE':
      return 'app_store';
    case 'PLAY_STORE':
      return 'play_store';
    case 'PROMOTIONAL':
      return 'promotional';
    default:
      return 'other';
  }
}

/** What applying one stored event means for the subscription row. */
export type EventEffect =
  /** Write this status with the event's expiry (subject to the staleness rule). */
  | { readonly kind: 'write'; readonly status: SubscriptionStatus }
  /**
   * `TRANSFER` moves every purchase from the `transferred_from` ids to the receiving id. The stored
   * event keeps only the receiving id (one `app_user_id` column), so the receiving account is read
   * from RevenueCat; the source account loses its rows in the nightly run, which expires rows the
   * provider no longer reports.
   */
  | { readonly kind: 'reconcile' }
  /** Nothing to apply (`TEST` or a type the route already stored as ignored). */
  | { readonly kind: 'none' };

/** True while the access paid for by the event lasts: no expiry, or an expiry after the event. */
function inForce(eventAt: Date, expiresAt: Date | null): boolean {
  return expiresAt === null || expiresAt.getTime() > eventAt.getTime();
}

export function eventEffect(eventType: string, eventAt: Date, expiresAt: Date | null): EventEffect {
  const running = inForce(eventAt, expiresAt);
  switch (eventType) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'UNCANCELLATION':
    case 'NON_RENEWING_PURCHASE':
    case 'SUBSCRIPTION_EXTENDED':
    case 'TEMPORARY_ENTITLEMENT_GRANT':
      return { kind: 'write', status: running ? 'active' : 'expired' };
    case 'CANCELLATION':
      // Auto-renew turned off: Pro stays until the expiry. A refund carries an expiry at or
      // before the event time and ends Pro at once.
      return { kind: 'write', status: running ? 'active' : 'cancelled' };
    case 'SUBSCRIPTION_PAUSED':
      return { kind: 'write', status: running ? 'active' : 'paused' };
    case 'PRODUCT_CHANGE':
      // `product_id` is the product being left; it keeps its access until the carried expiry. The
      // new product's own purchase or renewal event writes its row, so no subscriber read is
      // needed (a change into Pro from another product is stored as `foreign_product`).
      return { kind: 'write', status: running ? 'active' : 'expired' };
    case 'BILLING_ISSUE':
      // Stores extend the expiry by the grace period when they grant one.
      return { kind: 'write', status: running ? 'grace_period' : 'billing_issue' };
    case 'EXPIRATION':
      return { kind: 'write', status: 'expired' };
    case 'TRANSFER':
      return { kind: 'reconcile' };
    default:
      return { kind: 'none' };
  }
}
