import { z } from 'zod';

import { idSchema, isoDateTimeSchema } from './common.js';
import { LIMITS } from './limits.js';

/**
 * Kadro Pro billing contract (spec §3 item 10, security checklist item 17, ADR-0063).
 *
 * Entitlement state comes only from the `subscriptions` table, which is written by webhook
 * processing and the nightly reconciliation; a claim from the client or from the purchase SDK on
 * the device is never trusted (authorization matrix §7). The RevenueCat `app_user_id` of a user is
 * exactly `users.id`, so the server never keeps a second identifier for the same person.
 */

/** RevenueCat entitlement identifier that unlocks Kadro Pro. */
export const PRO_ENTITLEMENT_ID = 'pro';

/** Store products of Kadro Pro. Prices live in the stores, never in the code. */
export const PRO_PRODUCT_IDS = ['kadro_pro_monthly', 'kadro_pro_yearly'] as const;
export const proProductIdSchema = z.enum(PRO_PRODUCT_IDS);
export type ProProductId = z.infer<typeof proProductIdSchema>;

/**
 * Normalized subscription state, identical to the `subscription_status` database enum. Only
 * `active` and `grace_period` grant Pro (`PRO_STATUSES`).
 */
export const SUBSCRIPTION_STATUSES = [
  'active',
  'grace_period',
  'billing_issue',
  'paused',
  'cancelled',
  'expired',
] as const;
export const subscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

export const PRO_STATUSES = [
  'active',
  'grace_period',
] as const satisfies readonly SubscriptionStatus[];

/** True when a subscription in `status` grants the Pro entitlement. */
export function grantsPro(status: SubscriptionStatus): boolean {
  return (PRO_STATUSES as readonly SubscriptionStatus[]).includes(status);
}

/** Store that sold the subscription; RevenueCat store names are mapped onto this closed set. */
export const SUBSCRIPTION_STORES = ['app_store', 'play_store', 'promotional', 'other'] as const;
export const subscriptionStoreSchema = z.enum(SUBSCRIPTION_STORES);
export type SubscriptionStore = z.infer<typeof subscriptionStoreSchema>;

/** `none`: the user never had a subscription row. */
export const ENTITLEMENT_STATUSES = ['none', ...SUBSCRIPTION_STATUSES] as const;
export const entitlementStatusSchema = z.enum(ENTITLEMENT_STATUSES);
export type EntitlementStatus = z.infer<typeof entitlementStatusSchema>;

/**
 * `entitlements` member of `GET /api/v1/me`: the caller's own Pro state as the server sees it.
 * `pro` is the only field a client may use to show or hide Pro features; the server enforces the
 * same value on every gated action. `status`, `expiresAt` and `store` describe the subscription
 * that decides `pro` (the one with the latest expiry), for the settings screen and support.
 */
export const entitlementsSchema = z
  .strictObject({
    pro: z.boolean(),
    status: entitlementStatusSchema,
    expiresAt: isoDateTimeSchema.nullable(),
    store: subscriptionStoreSchema.nullable(),
  })
  .refine((value) => value.pro === (value.status === 'active' || value.status === 'grace_period'), {
    message: 'pro must be true exactly for active and grace_period',
    path: ['pro'],
  })
  .refine(
    (value) => value.status !== 'none' || (value.expiresAt === null && value.store === null),
    {
      message: 'status none has no expiry and no store',
      path: ['status'],
    },
  );
export type Entitlements = z.infer<typeof entitlementsSchema>;

/** Entitlements of a user without any subscription row. */
export const NO_ENTITLEMENTS: Entitlements = {
  pro: false,
  status: 'none',
  expiresAt: null,
  store: null,
};

/**
 * RevenueCat `app_user_id` of a Kadro user: the user id itself (UUIDv7). The mobile app calls
 * `Purchases.logIn(userId)` after sign-in and `logOut()` on sign-out; anonymous RevenueCat ids are
 * never linked to an account.
 */
export const revenueCatAppUserIdSchema = idSchema;

export function revenueCatAppUserId(userId: string): string {
  return userId;
}

// ---------------------------------------------------------------------------
// Webhook (POST /api/v1/webhooks/revenuecat)
// ---------------------------------------------------------------------------

/**
 * Event types the processing job applies. Any other `type` is stored and answered with
 * `ignored`, so a new event type on the RevenueCat side never causes retries.
 */
