import { type WebEnv } from '@kadro/config';
import { type Database, rateLimitBuckets } from '@kadro/db';
import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';

import { ApiError } from './errors';
import { type KeyedHasher } from './keyed-hash';

/**
 * Rate limiting on PostgreSQL (security checklist item 5; no Redis). Counters live in
 * `rate_limit_buckets` as one row per key and sub-window ("sliding window counter"): a window
 * of W seconds is split into 15 buckets of W/15 seconds, and a request is admitted while the
 * sum over the buckets that overlap the last W seconds stays below the limit. Every check runs in
 * a transaction holding a per-key advisory lock, so concurrent requests cannot both take the
 * last slot. Rejected requests are not counted. Rows older than the window are deleted on the
 * next hit of the same key.
 */

export interface SlidingWindowRule {
  readonly max: number;
  readonly windowSeconds: number;
}

export type RateLimitResult =
  | { readonly allowed: true; readonly count: number }
  | { readonly allowed: false; readonly count: number; readonly retryAfterSeconds: number };

const BUCKETS_PER_WINDOW = 15;

function granularityMs(rule: SlidingWindowRule): number {
  return Math.max(1, Math.floor(rule.windowSeconds / BUCKETS_PER_WINDOW)) * 1_000;
}

/** Buckets that started after this instant still overlap the window ending at `now`. */
function cutoff(rule: SlidingWindowRule, now: Date): Date {
  return new Date(now.getTime() - rule.windowSeconds * 1_000 - granularityMs(rule));
}

function bucketStart(rule: SlidingWindowRule, now: Date): Date {
  const step = granularityMs(rule);
  return new Date(Math.floor(now.getTime() / step) * step);
}

type Executor = Pick<Database, 'select' | 'insert' | 'delete' | 'execute'>;

async function lockKey(tx: Executor, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

async function liveBuckets(
  tx: Executor,
  key: string,
  rule: SlidingWindowRule,
  now: Date,
): Promise<{ windowStart: Date; count: number }[]> {
  return tx
    .select({ windowStart: rateLimitBuckets.windowStart, count: rateLimitBuckets.count })
    .from(rateLimitBuckets)
    .where(and(eq(rateLimitBuckets.key, key), gt(rateLimitBuckets.windowStart, cutoff(rule, now))))
    .orderBy(asc(rateLimitBuckets.windowStart));
}

/** Seconds until enough of the oldest buckets leave the window for one more request to fit. */
function retryAfter(
  buckets: readonly { windowStart: Date; count: number }[],
  total: number,
  rule: SlidingWindowRule,
  now: Date,
): number {
  let remaining = total;
  for (const bucket of buckets) {
    remaining -= bucket.count;
    if (remaining < rule.max) {
      const expiresAt =
        bucket.windowStart.getTime() + granularityMs(rule) + rule.windowSeconds * 1_000;
      return Math.max(1, Math.ceil((expiresAt - now.getTime()) / 1_000));
    }
  }
  return rule.windowSeconds;
}

export class SlidingWindowLimiter {
  constructor(
    private readonly db: Database,
    private readonly clock: () => Date,
  ) {}

  /** Counts one request against `key` if the limit allows it. */
  async hit(key: string, rule: SlidingWindowRule): Promise<RateLimitResult> {
    return this.hitAll([key], rule);
  }

  /**
   * Counts one request against every key, all or nothing: when any key is exhausted, none is
   * charged, so a request rejected for one subject (say, its IP) never consumes the quota of
   * another (an email it named). Keys are locked in sorted order inside one transaction, which
   * keeps concurrent callers with overlapping keys free of deadlocks. The result reports the
   * highest count and, when rejected, the longest `retryAfterSeconds` of the exhausted keys.
   */
  async hitAll(keys: readonly string[], rule: SlidingWindowRule): Promise<RateLimitResult> {
    const unique = [...new Set(keys)].sort();
    if (unique.length === 0) {
      throw new RangeError('hitAll needs at least one key');
    }
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      let highest = 0;
      let retryAfterSeconds = 0;
      for (const key of unique) {
        await lockKey(tx, key);
        await tx
          .delete(rateLimitBuckets)
          .where(
            and(
              eq(rateLimitBuckets.key, key),
              lte(rateLimitBuckets.windowStart, cutoff(rule, now)),
            ),
          );
        const buckets = await liveBuckets(tx, key, rule, now);
        const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
        highest = Math.max(highest, total);
        if (total >= rule.max) {
          retryAfterSeconds = Math.max(retryAfterSeconds, retryAfter(buckets, total, rule, now));
        }
      }
      if (retryAfterSeconds > 0) {
        return { allowed: false, count: highest, retryAfterSeconds };
      }
      for (const key of unique) {
        await tx
          .insert(rateLimitBuckets)
          .values({ key, windowStart: bucketStart(rule, now), count: 1 })
          .onConflictDoUpdate({
            target: [rateLimitBuckets.key, rateLimitBuckets.windowStart],
            set: { count: sql`${rateLimitBuckets.count} + 1`, updatedAt: now },
          });
      }
      return { allowed: true, count: highest + 1 };
    });
  }

  /** Current count inside the window, without counting a request. */
  async count(key: string, rule: SlidingWindowRule): Promise<number> {
    const buckets = await liveBuckets(this.db, key, rule, this.clock());
    return buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  }

  /** Records an event (a failure) without enforcing a limit. */
  async record(key: string, rule: SlidingWindowRule): Promise<void> {
    const now = this.clock();
    await this.db
      .delete(rateLimitBuckets)
      .where(
        and(eq(rateLimitBuckets.key, key), lte(rateLimitBuckets.windowStart, cutoff(rule, now))),
      );
    await this.db
      .insert(rateLimitBuckets)
      .values({ key, windowStart: bucketStart(rule, now), count: 1 })
      .onConflictDoUpdate({
        target: [rateLimitBuckets.key, rateLimitBuckets.windowStart],
        set: { count: sql`${rateLimitBuckets.count} + 1`, updatedAt: now },
      });
  }

  async reset(key: string): Promise<void> {
    await this.db.delete(rateLimitBuckets).where(eq(rateLimitBuckets.key, key));
  }
}

