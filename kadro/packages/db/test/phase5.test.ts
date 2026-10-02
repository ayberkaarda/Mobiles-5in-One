import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type WebhookEventInput,
  getWebhookEvent,
  insertWebhookEventIfNew,
  markWebhookEventProcessed,
  upsertSubscriptionIfNotStale,
} from '../src/billing.js';
import type { Database, Transaction } from '../src/client.js';
import {
  confirmPendingTotpSecret,
  discardPendingTotpSecret,
  getTotpEnrollment,
  setPendingTotpSecret,
} from '../src/totp.js';
import { newId, subscriptions, users, venueImports, webhookEvents } from '../src/schema/index.js';
import {
  PG_CHECK_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  PG_INSUFFICIENT_PRIVILEGE,
  type TestDatabase,
  createMigratedDatabase,
  expectPgError,
  sha256Hex,
  uniqueSuffix,
} from './support.js';

/** Phase 5 schema (ADR-0063, ADR-0064): webhook and subscription columns, pending TOTP, imports. */

let testDb: TestDatabase;
let db: Database;

beforeAll(async () => {
  testDb = await createMigratedDatabase('kadro_phase5');
  db = testDb.client.db;
});

afterAll(async () => {
  await testDb.dispose();
});

async function createUser(overrides: Partial<typeof users.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      email: `staff-${uniqueSuffix()}@example.test`,
      displayName: 'Test Yetkili',
      ...overrides,
    })
    .returning({ id: users.id });
  if (!row) throw new Error('user insert returned no row');
  return row.id;
}

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

function event(overrides: Partial<WebhookEventInput> = {}): WebhookEventInput {
  const eventId = `evt-${uniqueSuffix()}`;
  return {
    eventId,
    payloadHash: sha256Hex(eventId),
    eventType: 'INITIAL_PURCHASE',
    appUserId: newId(),
    productId: 'kadro_pro_monthly',
    store: 'app_store',
    environment: 'sandbox',
    eventAt: new Date('2031-03-01T10:00:00.000Z'),
    expiresAt: new Date('2031-04-01T10:00:00.000Z'),
    outcome: 'accepted',
    ignoredReason: null,
    ...overrides,
  };
}

describe('webhook events', () => {
  it('stores the normalized event once and reports a replay as a duplicate', async () => {
    const input = event();
    const first = await insertWebhookEventIfNew(db, input);
    expect(first.inserted).toBe(true);
    const second = await insertWebhookEventIfNew(db, { ...input, eventType: 'RENEWAL' });
    expect(second).toEqual({ inserted: false });
    if (!first.inserted) throw new Error('expected an insert');
    const stored = await getWebhookEvent(db, first.id);
    expect(stored).toMatchObject({
      provider: 'revenuecat',
      eventId: input.eventId,
      eventType: 'INITIAL_PURCHASE',
      appUserId: input.appUserId,
      productId: 'kadro_pro_monthly',
      store: 'app_store',
      environment: 'sandbox',
      eventAt: input.eventAt,
      expiresAt: input.expiresAt,
      outcome: 'accepted',
      ignoredReason: null,
      processedAt: null,
    });
  });

  it('keeps one row when the same delivery arrives concurrently', async () => {
    const input = event();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => insertWebhookEventIfNew(db, input)),
    );
    expect(results.filter((result) => result.inserted)).toHaveLength(1);
    const rows = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.eventId, input.eventId));
    expect(rows).toHaveLength(1);
  });

  it('stores an ignored event with its reason and no user or product', async () => {
    const input = event({
      outcome: 'ignored',
      ignoredReason: 'anonymous_user',
      appUserId: '$RCAnonymousID:abc',
      productId: null,
      store: null,
      environment: null,
      expiresAt: null,
    });
    const result = await insertWebhookEventIfNew(db, input);
    expect(result.inserted).toBe(true);
  });

  it('requires a reason exactly for ignored events and bounds the text columns', async () => {
    await expectPgError(
      insertWebhookEventIfNew(db, event({ outcome: 'ignored', ignoredReason: null })),
      PG_CHECK_VIOLATION,
      'webhook_events_ignored_reason_matches_outcome',
    );
    await expectPgError(
      insertWebhookEventIfNew(db, event({ outcome: 'accepted', ignoredReason: 'unknown_user' })),
      PG_CHECK_VIOLATION,
      'webhook_events_ignored_reason_matches_outcome',
    );
    await expectPgError(
      insertWebhookEventIfNew(db, event({ eventType: 'X'.repeat(65) })),
      PG_CHECK_VIOLATION,
      'webhook_events_text_lengths',
    );
    await expectPgError(
      insertWebhookEventIfNew(db, event({ eventId: 'e'.repeat(129) })),
      PG_CHECK_VIOLATION,
      'webhook_events_text_lengths',
    );
  });

  it('marks an event processed once', async () => {
    const result = await insertWebhookEventIfNew(db, event());
    if (!result.inserted) throw new Error('expected an insert');
    const at = new Date('2031-03-01T11:00:00.000Z');
    expect(await markWebhookEventProcessed(db, result.id, at)).toBe(true);
    expect(await markWebhookEventProcessed(db, result.id)).toBe(false);
    expect((await getWebhookEvent(db, result.id))?.processedAt).toEqual(at);
    expect(await markWebhookEventProcessed(db, newId())).toBe(false);
  });

  it('is writable by both application roles', async () => {
    expect((await asRole('kadro_app', (tx) => insertWebhookEventIfNew(tx, event()))).inserted).toBe(
      true,
    );
    expect(
      (await asRole('kadro_worker', (tx) => insertWebhookEventIfNew(tx, event()))).inserted,
    ).toBe(true);
  });
});

