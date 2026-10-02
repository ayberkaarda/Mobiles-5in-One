import { evaluateEmailToken, type EmailTokenPurpose, hashPassword, hashToken } from '@kadro/auth';
import { emailTokens, users } from '@kadro/db';
import { and, eq, isNull, ne } from 'drizzle-orm';

import { recordAudit } from '../audit';
import { ApiError } from '../errors';
import { enqueueAlreadyRegistered, enqueuePasswordReset, enqueueVerifyEmail } from '../jobs/email';
import { type Logger } from '../logging';
import { type ServerRuntime } from '../runtime';
import { assertAcceptableNewPassword } from './passwords';
import { type Executor, findUserByEmail } from './profile';
import { type AuthServices } from './services';
import { revokeAllSessions } from './sessions';

/**
 * Registration, email verification and password reset (ADR-0015, ADR-0018, ADR-0029, matrix §3.1
 * footnote 2, threat model T-AUTH-03 / T-AUTH-08).
 *
 * Emails are durable jobs (ADR-0029): register and forgot enqueue one `email.send` job inside
 * their transaction; the worker issues any token, renders and sends. The web process creates no
 * email token and talks to no mail provider.
 *
 * Non-enumeration: `register` and `forgot` answer 202 with the same body whatever the account
 * state, and both branches do the same work. Register: breach check, Argon2id hash, one
 * `INSERT ... ON CONFLICT DO NOTHING`, one lookup, one job. Forgot: one lookup, one job (with
 * `userId = null` when no eligible account matched).
 *
 * Email tokens: 256-bit, only the SHA-256 is stored, single use per purpose: redeeming one spends
 * every other open token of the same user and purpose. A reset revokes every session of the user.
 */

export interface FlowContext {
  readonly runtime: ServerRuntime;
  readonly services: AuthServices;
  readonly logger: Logger;
  readonly ip: string | null;
  /** Request id of the API request; correlates the job with the request logs. */
  readonly requestId: string;
}

export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
}

/** `POST auth/register`; the caller answers 202 `accepted` whenever this returns. */
export async function register(context: FlowContext, input: RegisterInput): Promise<void> {
  await assertAcceptableNewPassword(
    context.runtime,
    context.services,
    context.logger,
    input.password,
  );
  const passwordHash = await hashPassword(input.password);
  const { runtime, requestId } = context;
  await runtime.db.transaction(async (tx) => {
    const [created] = await tx
      .insert(users)
      .values({ email: input.email, passwordHash, displayName: input.displayName })
      .onConflictDoNothing()
      .returning({ id: users.id });
    // Same lookup on both branches, so the work does not depend on account existence.
    const owner = await findUserByEmail(tx, input.email);
    if (created !== undefined) {
      await enqueueVerifyEmail(runtime.jobs, tx, { userId: created.id, requestId });
    } else if (owner !== undefined) {
      await enqueueAlreadyRegistered(runtime.jobs, tx, { userId: owner.id, requestId });
    }
  });
}

/**
 * `POST auth/forgot`. Exactly one `email.send` job per call: for an account that can reset a
 * password (has one, not deactivated) it names the user, otherwise `userId` is `null` and the
 * worker sends nothing (ADR-0015, ADR-0029).
 */
export async function forgotPassword(context: FlowContext, email: string): Promise<void> {
  const { runtime, requestId } = context;
  await runtime.db.transaction(async (tx) => {
    const user = await findUserByEmail(tx, email);
    // Social-only and deactivated accounts have no password to reset here.
    const eligible =
      user !== undefined && user.passwordHash !== null && user.deactivatedAt === null;
    await enqueuePasswordReset(runtime.jobs, tx, {
      userId: eligible ? user.id : null,
      requestId,
    });
  });
}

/**
 * Finds the token by hash, checks it, locks the owner's row and marks the token used inside `db`
 * (a transaction). Returns the
 * owning user id, or `null` for every kind of failure (`token_invalid`, reason not disclosed).
 */