// ---------------------------------------------------------------------------
// Group A: auth endpoints (login, register, forgot, reset, verify-email, apple, google)
// ---------------------------------------------------------------------------

export type AuthRateLimitEnv = Pick<
  WebEnv,
  | 'RATE_LIMIT_AUTH_MAX'
  | 'RATE_LIMIT_AUTH_WINDOW_SECONDS'
  | 'RATE_LIMIT_AUTH_DELAY_AFTER_FAILURES'
  | 'RATE_LIMIT_AUTH_DELAY_STEP_MS'
>;

export interface AuthAttemptSubject {
  /** Rate-limit subject of the client address (see `rateLimitSubject`). */
  readonly ip: string;
  /** Normalized (trimmed, lower-cased) email from the validated body, when the endpoint has one. */
  readonly email?: string | null;
}

/** Upper bound of the progressive delay, whatever the configuration. */
export const MAX_AUTH_DELAY_MS = 10_000;

export interface AuthRateLimiter {
  /**
   * Counts the attempt against the per-IP and the per-email window (5 / 15 min by default),
   * atomically: a rejected attempt charges neither. Throws 429 `rate_limited` with `Retry-After` when either is exhausted; otherwise returns the
   * progressive delay (ms) owed for earlier failures.
   */
  consume(subject: AuthAttemptSubject): Promise<{ delayMs: number }>;
  /** Records a failed attempt (wrong password, invalid token) for the progressive delay. */
  recordFailure(subject: AuthAttemptSubject): Promise<void>;
  /** Clears the failure history of the email after a successful sign-in. */
  recordSuccess(subject: AuthAttemptSubject): Promise<void>;
}

export function createAuthRateLimiter(
  limiter: SlidingWindowLimiter,
  env: AuthRateLimitEnv,
  hash: KeyedHasher,
): AuthRateLimiter {
  const rule: SlidingWindowRule = {
    max: env.RATE_LIMIT_AUTH_MAX,
    windowSeconds: env.RATE_LIMIT_AUTH_WINDOW_SECONDS,
  };
  const failureRule: SlidingWindowRule = {
    max: Number.MAX_SAFE_INTEGER,
    windowSeconds: env.RATE_LIMIT_AUTH_WINDOW_SECONDS,
  };

  const keys = (subject: AuthAttemptSubject, kind: 'attempt' | 'failure'): string[] => {
    const prefix = kind === 'attempt' ? 'auth' : 'auth-fail';
    const list = [`${prefix}:ip:${hash('rate-limit', subject.ip)}`];
    if (subject.email !== undefined && subject.email !== null && subject.email.length > 0) {
      list.push(`${prefix}:email:${hash('rate-limit', subject.email)}`);
    }
    return list;
  };

  async function delayFor(subject: AuthAttemptSubject): Promise<number> {
    let failures = 0;
    for (const key of keys(subject, 'failure')) {
      failures = Math.max(failures, await limiter.count(key, failureRule));
    }
    if (failures < env.RATE_LIMIT_AUTH_DELAY_AFTER_FAILURES) {
      return 0;
    }
    const steps = failures - env.RATE_LIMIT_AUTH_DELAY_AFTER_FAILURES + 1;
    return Math.min(steps * env.RATE_LIMIT_AUTH_DELAY_STEP_MS, MAX_AUTH_DELAY_MS);
  }

  return {
    async consume(subject) {
      // IP and email are charged together or not at all (see `hitAll`).
      const result = await limiter.hitAll(keys(subject, 'attempt'), rule);
      if (!result.allowed) {
        throw new ApiError('rate_limited', {
          headers: { 'Retry-After': String(result.retryAfterSeconds) },
        });
      }
      return { delayMs: await delayFor(subject) };
    },
    async recordFailure(subject) {
      for (const key of keys(subject, 'failure')) {
        await limiter.record(key, failureRule);
      }
    },
    async recordSuccess(subject) {
      const emailKey = keys(subject, 'failure').find((key) => key.startsWith('auth-fail:email:'));
      if (emailKey !== undefined) {
        await limiter.reset(emailKey);
      }
    },
  };
}
