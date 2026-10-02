import {
  type SubscriptionStatus,
  type SubscriptionStore,
  revenueCatAppUserId,
} from '@kadro/contracts';
import { z } from 'zod';

import { type Clock } from '../clock.js';
import { subscriptionStoreOf } from './status.js';

/**
 * Read access to RevenueCat subscriber state for the nightly reconciliation (ADR-0063). The
 * reconciliation depends only on {@link RevenueCatClient}; tests pass an in-memory fake, and the
 * REST implementation below is used only when `REVENUECAT_API_KEY` is configured. The API key and
 * response bodies are never logged; errors carry the HTTP status at most.
 */

export interface SubscriberSubscription {
  /** Store product id as RevenueCat reports it (Play Store: `<productId>:<basePlanId>`). */
  readonly productId: string;
  readonly status: SubscriptionStatus;
  readonly expiresAt: Date | null;
  readonly store: SubscriptionStore | null;
  readonly environment: 'sandbox' | 'production';
}

export interface SubscriberSnapshot {
  /** Provider time of the snapshot; the reconciliation writes it as the event time. */
  readonly readAt: Date;
  readonly subscriptions: readonly SubscriberSubscription[];
}

export interface RevenueCatClient {
  /** The subscriber's state, or `null` when RevenueCat does not know the app user id. */
  getSubscriber(userId: string, signal?: AbortSignal): Promise<SubscriberSnapshot | null>;
}

export type RevenueCatErrorReason =
  'unauthorized' | 'rate_limited' | 'http_status' | 'timeout' | 'network' | 'invalid_response';

export class RevenueCatApiError extends Error {
  constructor(
    readonly reason: RevenueCatErrorReason,
    readonly status?: number,
  ) {
    super(status === undefined ? `revenuecat ${reason}` : `revenuecat ${reason} ${status}`);
    this.name = 'RevenueCatApiError';
  }

  /** A later attempt may succeed (network, timeout, 429, 5xx). */
  get transient(): boolean {
    return (
      this.reason === 'rate_limited' ||
      this.reason === 'timeout' ||
      this.reason === 'network' ||
      (this.reason === 'http_status' && (this.status ?? 0) >= 500)
    );
  }
}

// ---------------------------------------------------------------------------
// Snapshot normalization (REST API v1 `GET /v1/subscribers/{app_user_id}`)
// ---------------------------------------------------------------------------

const isoDate = z.iso.datetime({ offset: true });

const subscriptionSchema = z
  .object({
    expires_date: isoDate.nullable().optional(),
    store: z.string().max(64).optional(),
    is_sandbox: z.boolean().optional(),
    billing_issues_detected_at: isoDate.nullable().optional(),
    grace_period_expires_date: isoDate.nullable().optional(),
    refunded_at: isoDate.nullable().optional(),
  })
  .loose();

export const subscriberResponseSchema = z
  .object({
    request_date_ms: z.int().min(0).optional(),
    subscriber: z
      .object({
        subscriptions: z.record(z.string().min(1).max(200), subscriptionSchema).optional(),
      })
      .loose(),
  })
  .loose();

function dateOrNull(value: string | null | undefined): Date | null {
  return value === null || value === undefined ? null : new Date(value);
}

function statusAt(
  now: Date,
  entry: z.infer<typeof subscriptionSchema>,
  expiresAt: Date | null,
): SubscriptionStatus {
  if (dateOrNull(entry.refunded_at) !== null) {
    return 'cancelled';
  }
  const grace = dateOrNull(entry.grace_period_expires_date);
  if (grace !== null && grace.getTime() > now.getTime()) {
    return 'grace_period';
  }
  const billingIssue = dateOrNull(entry.billing_issues_detected_at) !== null;
  if (expiresAt === null || expiresAt.getTime() > now.getTime()) {
    return billingIssue ? 'grace_period' : 'active';
  }
  return billingIssue ? 'billing_issue' : 'expired';
}

/**
 * Normalizes a v1 subscriber response. `fallbackNow` is used when the response carries no
 * `request_date_ms`. Unknown fields are ignored; a body that does not have the expected shape
 * throws `invalid_response`.
 */
export function normalizeSubscriber(body: unknown, fallbackNow: Date): SubscriberSnapshot {
  const parsed = subscriberResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new RevenueCatApiError('invalid_response');
  }
  const readAt =
    parsed.data.request_date_ms === undefined ? fallbackNow : new Date(parsed.data.request_date_ms);
  const subscriptions = Object.entries(parsed.data.subscriber.subscriptions ?? {}).map(
    ([productId, entry]): SubscriberSubscription => {
      const expiresAt = dateOrNull(entry.expires_date);
      return {
        productId,
        status: statusAt(readAt, entry, expiresAt),
        expiresAt,
        store: subscriptionStoreOf(entry.store),
        environment: entry.is_sandbox === true ? 'sandbox' : 'production',
      };
    },
  );
  return { readAt, subscriptions };
}

// ---------------------------------------------------------------------------
// REST implementation
// ---------------------------------------------------------------------------

export type RevenueCatFetch = (
  url: string,
  init: {
    method: 'GET';
    headers: Record<string, string>;
    signal: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface RevenueCatRestClientOptions {
  readonly apiKey: string;
  /** `REVENUECAT_API_BASE_URL`, e.g. `https://api.revenuecat.com`. */
  readonly baseUrl: string;
  readonly fetch: RevenueCatFetch;
  readonly clock: Clock;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function createRevenueCatRestClient(options: RevenueCatRestClientOptions): RevenueCatClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    async getSubscriber(userId, signal) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const path = `/v1/subscribers/${encodeURIComponent(revenueCatAppUserId(userId))}`;
      let response: Awaited<ReturnType<RevenueCatFetch>>;
      try {
        response = await options.fetch(new URL(path, options.baseUrl).toString(), {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: `Bearer ${options.apiKey}` },
          signal: combined,
        });
      } catch {
        throw new RevenueCatApiError(timeout.aborted ? 'timeout' : 'network');
      }
      if (response.status === 404) {
        return null;
      }
      if (response.status === 401 || response.status === 403) {
        throw new RevenueCatApiError('unauthorized', response.status);
      }
      if (response.status === 429) {
        throw new RevenueCatApiError('rate_limited', response.status);
      }
      if (!response.ok) {
        throw new RevenueCatApiError('http_status', response.status);
      }
      const body = await response.json().catch(() => undefined);
      return normalizeSubscriber(body, options.clock.now());
    },
  };
}