describe('subscription upsert ordered by event time', () => {
  async function write(
    userId: string,
    overrides: Partial<Parameters<typeof upsertSubscriptionIfNotStale>[1]> = {},
  ) {
    return upsertSubscriptionIfNotStale(db, {
      userId,
      productId: 'kadro_pro_monthly',
      environment: 'sandbox',
      status: 'active',
      expiresAt: new Date('2031-04-01T00:00:00.000Z'),
      store: 'app_store',
      eventAt: new Date('2031-03-01T00:00:00.000Z'),
      eventId: `evt-${uniqueSuffix()}`,
      ...overrides,
    });
  }

  async function rowOf(userId: string) {
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
    return row;
  }

  it('creates the row with the user id as RevenueCat app user id', async () => {
    const userId = await createUser();
    const result = await write(userId);
    expect(result.applied).toBe(true);
    expect(await rowOf(userId)).toMatchObject({
      rcAppUserId: userId,
      status: 'active',
      store: 'app_store',
      lastEventAt: new Date('2031-03-01T00:00:00.000Z'),
    });
  });

  it('applies a newer event and ignores an older one', async () => {
    const userId = await createUser();
    await write(userId, { eventAt: new Date('2031-03-10T00:00:00.000Z'), status: 'active' });
    const stale = await write(userId, {
      eventAt: new Date('2031-03-05T00:00:00.000Z'),
      status: 'expired',
      eventId: 'evt-stale',
    });
    expect(stale).toEqual({ applied: false });
    expect(await rowOf(userId)).toMatchObject({ status: 'active' });

    const newer = await write(userId, {
      eventAt: new Date('2031-03-20T00:00:00.000Z'),
      status: 'cancelled',
      eventId: 'evt-newer',
    });
    expect(newer.applied).toBe(true);
    expect(await rowOf(userId)).toMatchObject({
      status: 'cancelled',
      lastEventId: 'evt-newer',
      lastEventAt: new Date('2031-03-20T00:00:00.000Z'),
    });
  });

  it('keeps the first of two different events with an equal time, in any order of retries', async () => {
    const userId = await createUser();
    const at = new Date('2031-03-10T00:00:00.000Z');
    expect((await write(userId, { eventAt: at, eventId: 'evt-a', status: 'active' })).applied).toBe(
      true,
    );
    expect(await write(userId, { eventAt: at, eventId: 'evt-b', status: 'expired' })).toEqual({
      applied: false,
    });
    expect((await write(userId, { eventAt: at, eventId: 'evt-a', status: 'active' })).applied).toBe(
      true,
    );
    expect(await rowOf(userId)).toMatchObject({ status: 'active', lastEventId: 'evt-a' });
  });

  it('applies a reconciliation only when it read the provider after the last event', async () => {
    const userId = await createUser();
    const at = new Date('2031-03-10T00:00:00.000Z');
    await write(userId, { eventAt: at, eventId: 'evt-a', status: 'active' });
    expect(await write(userId, { eventAt: at, eventId: null, status: 'expired' })).toEqual({
      applied: false,
    });
    const later = new Date(at.getTime() + 1);
    expect(
      (await write(userId, { eventAt: later, eventId: null, status: 'expired' })).applied,
    ).toBe(true);
    expect(await rowOf(userId)).toMatchObject({ status: 'expired', lastEventId: null });
  });

  it('re-applies an event with the same time idempotently', async () => {
    const userId = await createUser();
    const input = { eventAt: new Date('2031-03-10T00:00:00.000Z'), eventId: 'evt-same' };
    await write(userId, input);
    expect((await write(userId, input)).applied).toBe(true);
    const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
    expect(rows).toHaveLength(1);
  });

  it('keeps one row per product and environment', async () => {
    const userId = await createUser();
    await write(userId);
    await write(userId, { productId: 'kadro_pro_yearly' });
    await write(userId, { environment: 'production' });
    const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
    expect(rows).toHaveLength(3);
  });

  it('lets a legacy row without an event time be overwritten', async () => {
    const userId = await createUser();
    await db.insert(subscriptions).values({
      userId,
      rcAppUserId: userId,
      productId: 'kadro_pro_monthly',
      status: 'expired',
      environment: 'sandbox',
    });
    expect((await write(userId)).applied).toBe(true);
    expect(await rowOf(userId)).toMatchObject({ status: 'active', store: 'app_store' });
  });

  it('accepts a reconciliation write without an event id and bounds the id length', async () => {
    const userId = await createUser();
    expect((await write(userId, { eventId: null })).applied).toBe(true);
    await expectPgError(
      write(userId, { eventId: 'e'.repeat(129), eventAt: new Date('2031-05-01T00:00:00.000Z') }),
      PG_CHECK_VIOLATION,
      'subscriptions_last_event_id_length',
    );
  });

  it('rejects a subscription of a user that does not exist', async () => {
    await expectPgError(write(newId()), PG_FOREIGN_KEY_VIOLATION);
  });

  it('rolls the write back with its transaction', async () => {
    const userId = await createUser();
    await expect(
      db.transaction(async (tx) => {
        await upsertSubscriptionIfNotStale(tx, {
          userId,
          productId: 'kadro_pro_monthly',
          environment: 'sandbox',
          status: 'active',
          expiresAt: null,
          store: null,
          eventAt: new Date('2031-03-01T00:00:00.000Z'),
          eventId: 'evt-rollback',
        });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await rowOf(userId)).toBeUndefined();
  });
});

describe('pending TOTP secret', () => {
  const WINDOW = 600;

  it('stores a pending secret and replaces it with a new enrollment', async () => {
    const userId = await createUser({ role: 'moderator' });
    const t0 = new Date('2031-03-01T10:00:00.000Z');
    expect(await setPendingTotpSecret(db, userId, 'cipher-1', t0)).toBe('stored');
    expect(await getTotpEnrollment(db, userId)).toEqual({
      active: false,
      pending: { ciphertext: 'cipher-1', createdAt: t0 },
    });
    const t1 = new Date('2031-03-01T10:05:00.000Z');
    expect(await setPendingTotpSecret(db, userId, 'cipher-2', t1)).toBe('stored');
    expect((await getTotpEnrollment(db, userId))?.pending).toEqual({
      ciphertext: 'cipher-2',
      createdAt: t1,
    });
  });

  it('confirms up to and including the end of the window and not after it', async () => {
    const t0 = new Date('2031-03-01T10:00:00.000Z');
    for (const [offsetMs, expected] of [
      [600_000, 'confirmed'],
      [600_001, 'expired'],
    ] as const) {
      const userId = await createUser({ role: 'admin' });
      await setPendingTotpSecret(db, userId, 'cipher-edge', t0);
      expect(
        await confirmPendingTotpSecret(
          db,
          { userId, expectedCiphertext: 'cipher-edge', step: 1, windowSeconds: WINDOW },
          new Date(t0.getTime() + offsetMs),
        ),
      ).toBe(expected);
    }
  });

  it('does not start an enrollment for a deactivated account', async () => {
    const userId = await createUser({ role: 'moderator', deactivatedAt: new Date() });
    expect(await setPendingTotpSecret(db, userId, 'cipher')).toBe('user_not_found');
    expect((await getTotpEnrollment(db, userId))?.pending).toBeNull();
  });

  it('confirms inside the window and moves the secret to the active column', async () => {
    const userId = await createUser({ role: 'admin' });
    const t0 = new Date('2031-03-01T10:00:00.000Z');
    await setPendingTotpSecret(db, userId, 'cipher-a', t0);
    const result = await confirmPendingTotpSecret(
      db,
      { userId, expectedCiphertext: 'cipher-a', step: 59_000_001, windowSeconds: WINDOW },
      new Date(t0.getTime() + 599_000),
    );
    expect(result).toBe('confirmed');
    const [row] = await db
      .select({
        enc: users.totpSecretEnc,
        pending: users.totpPendingSecretEnc,
        pendingAt: users.totpPendingCreatedAt,
        step: users.totpLastUsedStep,
      })
      .from(users)
      .where(eq(users.id, userId));
    expect(row).toEqual({ enc: 'cipher-a', pending: null, pendingAt: null, step: 59_000_001 });
  });

  it('refuses to confirm after the window, with a replaced secret or without a pending one', async () => {
    const userId = await createUser({ role: 'admin' });
    const t0 = new Date('2031-03-01T10:00:00.000Z');
    const request = (expectedCiphertext: string) => ({
      userId,
      expectedCiphertext,
      step: 1,
      windowSeconds: WINDOW,
    });
    expect(await confirmPendingTotpSecret(db, request('x'), t0)).toBe('no_pending');
    await setPendingTotpSecret(db, userId, 'cipher-old', t0);
    await setPendingTotpSecret(db, userId, 'cipher-new', t0);
    expect(await confirmPendingTotpSecret(db, request('cipher-old'), t0)).toBe('replaced');
    expect(
      await confirmPendingTotpSecret(db, request('cipher-new'), new Date(t0.getTime() + 601_000)),
    ).toBe('expired');
    expect((await getTotpEnrollment(db, userId))?.active).toBe(false);
  });

  it('never replaces or re-confirms an active secret', async () => {
    const userId = await createUser({ role: 'admin' });
    const t0 = new Date('2031-03-01T10:00:00.000Z');
    await setPendingTotpSecret(db, userId, 'cipher-a', t0);
    await confirmPendingTotpSecret(
      db,
      { userId, expectedCiphertext: 'cipher-a', step: 5, windowSeconds: WINDOW },
      t0,
    );
    expect(await setPendingTotpSecret(db, userId, 'cipher-b', t0)).toBe('already_enrolled');
    expect(
      await confirmPendingTotpSecret(
        db,
        { userId, expectedCiphertext: 'cipher-b', step: 6, windowSeconds: WINDOW },
        t0,
      ),
    ).toBe('already_enrolled');
    expect((await getTotpEnrollment(db, userId))?.active).toBe(true);
  });

  it('confirms exactly once under concurrent requests', async () => {
    const userId = await createUser({ role: 'admin' });
    const t0 = new Date();
    await setPendingTotpSecret(db, userId, 'cipher-race', t0);
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        confirmPendingTotpSecret(
          db,
          { userId, expectedCiphertext: 'cipher-race', step: 10 + i, windowSeconds: WINDOW },
          t0,
        ),
      ),
    );
    expect(results.filter((result) => result === 'confirmed')).toHaveLength(1);
    expect(results.filter((result) => result === 'already_enrolled')).toHaveLength(4);
  });

  it('reports a missing user and discards a pending secret', async () => {
    expect(await setPendingTotpSecret(db, newId(), 'cipher')).toBe('user_not_found');
    expect(await getTotpEnrollment(db, newId())).toBeUndefined();
    const userId = await createUser({ role: 'moderator' });
    await setPendingTotpSecret(db, userId, 'cipher');
    expect(await discardPendingTotpSecret(db, userId)).toBe(true);
    expect(await discardPendingTotpSecret(db, userId)).toBe(false);
    expect((await getTotpEnrollment(db, userId))?.pending).toBeNull();
  });

  it('rejects inconsistent pending columns, an active plus pending secret and a tombstone', async () => {
    const userId = await createUser();
    await expectPgError(
      db.update(users).set({ totpPendingSecretEnc: 'cipher' }).where(eq(users.id, userId)),
      PG_CHECK_VIOLATION,
      'users_totp_pending_consistent',
    );
    await expectPgError(
      db.update(users).set({ totpPendingCreatedAt: new Date() }).where(eq(users.id, userId)),
      PG_CHECK_VIOLATION,
      'users_totp_pending_consistent',
    );
    await expectPgError(
      db
        .update(users)
        .set({
          totpSecretEnc: 'active',
          totpPendingSecretEnc: 'pending',
          totpPendingCreatedAt: new Date(),
        })
        .where(eq(users.id, userId)),
      PG_CHECK_VIOLATION,
      'users_totp_pending_consistent',
    );
    await expectPgError(
      db
        .update(users)
        .set({ totpPendingSecretEnc: '', totpPendingCreatedAt: new Date() })
        .where(eq(users.id, userId)),
      PG_CHECK_VIOLATION,
      'users_totp_pending_consistent',
    );
    await expectPgError(
      db.insert(users).values({
        email: `tomb-${uniqueSuffix()}@example.test`,
        displayName: 'Silinmis Oyuncu',
        isTombstone: true,
        deactivatedAt: new Date(),
        totpPendingSecretEnc: 'cipher',
        totpPendingCreatedAt: new Date(),
      }),
      PG_CHECK_VIOLATION,
      'users_totp_pending_consistent',
    );
  });
});

