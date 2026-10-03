import { CALLS_HOME, matchCallHref } from '../calls/links';
import { matchHref } from '../matches/components';

/**
 * Opening a push notification (ADR-0031, ADR-0075, ADR-0079). The worker sends `data` as
 * `{ type, matchId | teamId | applicationId }`, and an application type also carries the call's
 * `matchId` (contracts `pushNotificationDataSchema`); nothing else in a notification is trusted.
 * The app only navigates: the screen it opens loads the object through the API, where
 * authorization applies, so a notification for an object the user lost access to shows that
 * screen's "not found" state.
 */

/** Contracts `NOTIFICATION_TYPES` (a test compares). */
export const NOTIFICATION_TYPES = [
  'match.reminder_24h',
  'match.reminder_2h',
  'match.updated',
  'rsvp.changed',
  'rsvp.promoted',
  'lineup.slot_free',
  'application.received',
  'application.decided',
  'team.member_joined',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Key of each type's reference in `data` (the worker's `PUSH_REF_KEY`; a test compares). */
export const NOTIFICATION_REF_KEY: Readonly<
  Record<NotificationType, 'matchId' | 'teamId' | 'applicationId'>
> = {
  'match.reminder_24h': 'matchId',
  'match.reminder_2h': 'matchId',
  'match.updated': 'matchId',
  'rsvp.changed': 'matchId',
  'rsvp.promoted': 'matchId',
  'lineup.slot_free': 'matchId',
  'application.received': 'applicationId',
  'application.decided': 'applicationId',
  'team.member_joined': 'teamId',
};

/** Contracts `idSchema` (UUID version 7). */
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type NotificationTarget =
  | { readonly kind: 'match'; readonly type: NotificationType; readonly matchId: string }
  | { readonly kind: 'team'; readonly type: NotificationType; readonly teamId: string }
  | {
      readonly kind: 'application';
      readonly type: NotificationType;
      readonly applicationId: string;
      /** The match of the application's open call (ADR-0079). */
      readonly matchId: string;
    };

function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === 'string' && (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

/** The target of a notification's `data`, or `null` when the payload is not one the app sends. */
export function parseNotificationData(data: unknown): NotificationTarget | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const record = data as Record<string, unknown>;
  const type = record.type;
  if (!isNotificationType(type)) {
    return null;
  }
  // eslint-disable-next-line security/detect-object-injection -- key from the closed map above
  const key = NOTIFICATION_REF_KEY[type];
  // eslint-disable-next-line security/detect-object-injection -- one of three fixed keys
  const ref = record[key];
  if (!isId(ref)) {
    return null;
  }
  switch (key) {
    case 'matchId':
      return { kind: 'match', type, matchId: ref };
    case 'teamId':
      return { kind: 'team', type, teamId: ref };
    case 'applicationId': {
      const { matchId } = record;
      return isId(matchId) ? { kind: 'application', type, applicationId: ref, matchId } : null;
    }
  }
}

export const MATCHES_HOME = '/maclar';

/**
 * Route of a notification target:
 * - a match opens under its team; the team comes from `GET matches/:id` (`loadMatchTeam`), and
 *   the matches tab opens when that read fails (no access any more, offline);
 * - a team opens the team screen;
 * - an application opens through its call's match (ADR-0079): the captain's (or co-captain's)
 *   `application.received` opens the staff view of that match's call, with the applications; the
 *   applicant's `application.decided` opens the match, which an accepted applicant can read as a
 *   guest. A rejected applicant cannot read it, so the Eksik Var tab opens instead.
 */
export async function notificationHref(
  target: NotificationTarget,
  loadMatchTeam: (matchId: string) => Promise<string>,
): Promise<string> {
  switch (target.kind) {
    case 'match':
      try {
        return matchHref(await loadMatchTeam(target.matchId), target.matchId);
      } catch {
        return MATCHES_HOME;
      }
    case 'team':
      return `/takim/${encodeURIComponent(target.teamId)}`;
    case 'application':
      if (target.type === 'application.received') {
        return matchCallHref(target.matchId);
      }
      try {
        return matchHref(await loadMatchTeam(target.matchId), target.matchId);
      } catch {
        return CALLS_HOME;
      }
  }
}
