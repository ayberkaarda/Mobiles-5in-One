import {
  BACKUP_VERIFY_CRON,
  COST_GUARD_CRON,
  JOB_QUEUES,
  type JobQueue,
  SUBSCRIPTION_RECONCILE_CRON,
  deadLetterQueue,
} from '@kadro/contracts';

/**
 * Queue options of ADR-0028. Every queue uses the `exclusive` policy: at most one job per
 * `singletonKey` (the job's `idempotencyKey`) may be queued, retrying or active, so a duplicate
 * enqueue is dropped by pg-boss. Coalesced pushes use a per-object `singletonKey` that differs from
 * the `idempotencyKey` (ADR-0031) and carry a dropped change forward (ADR-0044). Exhausted jobs move
 * to `<queue>.dead`.
 */

/** pg-boss keeps its tables in a dedicated schema, created by migration 0010. */
export const PG_BOSS_SCHEMA = 'pgboss';

/** Group role whose privileges every worker session runs with (migration 0010). */
export const WORKER_DB_ROLE = 'kadro_worker';

/** Cron expressions are evaluated in this time zone (ADR-0028). */
export const SCHEDULE_TIME_ZONE = 'Europe/Istanbul';

export const DAY_SECONDS = 86_400;
/** Dead letters are kept 14 days (ADR-0028). */
export const DEAD_LETTER_RETENTION_SECONDS = 14 * DAY_SECONDS;
/** Completed jobs are deleted by pg-boss after 7 days. */
export const COMPLETED_RETENTION_SECONDS = 7 * DAY_SECONDS;

export type QueueStage =
  /** Handler delivered by this worker. */
  | 'active'
  /** Queue and dead-letter queue exist; the handler ships later. */
  | 'queue_only';

export interface QueueDefinition {
  readonly name: JobQueue;
  readonly stage: QueueStage;
  readonly retryLimit: number;
  readonly retryDelaySeconds: number;
  readonly retryBackoff: boolean;
  readonly expireInSeconds: number;
  readonly localConcurrency: number;
  /** Cron expression for scheduled queues. */
  readonly cron?: string;
  /** Time zone of `cron`; defaults to {@link SCHEDULE_TIME_ZONE}. */
  readonly cronTimeZone?: string;
  /**
   * Payload fields of the scheduled job besides its `idempotencyKey`, for queues whose contract
   * has more than the key (the nightly reconciliation sends `userId: null`).
   */
  readonly scheduleData?: Readonly<Record<string, string | number | boolean | null>>;
}

