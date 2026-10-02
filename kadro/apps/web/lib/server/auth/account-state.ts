import { deletionRequests, type User, users } from '@kadro/db';
import { and, eq, gt, isNull } from 'drizzle-orm';

import { recordAudit } from '../audit';
import { ApiError } from '../errors';
import { type ServerRuntime } from '../runtime';
import { type Executor } from './profile';

/**
 * Sign-in rule for deactivated accounts (ADR-0012): a sign-in with valid credentials during a
 * self-initiated deletion grace period cancels the deletion and reactivates the account; any
 * other deactivation (admin action, or a grace period that has ended) answers 401
 * `account_deactivated`. Callers run this only after the credentials were verified, so the
 * answer never reveals account state to someone without the password or provider token.
 */
export async function admitSignIn(
  runtime: ServerRuntime,
  db: Executor,
  user: Pick<User, 'id' | 'deactivatedAt'>,
  ip: string | null,
): Promise<void> {
  if (user.deactivatedAt === null) {
    return;
  }
  const now = runtime.now();
  const cancelled = await db
    .delete(deletionRequests)
    .where(
      and(
        eq(deletionRequests.userId, user.id),
        isNull(deletionRequests.completedAt),
        gt(deletionRequests.graceUntil, now),
      ),
    )
    .returning({ id: deletionRequests.id });
  if (cancelled.length === 0) {
    throw new ApiError('account_deactivated');
  }
  await db.update(users).set({ deactivatedAt: null }).where(eq(users.id, user.id));
  await recordAudit(db, runtime.keyedHash, {
    actorId: user.id,
    action: 'auth.deletionCancelled',
    targetType: 'user',
    targetId: user.id,
    ip,
  });
}
