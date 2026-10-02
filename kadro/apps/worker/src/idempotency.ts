import { type Database, type Transaction, jobReceipts } from '@kadro/db';
import { and, eq } from 'drizzle-orm';

/**
 * Idempotency receipts (ADR-0028). A handler inserts `job_receipts(queue, idempotency_key)` in the
 * transaction of its database effect; the unique index turns a second run into a no-op. A
 * concurrent duplicate blocks on the index entry until the first transaction ends.
 */

type Executor = Database | Transaction;

export async function hasReceipt(db: Executor, queue: string, key: string): Promise<boolean> {
  const rows = await db
    .select({ id: jobReceipts.id })
    .from(jobReceipts)
    .where(and(eq(jobReceipts.queue, queue), eq(jobReceipts.idempotencyKey, key)))
    .limit(1);
  return rows.length > 0;
}

/** Inserts the receipt; `false` means the effect was already applied by an earlier run. */
export async function insertReceipt(tx: Executor, queue: string, key: string): Promise<boolean> {
  const rows = await tx
    .insert(jobReceipts)
    .values({ queue, idempotencyKey: key })
    .onConflictDoNothing({ target: [jobReceipts.queue, jobReceipts.idempotencyKey] })
    .returning({ id: jobReceipts.id });
  return rows.length > 0;
}

export type OnceResult<T> =
  { readonly applied: true; readonly value: T } | { readonly applied: false };

/** Runs `effect` in one transaction with the receipt, at most once per `(queue, key)`. */
export async function runOnce<T>(
  db: Database,
  queue: string,
  key: string,
  effect: (tx: Transaction) => Promise<T>,
): Promise<OnceResult<T>> {
  return db.transaction(async (tx) => {
    if (!(await insertReceipt(tx, queue, key))) {
      return { applied: false } as const;
    }
    return { applied: true, value: await effect(tx) } as const;
  });
}
