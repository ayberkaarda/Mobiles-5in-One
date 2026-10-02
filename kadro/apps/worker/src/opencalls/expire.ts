import { type Database, openCallApplications, openCalls } from '@kadro/db';
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import { type PgBoss } from 'pg-boss';

import { type Clock } from '../clock.js';
import { enqueue } from '../enqueue.js';
import { type JobContext } from '../job-runner.js';

/** Calls handled per transaction; the job loops until no expired call is left. */
export const EXPIRE_BATCH = 200;

export interface ExpireDependencies {
  readonly db: Database;
  readonly boss: PgBoss;
  readonly clock: Clock;
}

export interface ExpireResult {
  readonly expired: number;
  readonly rejected: number;
}

/** `push.send` key of an `application.decided` notification; one per application. */
export function decidedIdempotencyKey(applicationId: string): string {
  return `push:decided:${applicationId}`;
}

/**
 * ADR-0037: every `open` call with `expires_at ≤ now` becomes `expired`; its `pending`
 * applications are rejected in the same transaction and each applicant gets an
 * `application.decided` push. Idempotent by state: a second run finds nothing to do.
 */
export async function expireOpenCalls(dependencies: ExpireDependencies): Promise<ExpireResult> {
  const { db, boss, clock } = dependencies;
  const now = clock.now();
  let expired = 0;
  let rejected = 0;

  for (;;) {
    const batch = await db.transaction(async (tx) => {
      const calls = await tx
        .select({ id: openCalls.id })
        .from(openCalls)
        .where(and(eq(openCalls.status, 'open'), lte(openCalls.expiresAt, now)))
        .orderBy(asc(openCalls.expiresAt), asc(openCalls.id))
        .limit(EXPIRE_BATCH)
        .for('update', { skipLocked: true });
      if (calls.length === 0) {
        return { calls: 0, rejected: 0 };
      }
      const ids = calls.map((call) => call.id);
      await tx
        .update(openCalls)
        .set({ status: 'expired', updatedAt: now })
        .where(inArray(openCalls.id, ids));
      const applications = await tx
        .update(openCallApplications)
        .set({ status: 'rejected', updatedAt: now })
        .where(
          and(
            inArray(openCallApplications.openCallId, ids),
            eq(openCallApplications.status, 'pending'),
          ),
        )
        .returning({ id: openCallApplications.id, userId: openCallApplications.userId });
      for (const application of applications) {
        await enqueue(
          boss,
          'push.send',
          {
            type: 'application.decided',
            userId: application.userId,
            refId: application.id,
            idempotencyKey: decidedIdempotencyKey(application.id),
          },
          { tx },
        );
      }
      return { calls: calls.length, rejected: applications.length };
    });
    expired += batch.calls;
    rejected += batch.rejected;
    if (batch.calls < EXPIRE_BATCH) {
      return { expired, rejected };
    }
  }
}

export function createOpenCallExpireHandler(dependencies: ExpireDependencies) {
  return async (_job: unknown, context: JobContext): Promise<string> => {
    const result = await expireOpenCalls(dependencies);
    context.logger.info(result, 'open calls expired');
    return result.expired === 0 ? 'nothing_due' : 'expired';
  };
}
