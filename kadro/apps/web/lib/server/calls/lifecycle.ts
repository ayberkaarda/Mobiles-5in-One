import { openCallApplications, openCalls, type Transaction } from '@kadro/db';
import { and, eq } from 'drizzle-orm';

import { type JobSender } from '../jobs/enqueue';
import { notifyApplicationDecided } from '../jobs/notify';

/**
 * Transitions out of `open` (ADR-0037 "States"). `closed` and `expired` are terminal; every
 * transition rejects the call's remaining `pending` applications in the same transaction and
 * enqueues one `application.decided` push per rejected applicant (ADR-0003, ADR-0031), so an
 * applicant always hears back and a rolled-back close sends nothing.
 */

export type CallEndStatus = 'closed' | 'expired';

export interface EndedCall {
  /** Whether this call moved out of `open` (false when it was already terminal). */
  readonly ended: boolean;
  /** Applications set from `pending` to `rejected` by this transition. */
  readonly rejected: number;
}

/**
 * Ends one call. The caller holds the call chain locks (team, match, call). A call that is no
 * longer `open` is left untouched.
 */
export async function endOpenCall(
  tx: Transaction,
  jobs: JobSender,
  openCallId: string,
  status: CallEndStatus,
): Promise<EndedCall> {
  const moved = await tx
    .update(openCalls)
    .set({ status })
    .where(and(eq(openCalls.id, openCallId), eq(openCalls.status, 'open')))
    .returning({ id: openCalls.id });
  if (moved.length === 0) {
    return { ended: false, rejected: 0 };
  }
  const rejected = await tx
    .update(openCallApplications)
    .set({ status: 'rejected' })
    .where(
      and(
        eq(openCallApplications.openCallId, openCallId),
        eq(openCallApplications.status, 'pending'),
      ),
    )
    .returning({ id: openCallApplications.id, userId: openCallApplications.userId });
  for (const application of rejected) {
    await notifyApplicationDecided(jobs, tx, {
      applicationId: application.id,
      applicantId: application.userId,
    });
  }
  return { ended: true, rejected: rejected.length };
}

/**
 * Closes the `open` call of a match that leaves `open` (lock, cancel, played; ADR-0037). For the
 * match endpoints: call it inside the transaction that changes the match status, after taking the
 * team row lock and the match row lock (in that order). Returns what happened to the call, or
 * `null` when the match had no open call.
 */
export async function closeOpenCallOfMatch(
  tx: Transaction,
  jobs: JobSender,
  matchId: string,
): Promise<EndedCall | null> {
  const [call] = await tx
    .select({ id: openCalls.id })
    .from(openCalls)
    .where(and(eq(openCalls.matchId, matchId), eq(openCalls.status, 'open')))
    .for('update');
  if (call === undefined) {
    return null;
  }
  return endOpenCall(tx, jobs, call.id, 'closed');
}
