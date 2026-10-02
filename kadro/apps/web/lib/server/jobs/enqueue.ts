import { createHash } from 'node:crypto';

import {
  idempotencyKeySchema,
  JOB_PAYLOAD_SCHEMAS,
  type JobPayload,
  type JobQueue,
} from '@kadro/contracts';
import { type Transaction } from '@kadro/db';
import { sql } from 'drizzle-orm';
import { fromDrizzle } from 'pg-boss';

import { type SendOnlyClient } from './client';

/**
 * Transactional enqueue (ADR-0028). The job row is inserted through the caller's Drizzle
 * transaction (pg-boss `db` executor), so it commits or rolls back together with the domain
 * write: no job for a rolled-back write, no committed write without its job. Any failure to
 * enqueue (unknown queue, invalid payload, missing grant) throws and so aborts the transaction;
 * a notification is never lost silently.
 */

/** Payload of a queue without its key; the key is passed in the options. */
export type JobData<TQueue extends JobQueue> = Omit<JobPayload<TQueue>, 'idempotencyKey'>;

export interface EnqueueOptions {
  /**
   * Stable business key (ADR-0028), also the pg-boss `singletonKey` unless `singletonKey` is given:
   * while a job with the same key is queued or active, a second enqueue is dropped (`exclusive`
   * queue policy). The worker records it as the delivery receipt key.
   */
  readonly idempotencyKey: string;
  /**
   * Coalescing key of a coalesced notification (ADR-0031): the per-object key that drops repeats
   * while one job is queued or active. The `idempotencyKey` then names the coalescing window, so a
   * later window is a new delivery instead of a duplicate of the first one's receipt.
   */
  readonly singletonKey?: string;
  /** Delayed start (reminders, coalesced notifications, hard delete). */
  readonly startAfter?: Date;
}

/** Raised when a payload or key does not satisfy the job contract (a programming error). */
export class JobContractError extends Error {
  constructor(queue: JobQueue, detail: string) {
    super(`job for ${queue} violates its contract: ${detail}`);
    this.name = 'JobContractError';
  }
}

export interface JobSender {
  /**
   * Validates `{ ...payload, idempotencyKey }` with the contract schema of `queue` (strict) and
   * inserts the job inside `tx`. Returns the job id, or `null` when an identical job is already
   * queued or active, which counts as success.
   */
  enqueue<TQueue extends JobQueue>(
    tx: Transaction,
    queue: TQueue,
    payload: JobData<TQueue>,
    options: EnqueueOptions,
  ): Promise<string | null>;
}

/**
 * Key for a job without a business key: SHA-256 of the canonical JSON of `{ queue, data }`
 * (object keys sorted), as ADR-0028 prescribes.
 */
export function contentIdempotencyKey(
  queue: JobQueue,
  data: Readonly<Record<string, unknown>>,
): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(canonical);
    }
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, entry]) => [key, canonical(entry)]),
      );
    }
    return value;
  };
  return createHash('sha256')
    .update(JSON.stringify({ queue, data: canonical(data) }), 'utf8')
    .digest('hex');
}

export function createJobSender(client: SendOnlyClient): JobSender {
  return {
    async enqueue(tx, queue, payload, options) {
      const key = idempotencyKeySchema.safeParse(options.idempotencyKey);
      if (!key.success) {
        throw new JobContractError(queue, 'invalid idempotency key');
      }
      const singleton = idempotencyKeySchema.safeParse(options.singletonKey ?? key.data);
      if (!singleton.success) {
        throw new JobContractError(queue, 'invalid singleton key');
      }
      // eslint-disable-next-line security/detect-object-injection -- queue is a typed JobQueue key
      const schema = JOB_PAYLOAD_SCHEMAS[queue];
      const parsed = schema.safeParse({ ...payload, idempotencyKey: key.data });
      if (!parsed.success) {
        // Issue paths only: payload values are never written to logs or errors.
        const paths = parsed.error.issues.map((issue) => issue.path.join('.') || '(root)');
        throw new JobContractError(queue, `invalid payload at ${paths.join(', ')}`);
      }
      const boss = await client.boss();
      return boss.send(queue, parsed.data, {
        singletonKey: singleton.data,
        ...(options.startAfter === undefined ? {} : { startAfter: options.startAfter }),
        db: fromDrizzle(tx, sql),
      });
    },
  };
}
