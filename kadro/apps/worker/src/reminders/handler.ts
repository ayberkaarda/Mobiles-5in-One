import { type MatchReminderJob } from '@kadro/contracts';
import { type Database, matchRsvps, matches, users } from '@kadro/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { type PgBoss } from 'pg-boss';

import { type Clock } from '../clock.js';
import { enqueue } from '../enqueue.js';
import { runOnce } from '../idempotency.js';
import { type JobContext } from '../job-runner.js';
import { MATCH_RECIPIENT_STATUSES } from '../push/recipients.js';
import { REMINDER_NOTIFICATION } from './plan.js';

const QUEUE = 'match.reminder';

export interface ReminderHandlerDependencies {
  readonly db: Database;
  readonly boss: PgBoss;
  readonly clock: Clock;
}

/**
 * `match.reminder`: fans out one `push.send` per recipient (ADR-0031). Skipped when the match is no
 * longer open or locked, was rescheduled (the job's `startsAt` differs) or has already started.
 */
export function createMatchReminderHandler(dependencies: ReminderHandlerDependencies) {
  const { db, boss, clock } = dependencies;

  return async (job: MatchReminderJob, context: JobContext): Promise<string> => {
    const [match] = await db
      .select({ id: matches.id, status: matches.status, startsAt: matches.startsAt })
      .from(matches)
      .where(eq(matches.id, job.matchId));
    if (match === undefined) {
      return 'skipped_missing';
    }
    if (match.status !== 'open' && match.status !== 'locked') {
      return 'skipped_status';
    }
    if (match.startsAt.getTime() !== Date.parse(job.startsAt)) {
      return 'skipped_rescheduled';
    }
    if (match.startsAt.getTime() <= clock.now().getTime()) {
      return 'skipped_stale';
    }

    const type = REMINDER_NOTIFICATION[job.reminder];
    // eslint-disable-next-line security/detect-object-injection -- type is a typed NotificationType key
    const statuses = MATCH_RECIPIENT_STATUSES[type] ?? ['in'];
    const result = await runOnce(db, QUEUE, job.idempotencyKey, async (tx) => {
      const recipients = await tx
        .select({ userId: matchRsvps.userId })
        .from(matchRsvps)
        .innerJoin(users, eq(users.id, matchRsvps.userId))
        .where(
          and(
            eq(matchRsvps.matchId, match.id),
            inArray(matchRsvps.status, [...statuses]),
            isNull(users.deactivatedAt),
            eq(users.isTombstone, false),
          ),
        )
        .orderBy(asc(matchRsvps.userId));
      const epoch = match.startsAt.getTime();
      for (const recipient of recipients) {
        await enqueue(
          boss,
          'push.send',
          {
            type,
            userId: recipient.userId,
            refId: match.id,
            idempotencyKey: `push:reminder:${match.id}:${job.reminder}:${epoch}:${recipient.userId}`,
          },
          { tx },
        );
      }
      return recipients.length;
    });
    if (!result.applied) {
      return 'duplicate';
    }
    context.logger.info(
      { childQueue: 'push.send', recipients: result.value },
      'reminder fanned out',
    );
    return 'fanned_out';
  };
}
