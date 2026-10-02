import { type MatchReminder, type MatchReminderJob, type NotificationType } from '@kadro/contracts';

import { HOUR_MS } from '../clock.js';

/** How long before `starts_at` each reminder fires (product spec §3 story 8). */
export const REMINDER_LEAD_MS: Readonly<Record<MatchReminder, number>> = {
  '24h': 24 * HOUR_MS,
  '2h': 2 * HOUR_MS,
};

export const REMINDER_NOTIFICATION: Readonly<Record<MatchReminder, NotificationType>> = {
  '24h': 'match.reminder_24h',
  '2h': 'match.reminder_2h',
};

/**
 * `reminder:<matchId>:<24h|2h>:<startsAtEpochMilliseconds>`, the rule the web producer uses
 * (handoff matches-to-worker-001). Any reschedule, even within the same second, yields new keys.
 */
export function reminderIdempotencyKey(
  matchId: string,
  reminder: MatchReminder,
  startsAt: Date,
): string {
  return `reminder:${matchId}:${reminder}:${startsAt.getTime()}`;
}

export interface PlannedReminder {
  readonly payload: MatchReminderJob;
  readonly startAfter: Date;
}

/**
 * Reminder jobs for a match, each delayed with `startAfter = starts_at − lead`. A reminder whose
 * time has already passed is not planned: a match created 20 hours ahead gets only the 2-hour
 * reminder, one created 90 minutes ahead gets none.
 */
export function planMatchReminders(
  match: { readonly id: string; readonly startsAt: Date },
  now: Date,
): PlannedReminder[] {
  const plans: PlannedReminder[] = [];
  for (const reminder of ['24h', '2h'] as const) {
    // eslint-disable-next-line security/detect-object-injection -- reminder iterates a literal tuple
    const startAfter = new Date(match.startsAt.getTime() - REMINDER_LEAD_MS[reminder]);
    if (startAfter.getTime() <= now.getTime()) {
      continue;
    }
    plans.push({
      startAfter,
      payload: {
        matchId: match.id,
        reminder,
        startsAt: match.startsAt.toISOString(),
        idempotencyKey: reminderIdempotencyKey(match.id, reminder, match.startsAt),
      },
    });
  }
  return plans;
}