async function redeemToken(
  context: FlowContext,
  db: Executor,
  token: string,
  purpose: EmailTokenPurpose,
): Promise<string | null> {
  const now = context.runtime.now();
  const [stored] = await db
    .select({
      id: emailTokens.id,
      userId: emailTokens.userId,
      purpose: emailTokens.purpose,
      expiresAt: emailTokens.expiresAt,
      usedAt: emailTokens.usedAt,
    })
    .from(emailTokens)
    .where(eq(emailTokens.tokenHash, hashToken(token)))
    .limit(1);
  if (!evaluateEmailToken(stored ?? null, purpose, now).ok || stored === undefined) {
    return null;
  }
  // Lock order is fixed for every token flow: the user row first, then token rows. Two
  // different links of one user used at once queue on the user row instead of deadlocking on
  // each other's token rows.
  await db.select({ id: users.id }).from(users).where(eq(users.id, stored.userId)).for('update');
  const marked = await db
    .update(emailTokens)
    .set({ usedAt: now })
    .where(and(eq(emailTokens.id, stored.id), isNull(emailTokens.usedAt)))
    .returning({ id: emailTokens.id });
  if (marked.length !== 1) {
    return null;
  }
  // Single use per purpose (ADR-0029): every other open token of this user and purpose is spent
  // in the same transaction, so a second link from a retried or repeated email stops working.
  await db
    .update(emailTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(emailTokens.userId, stored.userId),
        eq(emailTokens.purpose, purpose),
        isNull(emailTokens.usedAt),
        ne(emailTokens.id, stored.id),
      ),
    );
  return stored.userId;
}

/** `POST auth/verify-email`. Throws 401 `token_invalid` for any unusable token. */
export async function verifyEmail(context: FlowContext, token: string): Promise<void> {
  const verified = await context.runtime.db.transaction(async (tx) => {
    const userId = await redeemToken(context, tx, token, 'verify');
    if (userId === null) {
      return false;
    }
    await tx
      .update(users)
      .set({ emailVerifiedAt: context.runtime.now() })
      .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
    await recordAudit(tx, context.runtime.keyedHash, {
      actorId: userId,
      action: 'auth.emailVerified',
      targetType: 'user',
      targetId: userId,
      ip: context.ip,
    });
    return true;
  });
  if (!verified) {
    throw new ApiError('token_invalid');
  }
}

/**
 * `POST auth/reset`. The new password passes the same rule as registration before the token is
 * spent, so a rejected password does not burn the link. Success sets the password (the other
 * open reset tokens are spent by the redemption), revokes all sessions (web and mobile) and, because the
 * link proves control of the mailbox, marks the email verified.
 */
export async function resetPassword(
  context: FlowContext,
  input: { readonly token: string; readonly password: string },
): Promise<void> {
  await assertAcceptableNewPassword(
    context.runtime,
    context.services,
    context.logger,
    input.password,
  );
  const passwordHash = await hashPassword(input.password);
  const reset = await context.runtime.db.transaction(async (tx) => {
    const userId = await redeemToken(context, tx, input.token, 'reset');
    if (userId === null) {
      return false;
    }
    const now = context.runtime.now();
    const [user] = await tx
      .select({ emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, userId))
      .for('update');
    await tx
      .update(users)
      .set({ passwordHash, emailVerifiedAt: user?.emailVerifiedAt ?? now })
      .where(eq(users.id, userId));
    const revoked = await revokeAllSessions(tx, userId, now);
    await recordAudit(tx, context.runtime.keyedHash, {
      actorId: userId,
      action: 'auth.passwordReset',
      targetType: 'user',
      targetId: userId,
      ip: context.ip,
      metadata: { revokedSessions: revoked },
    });
    return true;
  });
  if (!reset) {
    throw new ApiError('token_invalid');
  }
}
