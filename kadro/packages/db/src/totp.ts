import { and, eq, gte, isNotNull, isNull } from 'drizzle-orm';

import { type Database, type Transaction } from './client.js';
import { users } from './schema/index.js';

/**
 * Pending TOTP enrollment of staff accounts (ADR-0064). The caller encrypts the secret
 * (AES-256-GCM, `TOTP_ENCRYPTION_KEY`) and verifies codes; these helpers only store and move the
 * ciphertext, so the database never sees a plaintext secret. The enrollment has two steps: a
 * pending secret is stored (and replaced by every new enrollment call), and confirming it promotes
 * it to the active secret in one statement.
 */

type Executor = Database | Transaction;

export interface TotpEnrollmentState {
  /** An active (confirmed) secret exists. */
  readonly active: boolean;
  readonly pending: { readonly ciphertext: string; readonly createdAt: Date } | null;
}

export async function getTotpEnrollment(
  db: Executor,
  userId: string,
): Promise<TotpEnrollmentState | undefined> {
  const [row] = await db
    .select({
      active: users.totpSecretEnc,
      pending: users.totpPendingSecretEnc,
      pendingAt: users.totpPendingCreatedAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (row === undefined) {
    return undefined;
  }
  return {
    active: row.active !== null,
    pending:
      row.pending !== null && row.pendingAt !== null
        ? { ciphertext: row.pending, createdAt: row.pendingAt }
        : null,
  };
}

export type SetPendingTotpResult = 'stored' | 'already_enrolled' | 'user_not_found';

/**
 * Stores `ciphertext` as the pending secret, replacing an earlier pending one and restarting its
 * confirm window. An account with an active secret is never touched.
 */
export async function setPendingTotpSecret(
  db: Executor,
  userId: string,
  ciphertext: string,
  now: Date = new Date(),
): Promise<SetPendingTotpResult> {
  const rows = await db
    .update(users)
    .set({ totpPendingSecretEnc: ciphertext, totpPendingCreatedAt: now, updatedAt: now })
    .where(
      and(
        eq(users.id, userId),
        isNull(users.totpSecretEnc),
        eq(users.isTombstone, false),
        isNull(users.deactivatedAt),
      ),
    )
    .returning({ id: users.id });
  if (rows.length > 0) {
    return 'stored';
  }
  const state = await getTotpEnrollment(db, userId);
  return state?.active === true ? 'already_enrolled' : 'user_not_found';
}

export interface ConfirmPendingTotp {
  readonly userId: string;
  /** The pending ciphertext the code was verified against; a newer enrollment makes it stale. */
  readonly expectedCiphertext: string;
  /** Time step of the accepted code, stored so the same code cannot be replayed. */
  readonly step: number;
  /** Confirm window in seconds; confirming exactly at its end is still allowed (`LIMITS.totpEnrollmentWindowSeconds`). */
  readonly windowSeconds: number;
}

export type ConfirmPendingTotpResult =
  'confirmed' | 'already_enrolled' | 'no_pending' | 'expired' | 'replaced';

/**
 * Promotes the pending secret to the active one if it is still the verified ciphertext and inside
 * its window, and clears the pending columns, in one statement.
 */
export async function confirmPendingTotpSecret(
  db: Executor,
  request: ConfirmPendingTotp,
  now: Date = new Date(),
): Promise<ConfirmPendingTotpResult> {
  const oldest = new Date(now.getTime() - request.windowSeconds * 1000);
  const rows = await db
    .update(users)
    .set({
      totpSecretEnc: request.expectedCiphertext,
      totpPendingSecretEnc: null,
      totpPendingCreatedAt: null,
      totpLastUsedStep: request.step,
      updatedAt: now,
    })
    .where(
      and(
        eq(users.id, request.userId),
        isNull(users.totpSecretEnc),
        eq(users.totpPendingSecretEnc, request.expectedCiphertext),
        isNotNull(users.totpPendingCreatedAt),
        gte(users.totpPendingCreatedAt, oldest),
      ),
    )
    .returning({ id: users.id });
  if (rows.length > 0) {
    return 'confirmed';
  }
  const state = await getTotpEnrollment(db, request.userId);
  if (state?.active === true) {
    return 'already_enrolled';
  }
  if (state === undefined || state.pending === null) {
    return 'no_pending';
  }
  return state.pending.ciphertext === request.expectedCiphertext ? 'expired' : 'replaced';
}

/** Drops a pending secret; returns whether one existed. */
export async function discardPendingTotpSecret(db: Executor, userId: string): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ totpPendingSecretEnc: null, totpPendingCreatedAt: null, updatedAt: new Date() })
    .where(and(eq(users.id, userId), isNotNull(users.totpPendingSecretEnc)))
    .returning({ id: users.id });
  return rows.length > 0;
}
