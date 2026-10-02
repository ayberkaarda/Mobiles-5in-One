import { eq, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database, Transaction } from '../src/client.js';
import {
  lockPushRecipientForDeletion,
  lockPushResend,
  recordPushResend,
  recordPushResendForRecipient,
  LOCK_TIMEOUT_MS,
  setLockTimeout,
} from '../src/push-resends.js';
import { newId, pushResends, users } from '../src/schema/index.js';
import {
  PG_CHECK_VIOLATION,
  PG_INSUFFICIENT_PRIVILEGE,
  PG_LOCK_NOT_AVAILABLE,
  PG_UNIQUE_VIOLATION,
  type TestDatabase,
  createMigratedDatabase,
  expectPgError,
} from './support.js';

/** Pending re-sends of coalesced pushes (ADR-0044): table, grants, record and lock helpers. */

let testDb: TestDatabase;
let db: Database;

beforeAll(async () => {
  testDb = await createMigratedDatabase('kadro_push_resends');
  db = testDb.client.db;
});

afterAll(async () => {
  await testDb.dispose();
});

function request(singletonKey = `rsvp:${newId()}:${newId()}`, requestedAt = new Date()) {
  return {
    singletonKey,
    type: 'rsvp.changed' as const,
    userId: newId(),
    refId: newId(),
    requestedAt,
  };
}

async function rowOf(singletonKey: string) {
  const [row] = await db
    .select({
      refId: pushResends.refId,
      requestedAt: pushResends.requestedAt,
      version: pushResends.version,
    })
    .from(pushResends)
    .where(eq(pushResends.singletonKey, singletonKey));
  return row;
}

/** Runs `fn` in a transaction whose role is one of the application group roles. */
async function asRole<T>(
  role: 'kadro_app' | 'kadro_worker',
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      role === 'kadro_app' ? sql`set local role kadro_app` : sql`set local role kadro_worker`,
    );
    return fn(tx);
  });
}

describe('push_resends table', () => {
  it('holds one row per coalescing key', async () => {
    const first = request();
    await db.insert(pushResends).values(first);
    await expectPgError(
      db.insert(pushResends).values({ ...request(first.singletonKey) }),
      PG_UNIQUE_VIOLATION,
      'push_resends_singleton_key_key',
    );
  });

  it('accepts only the coalesced types, keys up to 128 characters and positive versions', async () => {
    await expectPgError(
      db.insert(pushResends).values({ ...request(), type: 'match.updated' as 'rsvp.changed' }),
      PG_CHECK_VIOLATION,
      'push_resends_type',
    );
    await db
      .insert(pushResends)
      .values({ ...request('k'.repeat(128)), type: 'application.received' });
    await expectPgError(
      db.insert(pushResends).values(request('k'.repeat(129))),
      PG_CHECK_VIOLATION,
      'push_resends_singleton_key_length',
    );
    await expectPgError(
      db.insert(pushResends).values({ ...request(), version: 0 }),
      PG_CHECK_VIOLATION,
      'push_resends_version_positive',
    );
  });
});