export const QUEUE_DEFINITIONS: Readonly<Record<JobQueue, QueueDefinition>> = {
  'email.send': {
    name: 'email.send',
    stage: 'active',
    retryLimit: 5,
    retryDelaySeconds: 30,
    retryBackoff: true,
    expireInSeconds: 60,
    localConcurrency: 4,
  },
  'push.send': {
    name: 'push.send',
    stage: 'active',
    retryLimit: 3,
    retryDelaySeconds: 60,
    retryBackoff: true,
    expireInSeconds: 60,
    localConcurrency: 4,
  },
  'push.receipts': {
    name: 'push.receipts',
    stage: 'active',
    retryLimit: 3,
    retryDelaySeconds: 300,
    retryBackoff: false,
    expireInSeconds: 60,
    localConcurrency: 1,
  },
  'match.reminder': {
    name: 'match.reminder',
    stage: 'active',
    retryLimit: 2,
    retryDelaySeconds: 60,
    retryBackoff: false,
    expireInSeconds: 60,
    localConcurrency: 1,
  },
  'upload.process': {
    name: 'upload.process',
    stage: 'active',
    retryLimit: 2,
    retryDelaySeconds: 30,
    retryBackoff: false,
    expireInSeconds: 60,
    localConcurrency: 2,
  },
  'account.hard_delete': {
    name: 'account.hard_delete',
    stage: 'active',
    retryLimit: 10,
    retryDelaySeconds: 300,
    retryBackoff: true,
    expireInSeconds: 600,
    localConcurrency: 1,
  },
  'opencall.expire': {
    name: 'opencall.expire',
    stage: 'active',
    retryLimit: 0,
    retryDelaySeconds: 0,
    retryBackoff: false,
    expireInSeconds: 300,
    localConcurrency: 1,
    cron: '5 * * * *',
  },
  'maintenance.sweep': {
    name: 'maintenance.sweep',
    stage: 'active',
    retryLimit: 0,
    retryDelaySeconds: 0,
    retryBackoff: false,
    expireInSeconds: 600,
    localConcurrency: 1,
    cron: '35 * * * *',
  },
  // ADR-0067: one import per job; a failed last attempt marks the import as failed.
  'venue.import': {
    name: 'venue.import',
    stage: 'active',
    retryLimit: 2,
    retryDelaySeconds: 60,
    retryBackoff: false,
    expireInSeconds: 600,
    localConcurrency: 1,
  },
  // ADR-0063: deliveries are applied quickly and retried with backoff; the event row stays
  // unprocessed until a run succeeds, and the nightly reconciliation corrects what is left.
  'webhook.revenuecat.process': {
    name: 'webhook.revenuecat.process',
    stage: 'active',
    retryLimit: 5,
    retryDelaySeconds: 30,
    retryBackoff: true,
    expireInSeconds: 60,
    localConcurrency: 2,
  },
  // Nightly at 03:17 UTC with `userId: null`; per-user runs share the queue.
  'subscription.reconcile': {
    name: 'subscription.reconcile',
    stage: 'active',
    retryLimit: 3,
    retryDelaySeconds: 300,
    retryBackoff: true,
    expireInSeconds: 1_800,
    localConcurrency: 1,
    cron: SUBSCRIPTION_RECONCILE_CRON,
    cronTimeZone: 'UTC',
    scheduleData: { userId: null },
  },
  // ADR-0081: recomputes usage from counters every 15 minutes; the next run covers a failure.
  'cost.guard': {
    name: 'cost.guard',
    stage: 'active',
    retryLimit: 0,
    retryDelaySeconds: 0,
    retryBackoff: false,
    expireInSeconds: 120,
    localConcurrency: 1,
    cron: COST_GUARD_CRON,
    cronTimeZone: 'UTC',
  },
  // ADR-0082: follow-up of a hard delete whose RevenueCat call failed; backoff up to ~21 h, then
  // the dead letter is the operator's signal (the subscriber is still at RevenueCat).
  'revenuecat.subscriber_delete': {
    name: 'revenuecat.subscriber_delete',
    stage: 'active',
    retryLimit: 8,
    retryDelaySeconds: 300,
    retryBackoff: true,
    expireInSeconds: 60,
    localConcurrency: 1,
  },
  // ADR-0082: weekly check of the newest backup artifact; storage errors retry with backoff.
  'backup.verify': {
    name: 'backup.verify',
    stage: 'active',
    retryLimit: 3,
    retryDelaySeconds: 600,
    retryBackoff: true,
    expireInSeconds: 300,
    localConcurrency: 1,
    cron: BACKUP_VERIFY_CRON,
    cronTimeZone: 'UTC',
  },
};

/** Test and operations hook: overrides retry timing without touching the defaults above. */
export type QueueOverrides = Partial<
  Record<
    JobQueue,
    Partial<Pick<QueueDefinition, 'retryLimit' | 'retryDelaySeconds' | 'retryBackoff'>>
  >
>;

export function resolveQueueDefinitions(overrides: QueueOverrides = {}): QueueDefinition[] {
  // eslint-disable-next-line security/detect-object-injection -- name iterates the typed JOB_QUEUES tuple
  return JOB_QUEUES.map((name) => ({ ...QUEUE_DEFINITIONS[name], ...overrides[name] }));
}

export function deadLetterName(queue: JobQueue): string {
  return deadLetterQueue(queue);
}

/** Every queue name the worker creates: the source queues and their dead-letter queues. */
export function allQueueNames(): string[] {
  return JOB_QUEUES.flatMap((queue) => [queue, deadLetterName(queue)]);
}