describe('venue imports', () => {
  const csv = 'name,il,ilce,latitude,longitude,indoor\nSaha,istanbul,kadikoy,41.0,29.0,true\n';

  async function insertImport(overrides: Partial<typeof venueImports.$inferInsert> = {}) {
    const [row] = await db
      .insert(venueImports)
      .values({ csv, ...overrides })
      .returning();
    if (!row) throw new Error('import insert returned no row');
    return row;
  }

  it('starts queued with zero counters and no issues', async () => {
    const row = await insertImport({ createdBy: await createUser({ role: 'admin' }) });
    expect(row).toMatchObject({
      status: 'queued',
      dryRun: false,
      totalRows: null,
      createdRows: 0,
      skippedRows: 0,
      rejectedRows: 0,
      issues: [],
      failureReason: null,
      completedAt: null,
    });
  });

  it('keeps the import when its creator is deleted', async () => {
    const adminId = await createUser({ role: 'admin' });
    const row = await insertImport({ createdBy: adminId });
    await db.delete(users).where(eq(users.id, adminId));
    const [after] = await db.select().from(venueImports).where(eq(venueImports.id, row.id));
    expect(after?.createdBy).toBeNull();
  });

  it('accepts a completed run with issues and a failed run with a reason', async () => {
    const completed = await insertImport({
      status: 'completed',
      completedAt: new Date(),
      totalRows: 3,
      createdRows: 1,
      skippedRows: 1,
      rejectedRows: 1,
      issues: [{ line: 4, column: 'latitude', issue: 'too_big' }],
    });
    expect(completed.issues).toEqual([{ line: 4, column: 'latitude', issue: 'too_big' }]);
    await insertImport({
      status: 'failed',
      completedAt: new Date(),
      failureReason: 'csv_unparsable',
    });
  });

  it('enforces the state, counter, size and dry-run rules', async () => {
    await expectPgError(
      insertImport({ status: 'completed' }),
      PG_CHECK_VIOLATION,
      'venue_imports_completed_state',
    );
    await expectPgError(
      insertImport({ completedAt: new Date() }),
      PG_CHECK_VIOLATION,
      'venue_imports_completed_state',
    );
    await expectPgError(
      insertImport({ status: 'failed', completedAt: new Date() }),
      PG_CHECK_VIOLATION,
      'venue_imports_failure_reason',
    );
    await expectPgError(
      insertImport({ failureReason: 'oops' }),
      PG_CHECK_VIOLATION,
      'venue_imports_failure_reason',
    );
    await expectPgError(
      insertImport({ createdRows: -1 }),
      PG_CHECK_VIOLATION,
      'venue_imports_counters',
    );
    await expectPgError(
      insertImport({ totalRows: 5001 }),
      PG_CHECK_VIOLATION,
      'venue_imports_counters',
    );
    await expectPgError(insertImport({ csv: '' }), PG_CHECK_VIOLATION, 'venue_imports_csv_length');
    await expectPgError(
      insertImport({ csv: 'x'.repeat(900_001) }),
      PG_CHECK_VIOLATION,
      'venue_imports_csv_length',
    );
    await insertImport({ csv: 'x'.repeat(900_000) });
    await expectPgError(
      insertImport({ dryRun: true, createdRows: 1 }),
      PG_CHECK_VIOLATION,
      'venue_imports_dry_run_creates_nothing',
    );
    await expectPgError(
      insertImport({
        issues: Array.from({ length: 51 }, (_, i) => ({ line: i + 1, column: null, issue: 'x' })),
      }),
      PG_CHECK_VIOLATION,
      'venue_imports_issues',
    );
  });

  it('gives the web role insert and read, the worker read and update, and neither a delete', async () => {
    const row = await asRole('kadro_app', async (tx) => {
      const [created] = await tx.insert(venueImports).values({ csv }).returning();
      if (!created) throw new Error('no row');
      return created;
    });
    await asRole('kadro_worker', (tx) =>
      tx
        .update(venueImports)
        .set({ status: 'processing', startedAt: new Date() })
        .where(eq(venueImports.id, row.id)),
    );
    const [seen] = await asRole('kadro_app', (tx) =>
      tx.select().from(venueImports).where(eq(venueImports.id, row.id)),
    );
    expect(seen?.status).toBe('processing');
    await expectPgError(
      asRole('kadro_app', (tx) =>
        tx.update(venueImports).set({ status: 'failed' }).where(eq(venueImports.id, row.id)),
      ),
      PG_INSUFFICIENT_PRIVILEGE,
    );
    for (const column of ['csv', 'dry_run', 'created_by'] as const) {
      const { rows } = await db.execute<{ allowed: boolean }>(
        sql`select has_column_privilege('kadro_worker', 'venue_imports', ${column}, 'UPDATE') as allowed`,
      );
      expect(rows[0]?.allowed, column).toBe(false);
    }
    await expectPgError(
      asRole('kadro_worker', (tx) =>
        tx.update(venueImports).set({ csv: 'other' }).where(eq(venueImports.id, row.id)),
      ),
      PG_INSUFFICIENT_PRIVILEGE,
    );
    for (const role of ['kadro_app', 'kadro_worker'] as const) {
      await expectPgError(
        asRole(role, (tx) => tx.delete(venueImports).where(eq(venueImports.id, row.id))),
        PG_INSUFFICIENT_PRIVILEGE,
      );
    }
  });

  it('lists the open imports through the partial index (queued and processing only)', async () => {
    const { rows } = await db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where indexname = 'venue_imports_open_idx'`,
    );
    expect(rows[0]?.indexdef).toContain("'queued'");
  });
});