describe('recordPushResend', () => {
  it('counts every dropped change and keeps the first moment and reference (as kadro_app)', async () => {
    const first = request(undefined, new Date('2031-01-01T10:00:00.000Z'));
    await asRole('kadro_app', (tx) => recordPushResend(tx, first));
    expect(await rowOf(first.singletonKey)).toEqual({
      refId: first.refId,
      requestedAt: first.requestedAt,
      version: 1,
    });

    const later = { ...request(first.singletonKey), requestedAt: new Date('2031-01-01T10:04:00Z') };
    await asRole('kadro_app', (tx) => recordPushResend(tx, later));
    await asRole('kadro_app', (tx) => recordPushResend(tx, later));
    expect(await rowOf(first.singletonKey)).toEqual({
      refId: first.refId,
      requestedAt: first.requestedAt,
      version: 3,
    });
  });

  it('lets kadro_app update only the version and updated_at columns', async () => {
    const row = request();
    await recordPushResend(db, row);
    for (const change of [
      { userId: newId() },
      { refId: newId() },
      { singletonKey: `rsvp:${newId()}:${newId()}` },
      { type: 'application.received' as const },
      { requestedAt: new Date() },
    ]) {
      await expectPgError(
        asRole('kadro_app', (tx) =>
          tx.update(pushResends).set(change).where(eq(pushResends.singletonKey, row.singletonKey)),
        ),
        PG_INSUFFICIENT_PRIVILEGE,
      );
    }
    await asRole('kadro_app', (tx) =>
      tx
        .update(pushResends)
        .set({ version: 5, updatedAt: new Date() })
        .where(eq(pushResends.singletonKey, row.singletonKey)),
    );
    expect((await rowOf(row.singletonKey))?.version).toBe(5);
  });

  it('gives kadro_app no delete and kadro_worker only read and delete', async () => {
    const row = request();
    await recordPushResend(db, row);
    await expectPgError(
      asRole('kadro_app', (tx) =>
        tx.delete(pushResends).where(eq(pushResends.singletonKey, row.singletonKey)),
      ),
      PG_INSUFFICIENT_PRIVILEGE,
    );
    await expectPgError(
      asRole('kadro_worker', (tx) => recordPushResend(tx, request())),
      PG_INSUFFICIENT_PRIVILEGE,
    );
    await expectPgError(
      asRole('kadro_worker', (tx) =>
        tx
          .update(pushResends)
          .set({ version: 9 })
          .where(eq(pushResends.singletonKey, row.singletonKey)),
      ),
      PG_INSUFFICIENT_PRIVILEGE,
    );
    const deleted = await asRole('kadro_worker', async (tx) => {
      const [seen] = await tx
        .select({ version: pushResends.version })
        .from(pushResends)
        .where(eq(pushResends.singletonKey, row.singletonKey));
      expect(seen).toEqual({ version: 1 });
      return tx
        .delete(pushResends)
        .where(eq(pushResends.singletonKey, row.singletonKey))
        .returning({ id: pushResends.id });
    });
    expect(deleted).toHaveLength(1);
  });
});

