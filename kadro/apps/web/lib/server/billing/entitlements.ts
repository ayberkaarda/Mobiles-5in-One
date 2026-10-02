import {
  type Entitlements,
  grantsPro,
  NO_ENTITLEMENTS,
  PRO_STATUSES,
  type SubscriptionStatus,
  type SubscriptionStore,
} from '@kadro/contracts';
import { subscriptions } from '@kadro/db';
import {
  type AnyColumn,
  and,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';

import { type DbReader } from '../domain/relations';

/**
 * Server-side Kadro Pro entitlement (ADR-0063 decision 7, ADR-0065; authorization matrix §7).
 *
 * The only source is `subscriptions`, written by webhook processing and the nightly
 * reconciliation. A row grants Pro exactly while its status is `active` or `grace_period` **and**
 * its expiry has not passed (`expires_at` null means a grant without an end date). The expiry
 * check closes the gap between the store ending a subscription and the `EXPIRATION` event (or the
 * nightly run) reaching the row: a lapsed `active` row is not Pro, whatever the stored status says.
 *
 * The same rule exists twice, as a SQL predicate for the per-request actor and the captaincy
 * target ({@link proSubscriptionExists}) and as a function over loaded rows for the profile
 * ({@link resolveEntitlements}); the database tests check that both agree row by row.
 */

/** The `subscriptions` columns that decide a user's entitlement. */
export interface SubscriptionState {
  readonly status: SubscriptionStatus;
  readonly expiresAt: Date | null;
  readonly store: SubscriptionStore | null;
  readonly updatedAt: Date;
}

/** True when `row` grants Pro at `now`. */
export function grantsProAt(
  row: Pick<SubscriptionState, 'status' | 'expiresAt'>,
  now: Date,
): boolean {
  return (
    grantsPro(row.status) && (row.expiresAt === null || row.expiresAt.getTime() > now.getTime())
  );
}

/**
 * Status reported for `row` at `now`. A granting status whose expiry has passed is reported as
 * what it has become in effect: `active` → `expired`, `grace_period` → `billing_issue` (the grace
 * window ended without a successful charge). Every other status is reported as stored.
 */
export function effectiveStatus(
  row: Pick<SubscriptionState, 'status' | 'expiresAt'>,
  now: Date,
): SubscriptionStatus {
  if (!grantsPro(row.status) || grantsProAt(row, now)) {
    return row.status;
  }
  return row.status === 'grace_period' ? 'billing_issue' : 'expired';
}

/** Sort key of a row's expiry: no end date ranks above every date. */
function expiryRank(row: SubscriptionState): number {
  return row.expiresAt === null ? Number.POSITIVE_INFINITY : row.expiresAt.getTime();
}

/**
 * The row that decides the entitlement: a granting row before any other, then the latest expiry
 * (no end date first), then the most recently written row.
 */
function decidingRow(rows: readonly SubscriptionState[], now: Date): SubscriptionState | undefined {
  return [...rows].sort((a, b) => {
    const granting = Number(grantsProAt(b, now)) - Number(grantsProAt(a, now));
    if (granting !== 0) {
      return granting;
    }
    const expiry = expiryRank(b) - expiryRank(a);
    if (expiry !== 0 && !Number.isNaN(expiry)) {
      return expiry;
    }
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  })[0];
}

/**
 * `me.entitlements` for the user's subscription rows at `now`. No row → `NO_ENTITLEMENTS`;
 * otherwise `pro`, the effective status, the expiry and the store of the deciding row.
 */
export function resolveEntitlements(rows: readonly SubscriptionState[], now: Date): Entitlements {
  const row = decidingRow(rows, now);
  if (row === undefined) {
    return NO_ENTITLEMENTS;
  }
  return {
    pro: grantsProAt(row, now),
    status: effectiveStatus(row, now),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    store: row.store,
  };
}

/** Loads the user's subscription rows and resolves them at `now`. */
export async function loadEntitlements(
  db: DbReader,
  userId: string,
  now: Date,
): Promise<Entitlements> {
  const rows = await db
    .select({
      status: subscriptions.status,
      expiresAt: subscriptions.expiresAt,
      store: subscriptions.store,
      updatedAt: subscriptions.updatedAt,
    })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId));
  return resolveEntitlements(rows, now);
}

/** WHERE condition of a subscription row of `userId` that grants Pro at `now`. */
function proGrantingRow(userId: AnyColumn | string, now: Date): SQL {
  return (
    and(
      eq(subscriptions.userId, userId),
      inArray(subscriptions.status, [...PRO_STATUSES]),
      or(isNull(subscriptions.expiresAt), gt(subscriptions.expiresAt, now)),
    ) ?? sql`false`
  );
}

/**
 * `exists (…)` over the subscription rows of `userId` (a correlated column such as `users.id`, or
 * an id) that grant Pro at `now`; used inside the single query that loads the actor or the
 * captaincy target, so the entitlement costs no extra round trip.
 */
export function proSubscriptionExists(
  db: DbReader,
  userId: AnyColumn | string,
  now: Date,
): SQL<boolean> {
  return sql<boolean>`${exists(
    db
      .select({ one: sql`1` })
      .from(subscriptions)
      .where(proGrantingRow(userId, now)),
  )}`.mapWith(Boolean);
}
