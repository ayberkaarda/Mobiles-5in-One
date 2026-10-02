import { z } from 'zod';

import { idSchema, isoDateTimeSchema } from './common.js';
import { LIMITS } from './limits.js';

/**
 * Worker job contracts (ADR-0028). The web app (producer) and the worker (consumer) import the
 * same queue names and `.strict()` payload schemas; the worker validates every payload before the
 * handler and dead-letters one that fails. Payloads carry identifiers, enums and timestamps only:
 * never email addresses, names, message text, tokens, presigned URLs or object contents.
 */

export const JOB_QUEUES = [
  'email.send',
  'push.send',
  'push.receipts',
  'match.reminder',
  'upload.process',
  'account.hard_delete',
  'opencall.expire',
  'maintenance.sweep',
  'venue.import',
  'webhook.revenuecat.process',
  'subscription.reconcile',
] as const;
export const jobQueueSchema = z.enum(JOB_QUEUES);
export type JobQueue = z.infer<typeof jobQueueSchema>;

/** Queues of the RevenueCat integration (ADR-0063), a subset of `JOB_QUEUES`. */
export const BILLING_JOB_QUEUES = [
  'webhook.revenuecat.process',
  'subscription.reconcile',
] as const satisfies readonly JobQueue[];
export const billingJobQueueSchema = z.enum(BILLING_JOB_QUEUES);
export type BillingJobQueue = z.infer<typeof billingJobQueueSchema>;

/** Every queue has a dead-letter queue named `<queue>.dead` (ADR-0028). */
export function deadLetterQueue(queue: JobQueue): `${JobQueue}.dead` {
  return `${queue}.dead`;
}

/**
 * Stable business key, also passed as the pg-boss `singletonKey`, e.g. `upload:<uploadId>` or
 * `reminder:<matchId>:24h:<startsAtEpoch>`; otherwise the SHA-256 hex of `{ queue, data }`.
 */
export const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(LIMITS.idempotencyKey.max)
  .regex(/^[A-Za-z0-9:._-]+$/, 'must be an idempotency key');

/** Request id of the API request that enqueued the job, for log correlation. */
export const jobRequestIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'must be a request id');

/** Transactional email kinds (ADR-0029). `deletion_completed` is sent by the hard-delete job itself. */
export const EMAIL_KINDS = [
  'verify_email',
  'password_reset',
  'already_registered',
  'deletion_scheduled',
  'deletion_completed',
] as const;
export const emailKindSchema = z.enum(EMAIL_KINDS);
export type EmailKind = z.infer<typeof emailKindSchema>;

/** Email kinds that travel through the `email.send` queue. */
export const EMAIL_JOB_KINDS = [
  'verify_email',
  'password_reset',
  'already_registered',
  'deletion_scheduled',
] as const satisfies readonly EmailKind[];

/** Push notification types, a closed set (ADR-0031). */
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
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const MATCH_REMINDERS = ['24h', '2h'] as const;
export const matchReminderSchema = z.enum(MATCH_REMINDERS);
export type MatchReminder = z.infer<typeof matchReminderSchema>;

/**
 * `email.send`: the worker issues any token itself (ADR-0029). `userId` is `null` only for a
 * `password_reset` request that matched no eligible account; the job then sends nothing, so the
 * request path does not depend on account existence (ADR-0015).
 */