describe('lockPushResend', () => {
  it('makes a second transaction on the same key wait until the first ends', async () => {
    const singletonKey = `application:${newId()}:${newId()}`;
    let releaseFirst: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstPid = 0;
    let locked: () => void = () => undefined;
    const firstLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const order: string[] = [];

    const first = db.transaction(async (tx) => {
      const result = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      firstPid = Number(result.rows[0]?.pid);
      await lockPushResend(tx, singletonKey);
      locked();
      await gate;
      order.push('first');
    });
    await firstLocked;
    const second = asRole('kadro_app', async (tx) => {
      await lockPushResend(tx, singletonKey);
      order.push('second');
    });

    // Observe the second backend waiting on the first one's advisory lock, then let it go.
    const observer = new pg.Client({ connectionString: testDb.url });
    await observer.connect();
    try {
      const deadline = Date.now() + 15_000;
      for (;;) {
        const { rows } = await observer.query<{ pid: number }>(
          `select pid from pg_stat_activity
            where wait_event_type = 'Lock' and wait_event = 'advisory'
              and $1 = any(pg_blocking_pids(pid))`,
          [firstPid],
        );
        if (rows.length > 0) break;
        if (Date.now() > deadline) throw new Error('no backend waits on the advisory lock');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      await observer.end();
    }
    // A different key is not blocked.
    await asRole('kadro_app', (tx) => lockPushResend(tx, `${singletonKey}:other`));
    expect(order).toEqual([]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
  });
});

describe('recordPushResendForRecipient', () => {
  it('takes only a transaction, never the pool (type check)', () => {
    // A pool-level Database would run each statement in its own autocommit transaction and
    // release the transaction-scoped locks at once.
    // @ts-expect-error a Database is not a Transaction
    const record = () => recordPushResendForRecipient(db, request());
    // @ts-expect-error a Database is not a Transaction
    const lock = () => lockPushRecipientForDeletion(db, newId());
    expect([typeof record, typeof lock]).toEqual(['function', 'function']);
  });

  async function newUser(): Promise<string> {
    const [row] = await db
      .insert(users)
      .values({ email: `alici-${newId()}@example.test`, displayName: 'Alıcı' })
      .returning({ id: users.id });
    if (row === undefined) throw new Error('user insert returned no row');
    return row.id;
  }

  it('records for an existing recipient and skips a missing one (as kadro_app)', async () => {
    const present = { ...request(), userId: await newUser() };
    expect(await asRole('kadro_app', (tx) => recordPushResendForRecipient(tx, present))).toBe(true);
    expect((await rowOf(present.singletonKey))?.version).toBe(1);

    const missing = request();
    expect(await asRole('kadro_app', (tx) => recordPushResendForRecipient(tx, missing))).toBe(
      false,
    );
    expect(await rowOf(missing.singletonKey)).toBeUndefined();
  });

  it('skips while a deletion holds the recipient lock, without waiting for it', async () => {
    const pending = { ...request(), userId: await newUser() };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const deleting = db.transaction(async (tx) => {
      await lockPushRecipientForDeletion(tx, pending.userId);
      locked();
      await gate;
    });
    await isLocked;
    try {
      expect(await asRole('kadro_app', (tx) => recordPushResendForRecipient(tx, pending))).toBe(
        false,
      );
    } finally {
      release();
    }
    await deleting;
    expect(await rowOf(pending.singletonKey)).toBeUndefined();
    expect(await asRole('kadro_app', (tx) => recordPushResendForRecipient(tx, pending))).toBe(true);
  });

  describe('lock timeout (SQLSTATE 55P03)', () => {
    const TIMEOUT_MS = 300;

    /** Holds `hold` open in its own transaction until the returned `release` is called. */
    async function holding(hold: (tx: Transaction) => Promise<void>) {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: () => void = () => undefined;
      let failed: (error: unknown) => void = () => undefined;
      const isReady = new Promise<void>((resolve, reject) => {
        ready = resolve;
        failed = reject;
      });
      const holder = db.transaction(async (tx) => {
        try {
          await hold(tx);
        } catch (error) {
          failed(error);
          throw error;
        }
        ready();
        await gate;
      });
      // Avoid an unhandled rejection when `hold` fails; the failure surfaces through `isReady`.
      holder.catch(() => undefined);
      await isReady;
      return { release, done: holder };
    }

    it('uses a short default bound', () => {
      expect(LOCK_TIMEOUT_MS).toBeGreaterThan(0);
      expect(LOCK_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
    });

    it('fails a blocked advisory lock after the timeout instead of waiting', async () => {
      const key = `rsvp:${newId()}:${newId()}`;
      const blocker = await holding((tx) => lockPushResend(tx, key));
      try {
        const started = Date.now();
        await expectPgError(
          db.transaction(async (tx) => {
            await setLockTimeout(tx, TIMEOUT_MS);
            await lockPushResend(tx, key);
          }),
          PG_LOCK_NOT_AVAILABLE,
        );
        const waited = Date.now() - started;
        expect(waited).toBeGreaterThanOrEqual(TIMEOUT_MS - 50);
        expect(waited).toBeLessThan(TIMEOUT_MS + 3_000);
      } finally {
        blocker.release();
      }
      await blocker.done;
    });

    it('fails a blocked deletion recipient lock and a blocked row lock the same way', async () => {
      const userId = await newUser();
      const producer = await holding(async (tx) => {
        expect(await recordPushResendForRecipient(tx, { ...request(), userId })).toBe(true);
      });
      try {
        await expectPgError(
          db.transaction(async (tx) => {
            await setLockTimeout(tx, TIMEOUT_MS);
            await lockPushRecipientForDeletion(tx, userId);
          }),
          PG_LOCK_NOT_AVAILABLE,
        );
      } finally {
        producer.release();
      }
      await producer.done;

      const key = `rsvp:${newId()}:${newId()}`;
      await recordPushResend(db, { ...request(key), userId });
      const rowHolder = await holding(async (tx) => {
        await tx.select().from(pushResends).where(eq(pushResends.singletonKey, key)).for('update');
      });
      try {
        await expectPgError(
          db.transaction(async (tx) => {
            await setLockTimeout(tx, TIMEOUT_MS);
            await tx.delete(pushResends).where(eq(pushResends.singletonKey, key));
          }),
          PG_LOCK_NOT_AVAILABLE,
        );
      } finally {
        rowHolder.release();
      }
      await rowHolder.done;
      expect(await rowOf(key)).toBeDefined();
    });

    it('is transaction-local and lets an uncontended transaction proceed', async () => {
      await db.transaction(async (tx) => {
        await setLockTimeout(tx, TIMEOUT_MS);
        const shown = await tx.execute<{ lock_timeout: string }>(sql`show lock_timeout`);
        expect(shown.rows[0]?.lock_timeout).toBe('300ms');
        await lockPushResend(tx, `rsvp:${newId()}:${newId()}`);
      });
      const after = await db.execute<{ lock_timeout: string }>(sql`show lock_timeout`);
      expect(after.rows[0]?.lock_timeout).not.toBe('300ms');
    });
  });
});
