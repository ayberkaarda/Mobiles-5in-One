import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryId, sha256Hex, sha256HexCheck, timestamps, timestamptz } from './columns.js';
import {
  pushPlatformEnum,
  subscriptionEnvironmentEnum,
  subscriptionStatusEnum,
  subscriptionStoreEnum,
  venueImportStatusEnum,
  webhookOutcomeEnum,
  webhookProviderEnum,
} from './enums.js';
import { users } from './users.js';

/** Expo push tokens. A token belongs to exactly one user; re-registration moves it. */
export const pushTokens = pgTable(
  'push_tokens',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expoToken: text('expo_token').notNull(),
    platform: pushPlatformEnum('platform').notNull(),
    lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('push_tokens_expo_token_key').on(t.expoToken),
    index('push_tokens_user_id_idx').on(t.userId),
    check('push_tokens_expo_token_length', sql`char_length(${t.expoToken}) between 1 and 256`),
  ],
);

/** RevenueCat subscription state per user and product, written only by webhook processing and reconciliation. */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rcAppUserId: text('rc_app_user_id').notNull(),
    productId: text('product_id').notNull(),
    status: subscriptionStatusEnum('status').notNull(),
    expiresAt: timestamptz('expires_at'),
    environment: subscriptionEnvironmentEnum('environment').notNull(),
    /** Store of the latest applied event; `null` on rows written before ADR-0063. */
    store: subscriptionStoreEnum('store'),
    /** Provider time of the latest applied event; an older event never overwrites the row. */
    lastEventAt: timestamptz('last_event_at'),
    /** `webhook_events.event_id` of the latest applied event; `null` after a reconciliation write. */
    lastEventId: text('last_event_id'),
    ...timestamps(),
  },
  (t) => [
    check(
      'subscriptions_last_event_id_length',
      sql`${t.lastEventId} is null or char_length(${t.lastEventId}) between 1 and 128`,
    ),
    uniqueIndex('subscriptions_user_id_product_id_environment_key').on(
      t.userId,
      t.productId,
      t.environment,
    ),
    index('subscriptions_rc_app_user_id_idx').on(t.rcAppUserId),
  ],
);

/**
 * Received webhook events. The unique event id makes delivery replay-safe. Besides the payload
 * hash the route stores only the normalized fields the processing job needs (ADR-0063); the raw
 * body and unknown event fields are never stored. The normalized columns are nullable for rows
 * that predate them; the insert helper requires them.
 */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: primaryId(),
    provider: webhookProviderEnum('provider').notNull(),
    eventId: text('event_id').notNull(),
    receivedAt: timestamptz('received_at').notNull().defaultNow(),
    processedAt: timestamptz('processed_at'),
    payloadHash: sha256Hex('payload_hash').notNull(),
    /** Provider event type, e.g. `RENEWAL`; open text because new types appear without notice. */
    eventType: text('event_type'),
    /** `app_user_id` as sent (a user id, or an anonymous id for events that are ignored). */
    appUserId: text('app_user_id'),
    productId: text('product_id'),
    store: subscriptionStoreEnum('store'),
    environment: subscriptionEnvironmentEnum('environment'),
    /** Provider event time (`event_timestamp_ms`); orders deliveries that arrive out of order. */
    eventAt: timestamptz('event_at'),
    /** Subscription expiry carried by the event (`expiration_at_ms`). */
    expiresAt: timestamptz('expires_at'),
    outcome: webhookOutcomeEnum('outcome'),
    /** Short machine reason for `ignored`, e.g. `unknown_user`. */
    ignoredReason: text('ignored_reason'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('webhook_events_provider_event_id_key').on(t.provider, t.eventId),
    index('webhook_events_app_user_id_event_at_idx').on(t.appUserId, t.eventAt),
    check(
      'webhook_events_text_lengths',
      sql`(${t.eventType} is null or char_length(${t.eventType}) between 1 and 64) and (${t.appUserId} is null or char_length(${t.appUserId}) between 1 and 256) and (${t.productId} is null or char_length(${t.productId}) <= 200) and (${t.ignoredReason} is null or char_length(${t.ignoredReason}) between 1 and 64) and char_length(${t.eventId}) between 1 and 128`,
    ),
    check(
      'webhook_events_ignored_reason_matches_outcome',
      sql`${t.outcome} is null or (${t.outcome} = 'ignored') = (${t.ignoredReason} is not null)`,
    ),
    index('webhook_events_unprocessed_idx')
      .on(t.receivedAt)
      .where(sql`${t.processedAt} is null`),
    sha256HexCheck('webhook_events_payload_hash_format', t.payloadHash),
  ],
);

/** Sliding-window rate-limit counters (security checklist item 5); one row per key and window. */
export const rateLimitBuckets = pgTable(
  'rate_limit_buckets',
  {
    id: primaryId(),
    key: text('key').notNull(),
    windowStart: timestamptz('window_start').notNull(),
    count: integer('count').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('rate_limit_buckets_key_window_start_key').on(t.key, t.windowStart),
    index('rate_limit_buckets_window_start_idx').on(t.windowStart),
    check('rate_limit_buckets_count_non_negative', sql`${t.count} >= 0`),
    check('rate_limit_buckets_key_length', sql`char_length(${t.key}) between 1 and 200`),
  ],
);

