import { type EmailKind, type NotificationType } from '@kadro/contracts';

/**
 * Send classes of ADR-0081. An `essential` message is never paused by `cost.guard`: sign-in and
 * verification, password reset, account deletion and security notices, and pushes that tell a user
 * the outcome of their own request or a change to a match they are in. A `deferrable` message is
 * paused while its kind's gate is closed. The class belongs to the template, not to the cap.
 */
export type SendClass = 'essential' | 'deferrable';

/** Every e-mail kind is essential today; none of them is ever paused. */
export const EMAIL_SEND_CLASS: Readonly<Record<EmailKind, SendClass>> = {
  verify_email: 'essential',
  password_reset: 'essential',
  already_registered: 'essential',
  deletion_scheduled: 'essential',
  deletion_completed: 'essential',
};

export const PUSH_SEND_CLASS: Readonly<Record<NotificationType, SendClass>> = {
  'match.reminder_24h': 'deferrable',
  'match.reminder_2h': 'deferrable',
  'match.updated': 'essential',
  'rsvp.changed': 'deferrable',
  'rsvp.promoted': 'essential',
  'lineup.slot_free': 'deferrable',
  'application.received': 'deferrable',
  'application.decided': 'essential',
  'team.member_joined': 'deferrable',
};

export function isDeferrablePush(type: NotificationType): boolean {
  // eslint-disable-next-line security/detect-object-injection -- type is a typed NotificationType key
  return PUSH_SEND_CLASS[type] === 'deferrable';
}
