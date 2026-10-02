import { type MatchReminder, type NotificationType } from '@kadro/contracts';
import {
  type CoalescedPushType,
  type Transaction,
  lockPushResend,
  recordPushResend,
} from '@kadro/db';

import { type JobSender } from './enqueue';

/**
 * Push producers of the domain endpoints (ADR-0031, handoff worker-to-web-001 §3, §4). Each
 * helper enqueues one `push.send` job per recipient inside the caller's transaction. Payloads
 * carry ids only (`{ type, userId, refId }`); the worker composes the text at send time and
 * re-checks that the recipient still has access, so callers pass the full recipient list of
 * ADR-0031 without further filtering. Keys are unique per event. The two coalesced types
 * (`rsvp.changed`, `application.received`) carry two keys: the pg-boss `singletonKey` is per object
 * and recipient, with a 10-minute delay, so repeats while that job is queued or active are dropped
 * by the `exclusive` queue policy; the `idempotencyKey` (the worker's delivery receipt) adds the
 * moment that opened the window, so the next window after delivery is sent again. A dropped repeat
 * is recorded in `push_resends` (ADR-0044): the job that absorbed it may already have read the state
 * it renders, and the worker then carries the change into the next delivery.
 *
 * `match.reminder_24h` and `match.reminder_2h` are produced by the worker from the
 * `match.reminder` jobs that {@link scheduleMatchReminders} plans.
 */

/** Delay of the coalesced notifications (ADR-0031 "Abuse limits at the source"). */
export const COALESCE_DELAY_MS = 10 * 60 * 1_000;

/** Seconds since the epoch: the per-event part of a key. */
function epochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1_000);
}

/**
 * Keys of a coalesced notification (ADR-0031): `<prefix>:<objectId>:<recipientId>` coalesces, and
 * `<prefix>:<objectId>:<recipientId>:<windowOpenedEpochMilliseconds>` is the delivery key. The
 * window opens with the first event that finds no queued or active job and closes when that job
 * has run, 10 minutes later; the repeats it absorbed are dropped together with their keys.
 */
