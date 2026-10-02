import { type MatchReminder, type NotificationType } from '@kadro/contracts';
import { type Transaction } from '@kadro/db';

import { type JobSender } from './enqueue';

/**
 * Push producers of the domain endpoints (ADR-0031, handoff worker-to-web-001 §3, §4). Each
 * helper enqueues one `push.send` job per recipient inside the caller's transaction. Payloads
 * carry ids only (`{ type, userId, refId }`); the worker composes the text at send time and
 * re-checks that the recipient still has access, so callers pass the full recipient list of
 * ADR-0031 without further filtering. Keys are unique per event, except the two coalesced types
 * (`rsvp.changed`, `application.received`), whose key is per object and recipient with a
 * 10-minute delay, so repeats inside that window are dropped by the `exclusive` queue policy.
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
  startAfter?: Date,
): Promise<void> {
  for (const userId of unique(recipientIds)) {
    await jobs.enqueue(
      tx,
      'push.send',
      { type, userId, refId },
      { idempotencyKey: key(userId), ...(startAfter === undefined ? {} : { startAfter }) },
    );
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
  return pushEach(
    jobs,
    tx,
    'rsvp.changed',
    input.matchId,
    input.recipientIds,
    (userId) => `rsvp:${input.matchId}:${userId}`,
    new Date(input.now.getTime() + COALESCE_DELAY_MS),
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
  return pushEach(
    jobs,
    tx,
    'application.received',
    input.applicationId,
    input.recipientIds,
    (userId) => `application:${input.openCallId}:${userId}`,
    new Date(input.now.getTime() + COALESCE_DELAY_MS),
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

/** `team.member_joined` to the captain when an invite is accepted. */
export function notifyMemberJoined(
  jobs: JobSender,
  tx: Transaction,
  input: {
    readonly teamId: string;
    readonly captainId: string;
    /** The new member; part of the key, never of the payload. */
    readonly memberId: string;
    readonly joinedAt: Date;
  },
): Promise<void> {
  // One recipient (the captain), so the key names the event only.
  return pushEach(
    jobs,
    tx,
    'team.member_joined',
    input.teamId,
    [input.captainId],
    () => `push:joined:${input.teamId}:${input.memberId}:${epochSeconds(input.joinedAt)}`,
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