export const REVENUECAT_EVENT_TYPES = [
  'TEST',
  'INITIAL_PURCHASE',
  'RENEWAL',
  'CANCELLATION',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  'SUBSCRIPTION_PAUSED',
  'EXPIRATION',
  'BILLING_ISSUE',
  'PRODUCT_CHANGE',
  'SUBSCRIPTION_EXTENDED',
  'TEMPORARY_ENTITLEMENT_GRANT',
  'TRANSFER',
] as const;
export type RevenueCatEventType = (typeof REVENUECAT_EVENT_TYPES)[number];

export function isRevenueCatEventType(value: string): value is RevenueCatEventType {
  return (REVENUECAT_EVENT_TYPES as readonly string[]).includes(value);
}

/** Fields the server keys on: never empty. */
const rcText = (max: number) => z.string().min(1).max(max);
/**
 * Descriptive provider fields: bounded only. RevenueCat may send an empty string, and failing the
 * delivery on it would answer 400 and make RevenueCat retry the same event forever.
 */
const rcOptionalText = (max: number) => z.string().max(max);
const epochMs = z.int().min(0).max(LIMITS.revenueCatEpochMsMax);

/**
 * The `event` object of a RevenueCat webhook delivery. It is a loose object on purpose: RevenueCat
 * adds fields without notice, and a delivery must not fail validation because of them. The fields
 * listed here are the ones the server reads; each is bounded. Unknown fields are never stored:
 * the route keeps only the normalized columns it needs and a SHA-256 of the raw body.
 */
export const revenueCatEventSchema = z.looseObject({
  id: rcText(LIMITS.revenueCatEventId.max),
  type: rcText(64),
  event_timestamp_ms: epochMs,
  app_user_id: rcText(LIMITS.revenueCatAppUserId.max).optional(),
  original_app_user_id: rcOptionalText(LIMITS.revenueCatAppUserId.max).nullable().optional(),
  aliases: z.array(rcText(LIMITS.revenueCatAppUserId.max)).max(50).nullable().optional(),
  product_id: rcOptionalText(200).nullable().optional(),
  entitlement_ids: z.array(rcText(100)).max(50).nullable().optional(),
  period_type: rcOptionalText(32).nullable().optional(),
  purchased_at_ms: epochMs.nullable().optional(),
  expiration_at_ms: epochMs.nullable().optional(),
  store: rcOptionalText(32).nullable().optional(),
  environment: z.enum(['SANDBOX', 'PRODUCTION']).optional(),
  transaction_id: rcOptionalText(200).nullable().optional(),
  original_transaction_id: rcOptionalText(200).nullable().optional(),
  transferred_from: z.array(rcText(LIMITS.revenueCatAppUserId.max)).max(50).nullable().optional(),
  transferred_to: z.array(rcText(LIMITS.revenueCatAppUserId.max)).max(50).nullable().optional(),
});
export type RevenueCatEvent = z.infer<typeof revenueCatEventSchema>;

/**
 * Body of `POST /api/v1/webhooks/revenuecat`: a strict envelope around a loose `event`. The route
 * reads the raw body first (signature-style secret check over the `Authorization` header with
 * `crypto.timingSafeEqual`), then parses it with this schema.
 */
export const revenueCatWebhookBodySchema = z.strictObject({
  api_version: z.string().regex(/^[0-9]{1,3}\.[0-9]{1,3}$/, 'must be a version such as 1.0'),
  event: revenueCatEventSchema,
});
export type RevenueCatWebhookBody = z.infer<typeof revenueCatWebhookBodySchema>;

/**
 * Outcome of one delivery, always with HTTP 200 so RevenueCat stops retrying:
 * - `accepted`: stored in `webhook_events` and `webhook.revenuecat.process` enqueued;
 * - `duplicate`: the `event.id` was already stored (replay or retry), nothing enqueued;
 * - `ignored`: stored but not applied (unknown or anonymous `app_user_id`, `TEST`, an event type
 *   outside `REVENUECAT_EVENT_TYPES`, or a product outside `PRO_PRODUCT_IDS`).
 */
export const WEBHOOK_OUTCOMES = ['accepted', 'duplicate', 'ignored'] as const;
export const webhookOutcomeSchema = z.enum(WEBHOOK_OUTCOMES);
export type WebhookOutcome = z.infer<typeof webhookOutcomeSchema>;

export const revenueCatWebhookResponseSchema = z.strictObject({
  status: webhookOutcomeSchema,
});
export type RevenueCatWebhookResponse = z.infer<typeof revenueCatWebhookResponseSchema>;