export function coalescedKeys(
  prefix: 'rsvp' | 'application',
  objectId: string,
  recipientId: string,
  windowOpenedAt: Date,
): { readonly singletonKey: string; readonly idempotencyKey: string } {
  const singletonKey = `${prefix}:${objectId}:${recipientId}`;
  return { singletonKey, idempotencyKey: `${singletonKey}:${windowOpenedAt.getTime()}` };
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

async function pushEach(
  jobs: JobSender,
  tx: Transaction,
  type: NotificationType,
  refId: string,
  recipientIds: readonly string[],
  key: (recipientId: string) => string,
): Promise<void> {
  for (const userId of unique(recipientIds)) {
    await jobs.enqueue(tx, 'push.send', { type, userId, refId }, { idempotencyKey: key(userId) });
  }
}

/**
 * Coalesced producer (ADR-0031, ADR-0044). Per recipient, under the coalescing key's lock: the job
 * opens a window 10 minutes long, or, when a job with that key is queued, retrying or active and
 * the enqueue is dropped, the change is recorded for the worker to carry forward.
 */
async function pushCoalesced(
  jobs: JobSender,
  tx: Transaction,
  type: CoalescedPushType,
  refId: string,
  recipientIds: readonly string[],
  coalescing: { readonly prefix: 'rsvp' | 'application'; readonly objectId: string },
  now: Date,
): Promise<void> {
  // A fixed lock order, so two producers for the same object never wait on each other in a cycle.
  for (const userId of unique(recipientIds).sort()) {
    const keys = coalescedKeys(coalescing.prefix, coalescing.objectId, userId, now);
    await lockPushResend(tx, keys.singletonKey);
    const jobId = await jobs.enqueue(
      tx,
      'push.send',
      { type, userId, refId },
      { ...keys, startAfter: new Date(now.getTime() + COALESCE_DELAY_MS) },
    );
    if (jobId === null) {
      await recordPushResend(tx, {
        singletonKey: keys.singletonKey,
        type,
        userId,
        refId,
        requestedAt: now,
      });
    }
  }
}

/** `match.updated`: start time or venue changed, or the match was cancelled (ADR-0004). */
export function notifyMatchUpdated(
  jobs: JobSender,
  tx: Transaction,
  input: {
    readonly matchId: string;
    /** RSVP `in`, `maybe` and `waitlist`. */
    readonly recipientIds: readonly string[];
    /** `matches.updated_at` written by this change; distinguishes successive updates. */
    readonly changedAt: Date;
  },
): Promise<void> {
  return pushEach(
    jobs,
    tx,
    'match.updated',
    input.matchId,
    input.recipientIds,
    (userId) => `push:match_updated:${input.matchId}:${userId}:${epochSeconds(input.changedAt)}`,
  );
}

/** `rsvp.changed` to captain and co-captains, coalesced per match and recipient for 10 minutes. */
export function notifyRsvpChanged(
  jobs: JobSender,
  tx: Transaction,
  input: { readonly matchId: string; readonly recipientIds: readonly string[]; readonly now: Date },
): Promise<void> {
  return pushCoalesced(
    jobs,
    tx,
    'rsvp.changed',
    input.matchId,
    input.recipientIds,
    { prefix: 'rsvp', objectId: input.matchId },
    input.now,
  );
}

/** `rsvp.promoted` to the player moved from the waitlist into the match. */
export function notifyRsvpPromoted(
  jobs: JobSender,
  tx: Transaction,
  input: {
    readonly matchId: string;
    readonly userId: string;
    /** `match_rsvps.updated_at` of the promotion. */
    readonly promotedAt: Date;
  },
): Promise<void> {
  return pushEach(
    jobs,
    tx,
    'rsvp.promoted',
    input.matchId,
    [input.userId],
    (userId) => `push:promoted:${input.matchId}:${userId}:${epochSeconds(input.promotedAt)}`,
  );
}

/** `lineup.slot_free` to the captain when a player leaves a `locked` match (ADR-0005). */
export function notifyLineupSlotFree(
  jobs: JobSender,
  tx: Transaction,
  input: {
    readonly matchId: string;
    readonly captainId: string;
    /** The player who left; part of the key, never of the payload. */
    readonly leaverId: string;
    readonly leftAt: Date;
  },
): Promise<void> {
  // One recipient (the captain), so the key names the event only (three ids exceed 128 chars).
  return pushEach(
    jobs,
    tx,
    'lineup.slot_free',
    input.matchId,
    [input.captainId],
    () => `push:slot_free:${input.matchId}:${input.leaverId}:${epochSeconds(input.leftAt)}`,
  );
}

/**
 * `application.received` to the captain and co-captains of the call's team, coalesced per call and
 * recipient for 10 minutes; `refId` is the application that opened the window.
 */
export function notifyApplicationReceived(
  jobs: JobSender,
  tx: Transaction,
  input: {
    readonly openCallId: string;
    readonly applicationId: string;
    readonly recipientIds: readonly string[];
    readonly now: Date;
  },
): Promise<void> {
  return pushCoalesced(
    jobs,
    tx,
    'application.received',
    input.applicationId,
    input.recipientIds,
    { prefix: 'application', objectId: input.openCallId },
    input.now,
  );
}

/**
 * `application.decided` to the applicant: accepted, rejected, or rejected by a call close. The key
 * is the one the worker's expiry job uses, so a close and an expiry never notify twice.
 */
export function notifyApplicationDecided(
  jobs: JobSender,
  tx: Transaction,
  input: { readonly applicationId: string; readonly applicantId: string },
): Promise<void> {
  return pushEach(
    jobs,
    tx,
    'application.decided',
    input.applicationId,
    [input.applicantId],
    () => `push:decided:${input.applicationId}`,
  );
}

/**
 * `team.member_joined` to the captain when an invite is accepted. The key is the `team_members` row
 * of this membership: a leave deletes the row and a rejoin inserts a new one, so a rejoin in the
 * same second is still a new event.
 */
export function notifyMemberJoined(
  jobs: JobSender,
  tx: Transaction,
  input: {
    readonly teamId: string;
    readonly captainId: string;
    /** `team_members.id` of the new membership; part of the key, never of the payload. */
    readonly membershipId: string;
  },
): Promise<void> {
  // One recipient (the captain), so the key names the event only.
  return pushEach(
    jobs,
    tx,
    'team.member_joined',
    input.teamId,
    [input.captainId],
    () => `push:joined:${input.membershipId}`,
  );
}

// ---------------------------------------------------------------------------
// Match reminders (same rule as the worker's `planMatchReminders`)
// ---------------------------------------------------------------------------

const HOUR_MS = 3_600_000;

/** How long before `starts_at` each reminder fires (product spec §3 story 8). */
export const REMINDER_LEAD_MS: Readonly<Record<MatchReminder, number>> = {
  '24h': 24 * HOUR_MS,
  '2h': 2 * HOUR_MS,
};

/**
 * `reminder:<matchId>:<24h|2h>:<startsAtEpochMilliseconds>`. Every reschedule yields new keys,
 * also one within the same second: the worker compares `startsAt` to the millisecond and skips
 * the older job as `skipped_rescheduled`, so a second-based key would drop the replacement.
 */
export function reminderIdempotencyKey(
  matchId: string,
  reminder: MatchReminder,
  startsAt: Date,
): string {
  return `reminder:${matchId}:${reminder}:${startsAt.getTime()}`;
}

/**
 * Enqueues the `match.reminder` jobs of a match that became `open` or whose `starts_at` changed:
 * 24 h and 2 h before the start, each only while that moment is still in the future. Jobs planned
 * for an earlier start time need no cancellation: the worker completes them as
 * `skipped_rescheduled` / `skipped_status` after re-reading the match. Returns the reminders that
 * were planned.
 */
export async function scheduleMatchReminders(
  jobs: JobSender,
  tx: Transaction,
  match: { readonly id: string; readonly startsAt: Date },
  now: Date,
): Promise<MatchReminder[]> {
  const planned: MatchReminder[] = [];
  for (const reminder of ['24h', '2h'] as const) {
    // eslint-disable-next-line security/detect-object-injection -- reminder iterates a literal tuple
    const startAfter = new Date(match.startsAt.getTime() - REMINDER_LEAD_MS[reminder]);
    if (startAfter.getTime() <= now.getTime()) {
      continue;
    }
    await jobs.enqueue(
      tx,
      'match.reminder',
      { matchId: match.id, reminder, startsAt: match.startsAt.toISOString() },
      { idempotencyKey: reminderIdempotencyKey(match.id, reminder, match.startsAt), startAfter },
    );
    planned.push(reminder);
  }
  return planned;
}
