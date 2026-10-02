import { createHash } from 'node:crypto';

import { constantTimeEqual } from '@kadro/auth';
import {
  idempotencyKeySchema,
  idSchema,
  isRevenueCatEventType,
  PRO_PRODUCT_IDS,
  type RevenueCatEvent,
  type RevenueCatWebhookBody,
  type SubscriptionStore,
  type WebhookOutcome,
} from '@kadro/contracts';
import { insertWebhookEventIfNew, users, type WebhookEventInput } from '@kadro/db';
import { and, eq } from 'drizzle-orm';

import { ApiError } from '../errors';
import { type Logger } from '../logging';
import { type ServerRuntime } from '../runtime';

/**
 * RevenueCat webhook (ADR-0063). The route stores each delivery once in `webhook_events` with the
 * normalized columns the worker needs, enqueues `webhook.revenuecat.process` for an applicable
 * event in the same transaction, and always answers 200 with the outcome so RevenueCat stops
 * retrying. Neither the raw body nor unknown event fields are stored or logged.
 */

/** Prefix of anonymous RevenueCat ids, which are never linked to an account. */
const ANONYMOUS_PREFIX = '$RCAnonymousID:';

/**
 * Checks the `Authorization` header against `REVENUECAT_WEBHOOK_SECRET` before the body is read.
 * The header may carry the secret alone or as `Bearer <secret>` (the value is whatever is entered
 * in the RevenueCat dashboard). Both comparisons always run and are constant-time. No secret
 * configured → 503 (fail closed); missing or wrong header → 401.
 */
export function verifyRevenueCatRequest(request: Request, runtime: ServerRuntime): void {
  const expected = runtime.env.REVENUECAT_WEBHOOK_SECRET;
  if (expected === undefined) {
    throw new ApiError('service_unavailable');
  }
  const header = request.headers.get('authorization') ?? '';
  const plain = constantTimeEqual(header, expected);
  const bearer = constantTimeEqual(header, `Bearer ${expected}`);
  if (!(plain || bearer)) {
    throw new ApiError('unauthenticated');
  }
}

/**
 * Pro product of a store product id; Play Store products arrive as `<productId>:<basePlanId>`.
 * The worker applies the same rule when it writes the subscription.
 */
export function proProductOf(productId: string | null | undefined): string | null {
  if (productId === null || productId === undefined) {
    return null;
  }
  const base = productId.split(':', 1)[0] ?? '';
  return (PRO_PRODUCT_IDS as readonly string[]).includes(base) ? base : null;
}

function storeOf(store: string | null | undefined): SubscriptionStore | null {
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

/** Account the event is about: for `TRANSFER` the receiving id, otherwise `app_user_id`. */
function targetAppUserId(event: RevenueCatEvent): string | null {
  if (event.type === 'TRANSFER') {
    const receiving = event.transferred_to?.find((id) => idSchema.safeParse(id).success);
    if (receiving !== undefined) {
      return receiving;
    }
  }
  return event.app_user_id ?? null;
}

export type IgnoredReason =
  | 'test_event'
  | 'unhandled_event_type'
  | 'missing_app_user_id'
  | 'anonymous_app_user_id'
  | 'unknown_user'
  | 'foreign_product'
  | 'missing_environment';

/** Why an event cannot be applied without looking at the database, or `null`. */
function staticIgnoredReason(
  event: RevenueCatEvent,
  appUserId: string | null,
): IgnoredReason | null {
  if (event.type === 'TEST') {
    return 'test_event';
  }
  if (!isRevenueCatEventType(event.type)) {
    return 'unhandled_event_type';
  }
  if (appUserId === null) {
    return 'missing_app_user_id';
  }
  if (appUserId.startsWith(ANONYMOUS_PREFIX)) {
    return 'anonymous_app_user_id';
  }
  if (!idSchema.safeParse(appUserId).success) {
    return 'unknown_user';
  }
  if (event.type !== 'TRANSFER' && proProductOf(event.product_id) === null) {
    return 'foreign_product';
  }
  if (event.environment === undefined) {
    return 'missing_environment';
  }
  return null;
}

/**
 * `webhook.revenuecat.process` key: `revenuecat:<event.id>`, or the SHA-256 of the id when the id
 * does not fit the key alphabet or length (RevenueCat ids are UUIDs, so this is a safeguard).
 */
export function processJobKey(eventId: string): string {
  const key = `revenuecat:${eventId}`;
  return idempotencyKeySchema.safeParse(key).success
    ? key
    : `revenuecat:${createHash('sha256').update(eventId, 'utf8').digest('hex')}`;
}

export interface ReceiveResult {
  readonly outcome: WebhookOutcome;
  readonly ignoredReason: IgnoredReason | null;
}

export async function receiveRevenueCatDelivery(
  runtime: ServerRuntime,
  body: RevenueCatWebhookBody,
  rawBody: Uint8Array,
  logger: Logger,
): Promise<ReceiveResult> {
  const { event } = body;
  const appUserId = targetAppUserId(event);
  let ignoredReason = staticIgnoredReason(event, appUserId);

  const result = await runtime.db.transaction(async (tx) => {
    if (ignoredReason === null && appUserId !== null) {
      const known = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, appUserId), eq(users.isTombstone, false)))
        .limit(1);
      if (known.length === 0) {
        ignoredReason = 'unknown_user';
      }
    }
    const row: WebhookEventInput = {
      eventId: event.id,
      payloadHash: createHash('sha256').update(rawBody).digest('hex'),
      eventType: event.type,
      appUserId,
      productId: event.product_id ?? null,
      store: storeOf(event.store),
      environment:
        event.environment === undefined
          ? null
          : event.environment === 'SANDBOX'
            ? 'sandbox'
            : 'production',
      eventAt: new Date(event.event_timestamp_ms),
      expiresAt:
        event.expiration_at_ms === null || event.expiration_at_ms === undefined
          ? null
          : new Date(event.expiration_at_ms),
      outcome: ignoredReason === null ? 'accepted' : 'ignored',
      ignoredReason,
    };
    const inserted = await insertWebhookEventIfNew(tx, row);
    if (!inserted.inserted) {
      return { outcome: 'duplicate', ignoredReason: null } as const;
    }
    if (ignoredReason !== null) {
      return { outcome: 'ignored', ignoredReason } as const;
    }
    await runtime.jobs.enqueue(
      tx,
      'webhook.revenuecat.process',
      { webhookEventId: inserted.id },
      { idempotencyKey: processJobKey(event.id) },
    );
    return { outcome: 'accepted', ignoredReason: null } as const;
  });

  logger.info(
    {
      webhook: 'revenuecat',
      outcome: result.outcome,
      eventType: isRevenueCatEventType(event.type) ? event.type : 'other',
      ...(result.ignoredReason === null ? {} : { ignoredReason: result.ignoredReason }),
    },
    'webhook delivery received',
  );
  return result;
}