/**
 * Append-only audit trail. `ip_hash` is a keyed hash, never a raw address, and `metadata` must not
 * contain personal data. Application code inserts and reads rows; it never updates or deletes them.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: primaryId(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    ipHash: text('ip_hash'),
    metadata: jsonb('metadata').$type<Readonly<Record<string, unknown>>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [
    index('audit_logs_actor_id_created_at_idx').on(t.actorId, t.createdAt),
    index('audit_logs_target_idx').on(t.targetType, t.targetId),
    index('audit_logs_created_at_idx').on(t.createdAt),
    check('audit_logs_metadata_object', sql`jsonb_typeof(${t.metadata}) = 'object'`),
  ],
);

/**
 * Idempotency receipts of worker jobs (ADR-0028). A handler inserts its receipt in the same
 * transaction as its database effect; a unique violation means the effect already committed.
 * Rows are immutable and swept after 30 days, so there is no `updated_at`.
 */
export const jobReceipts = pgTable(
  'job_receipts',
  {
    id: primaryId(),
    queue: text('queue').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('job_receipts_queue_idempotency_key_key').on(t.queue, t.idempotencyKey),
    index('job_receipts_created_at_idx').on(t.createdAt),
    check(
      'job_receipts_idempotency_key_length',
      sql`char_length(${t.idempotencyKey}) between 1 and 128`,
    ),
    check('job_receipts_queue_length', sql`char_length(${t.queue}) between 1 and 100`),
  ],
);

/** Notification types whose `push.send` jobs coalesce per object and recipient (ADR-0031). */
export const COALESCED_PUSH_TYPES = ['rsvp.changed', 'application.received'] as const;
export type CoalescedPushType = (typeof COALESCED_PUSH_TYPES)[number];

/**
 * Pending re-send of a coalesced push (ADR-0044): a change whose `push.send` enqueue was dropped
 * because a job with the same coalescing key was queued, retrying or active. The web producer
 * writes the row in the transaction of the change; the worker deletes it when the job that covered
 * the change completes, or turns it into the next delivery when the change came after the job had
 * read the state it renders. `version` counts the dropped changes, so the worker can tell whether
 * one arrived after it read the row. `user_id` and `ref_id` carry no foreign key, as in the job
 * payloads they mirror; rows are short-lived and swept by the maintenance job.
 */
export const pushResends = pgTable(
  'push_resends',
  {
    id: primaryId(),
    singletonKey: text('singleton_key').notNull(),
    type: text('type').$type<CoalescedPushType>().notNull(),
    userId: uuid('user_id').notNull(),
    refId: uuid('ref_id').notNull(),
    /** First dropped change since the row was last cleared; opens the follow-up window. */
    requestedAt: timestamptz('requested_at').notNull(),
    version: integer('version').notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('push_resends_singleton_key_key').on(t.singletonKey),
    index('push_resends_updated_at_idx').on(t.updatedAt),
    check(
      'push_resends_singleton_key_length',
      sql`char_length(${t.singletonKey}) between 1 and 128`,
    ),
    check('push_resends_type', sql`${t.type} in ('rsvp.changed', 'application.received')`),
    check('push_resends_version_positive', sql`${t.version} >= 1`),
  ],
);

/**
 * Venue CSV imports (ADR-0064). The web role stores the request and its CSV, the worker parses it
 * and records the counters and the first row-level issues. `created_by` is cleared when the admin
 * account is deleted; the import itself stays as a record.
 */
export const venueImports = pgTable(
  'venue_imports',
  {
    id: primaryId(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    status: venueImportStatusEnum('status').notNull().default('queued'),
    dryRun: boolean('dry_run').notNull().default(false),
    csv: text('csv').notNull(),
    /** Data rows (header excluded); known once parsing has finished. */
    totalRows: integer('total_rows'),
    createdRows: integer('created_rows').notNull().default(0),
    skippedRows: integer('skipped_rows').notNull().default(0),
    rejectedRows: integer('rejected_rows').notNull().default(0),
    /** At most 50 `{ line, column, issue }` entries; the remainder is only counted. */
    issues: jsonb('issues')
      .$type<readonly { line: number; column: string | null; issue: string }[]>()
      .notNull()
      .default([]),
    /** Short machine reason when `status` is `failed`. */
    failureReason: text('failure_reason'),
    startedAt: timestamptz('started_at'),
    completedAt: timestamptz('completed_at'),
    ...timestamps(),
  },
  (t) => [
    index('venue_imports_created_at_idx').on(t.createdAt),
    index('venue_imports_created_by_idx').on(t.createdBy),
    index('venue_imports_open_idx')
      .on(t.createdAt)
      .where(sql`${t.status} in ('queued', 'processing')`),
    check('venue_imports_csv_length', sql`char_length(${t.csv}) between 1 and 900000`),
    check(
      'venue_imports_counters',
      sql`${t.createdRows} >= 0 and ${t.skippedRows} >= 0 and ${t.rejectedRows} >= 0 and (${t.totalRows} is null or ${t.totalRows} between 0 and 5000)`,
    ),
    check(
      'venue_imports_issues',
      sql`jsonb_typeof(${t.issues}) = 'array' and jsonb_array_length(${t.issues}) <= 50`,
    ),
    check(
      'venue_imports_completed_state',
      sql`(${t.status} in ('completed', 'failed')) = (${t.completedAt} is not null)`,
    ),
    check(
      'venue_imports_failure_reason',
      sql`(${t.status} = 'failed') = (${t.failureReason} is not null)`,
    ),
    check('venue_imports_dry_run_creates_nothing', sql`not ${t.dryRun} or ${t.createdRows} = 0`),
  ],
);