export const emailSendJobSchema = z
  .strictObject({
    kind: z.enum(EMAIL_JOB_KINDS),
    userId: idSchema.nullable(),
    requestId: jobRequestIdSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .refine((job) => job.userId !== null || job.kind === 'password_reset', {
    message: 'userId may be null only for password_reset',
    path: ['userId'],
  });
export type EmailSendJob = z.infer<typeof emailSendJobSchema>;

/** `push.send`: one notification to all devices of one user; `refId` is the deep-link target. */
export const pushSendJobSchema = z.strictObject({
  type: notificationTypeSchema,
  userId: idSchema,
  refId: idSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type PushSendJob = z.infer<typeof pushSendJobSchema>;

/** Expo push ticket ids (UUID-like strings) and the device row each ticket belongs to. */
export const pushReceiptsJobSchema = z.strictObject({
  tickets: z
    .array(
      z.strictObject({
        ticketId: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[A-Za-z0-9-]+$/, 'must be an Expo ticket id'),
        pushTokenId: idSchema,
      }),
    )
    .min(1)
    .max(100),
  idempotencyKey: idempotencyKeySchema,
});
export type PushReceiptsJob = z.infer<typeof pushReceiptsJobSchema>;

/** `match.reminder`: `startsAt` is the start time the reminder was planned for (stale check). */
export const matchReminderJobSchema = z.strictObject({
  matchId: idSchema,
  reminder: matchReminderSchema,
  startsAt: isoDateTimeSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type MatchReminderJob = z.infer<typeof matchReminderJobSchema>;

export const uploadProcessJobSchema = z.strictObject({
  uploadId: idSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type UploadProcessJob = z.infer<typeof uploadProcessJobSchema>;

export const accountHardDeleteJobSchema = z.strictObject({
  deletionRequestId: idSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type AccountHardDeleteJob = z.infer<typeof accountHardDeleteJobSchema>;

/** Scheduled jobs (`opencall.expire`, `maintenance.sweep`) carry only their key. */
export const scheduledJobSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
});
export type ScheduledJob = z.infer<typeof scheduledJobSchema>;

/** `venue.import` (handler in Phase 5): the stored import file is referenced by id only. */
export const venueImportJobSchema = z.strictObject({
  importId: idSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type VenueImportJob = z.infer<typeof venueImportJobSchema>;

// ---------------------------------------------------------------------------
// Billing queues (Phase 5, ADR-0063)
// ---------------------------------------------------------------------------

/**
 * `webhook.revenuecat.process`: applies one stored delivery. The webhook route stores the
 * normalized event columns in `webhook_events` and enqueues only the row id, so no RevenueCat
 * payload travels through the queue. Idempotency key: `revenuecat:<event.id>`.
 */
export const revenueCatProcessJobSchema = z.strictObject({
  webhookEventId: idSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type RevenueCatProcessJob = z.infer<typeof revenueCatProcessJobSchema>;

/**
 * `subscription.reconcile`: compares `subscriptions` with the RevenueCat REST API. The nightly
 * schedule sends `userId: null` (every user with a subscription row, in batches); a user id
 * reconciles one account, for example after a delivery that could not be applied. Idempotency
 * key: `reconcile:<YYYY-MM-DD>` for the nightly run, `reconcile:<userId>:<epochMinute>` otherwise.
 */
export const subscriptionReconcileJobSchema = z.strictObject({
  userId: idSchema.nullable(),
  idempotencyKey: idempotencyKeySchema,
});
export type SubscriptionReconcileJob = z.infer<typeof subscriptionReconcileJobSchema>;

/** Payload schema per billing queue; producer and consumer both parse with it. */
export const BILLING_JOB_PAYLOAD_SCHEMAS = {
  'webhook.revenuecat.process': revenueCatProcessJobSchema,
  'subscription.reconcile': subscriptionReconcileJobSchema,
} as const satisfies Record<BillingJobQueue, z.ZodType>;

export type BillingJobPayload<TQueue extends BillingJobQueue> = z.infer<
  (typeof BILLING_JOB_PAYLOAD_SCHEMAS)[TQueue]
>;

/** Payload schema per queue; producer and consumer both parse with it. */
export const JOB_PAYLOAD_SCHEMAS = {
  'email.send': emailSendJobSchema,
  'push.send': pushSendJobSchema,
  'push.receipts': pushReceiptsJobSchema,
  'match.reminder': matchReminderJobSchema,
  'upload.process': uploadProcessJobSchema,
  'account.hard_delete': accountHardDeleteJobSchema,
  'opencall.expire': scheduledJobSchema,
  'maintenance.sweep': scheduledJobSchema,
  'venue.import': venueImportJobSchema,
  ...BILLING_JOB_PAYLOAD_SCHEMAS,
} as const satisfies Record<JobQueue, z.ZodType>;

export type JobPayload<TQueue extends JobQueue> = z.infer<(typeof JOB_PAYLOAD_SCHEMAS)[TQueue]>;

/** Nightly reconciliation schedule (cron, UTC): 03:17 every day. */
export const SUBSCRIPTION_RECONCILE_CRON = '17 3 * * *';
