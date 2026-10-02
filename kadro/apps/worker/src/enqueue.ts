import { JOB_PAYLOAD_SCHEMAS, type JobPayload, type JobQueue } from '@kadro/contracts';
import { type Transaction } from '@kadro/db';
import { sql } from 'drizzle-orm';
import { type Db, type PgBoss, fromDrizzle } from 'pg-boss';

export interface EnqueueOptions {
  /** Commit the job together with the caller's transaction (transactional outbox, ADR-0028). */
  readonly tx?: Transaction;
  readonly startAfter?: Date;
  /**
   * Coalescing key of a coalesced push (ADR-0031); the job's `idempotencyKey` then names its
   * window. Defaults to the `idempotencyKey`.
   */
  readonly singletonKey?: string;
}

/** Runs pg-boss statements inside a Drizzle transaction. */
export function bossExecutor(tx: Transaction): Db {
  return fromDrizzle(tx, sql);
}

/**
 * Validates the payload with the contract schema and sends it with `singletonKey =
 * idempotencyKey` unless a coalescing key is given. Returns the job id, or `null` when an identical job is already queued or active
 * (the `exclusive` queue policy drops the duplicate).
 */
export async function enqueue<TQueue extends JobQueue>(
  boss: PgBoss,
  queue: TQueue,
  payload: JobPayload<TQueue>,
  options: EnqueueOptions = {},
): Promise<string | null> {
  // eslint-disable-next-line security/detect-object-injection -- queue is a typed JobQueue key
  const schema = JOB_PAYLOAD_SCHEMAS[queue];
  const data = schema.parse(payload) as JobPayload<TQueue>;
  return boss.send(queue, data, {
    singletonKey: options.singletonKey ?? data.idempotencyKey,
    ...(options.startAfter ? { startAfter: options.startAfter } : {}),
    ...(options.tx ? { db: bossExecutor(options.tx) } : {}),
  });
}
