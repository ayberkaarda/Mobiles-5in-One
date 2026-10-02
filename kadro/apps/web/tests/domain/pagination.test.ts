import { randomBytes, randomUUID } from 'node:crypto';

import { cursorSchema } from '@kadro/contracts';
import { users } from '@kadro/db';
import { and, eq, like, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  defineKeyset,
  type Keyset,
  openPage,
  type PageFilters,
  resolvePageLimit,
} from '../../lib/server/domain/pagination';
import { ApiError } from '../../lib/server/errors';
import { createKeyedHasher, type KeyedHasher } from '../../lib/server/keyed-hash';
import { createMigratedDatabase, type TestDatabase } from '../support/db';

let database: TestDatabase;
const hasher: KeyedHasher = createKeyedHasher(randomBytes(32).toString('base64url'));
const otherHasher: KeyedHasher = createKeyedHasher(randomBytes(32).toString('base64url'));

/** Sort keys exercised below; `users` is used as a convenient table with typed columns. */
const BY_CREATED = defineKeyset('test.created', [
  { column: users.createdAt, type: 'timestamp' },
  { column: users.id, type: 'uuid' },
]);
const BY_CREATED_DESC = defineKeyset('test.created-desc', [
  { column: users.createdAt, type: 'timestamp', direction: 'desc' },
  { column: users.id, type: 'uuid', direction: 'desc' },
]);
const BY_VERIFIED_NULLABLE = defineKeyset('test.verified', [
  { column: users.emailVerifiedAt, type: 'timestamp', nullable: true },
  { column: users.id, type: 'uuid' },
]);
const BY_VERIFIED_DESC_NULLABLE = defineKeyset('test.verified-desc', [
  { column: users.emailVerifiedAt, type: 'timestamp', direction: 'desc', nullable: true },
  { column: users.id, type: 'uuid' },
]);
const BY_NAME = defineKeyset('test.name', [
  { column: users.displayName, type: 'text' },
  { column: users.id, type: 'uuid' },
]);
const BY_STEP_DESC_NULLABLE = defineKeyset('test.step', [
  { column: users.totpLastUsedStep, type: 'integer', direction: 'desc', nullable: true },
  { column: users.displayName, type: 'text', direction: 'desc' },
  { column: users.id, type: 'uuid' },
]);

const GROUP = `grp${randomBytes(4).toString('hex')}`;
const ROWS = 23;

function inGroup() {
  return like(users.email, `%@${GROUP}.test`);
}

/** Three timestamps that differ only in microseconds, so millisecond rounding would break paging. */
const MICRO_TIMES = [
  '2026-03-01T10:00:00.123456Z',
  '2026-03-01T10:00:00.123457Z',
  '2026-03-01T10:00:00.123999Z',
];

beforeAll(async () => {
  database = await createMigratedDatabase('web_domain_pagination');
  const rows = Array.from({ length: ROWS }, (_, index) => ({
    email: `u${index}-${randomUUID()}@${GROUP}.test`,
    displayName: `Oyuncu ${String(index % 4).padStart(2, '0')}`,
    createdAt: sql`${MICRO_TIMES[index % MICRO_TIMES.length]}::timestamptz`,
    emailVerifiedAt: index % 3 === 0 ? null : sql`${MICRO_TIMES[index % 2]}::timestamptz`,
    totpLastUsedStep: index % 4 === 0 ? null : index % 5,
  }));
  await database.client.db.insert(users).values(rows);
});

afterAll(async () => {
  await database.dispose();
});

async function fetchPage(
  keyset: Keyset,
  cursor: string | undefined,
  limit: number,
  filters: PageFilters = {},
) {
  const page = openPage(keyset, { cursor, limit, filters }, hasher);
  const rows = await database.client.db
    .select({ id: users.id, pageKey: page.key })
    .from(users)
    .where(and(inGroup(), page.where))
    .orderBy(...page.orderBy)
    .limit(page.fetchSize);
  return page.finish(rows, (row) => row.id);
}

async function walk(keyset: Keyset, limit: number): Promise<{ ids: string[]; pages: number }> {
  const ids: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const result = await fetchPage(keyset, cursor, limit);
    pages += 1;
    ids.push(...result.items);
    expect(result.items.length).toBeLessThanOrEqual(limit);
    if (result.nextCursor !== null) {
      expect(cursorSchema.safeParse(result.nextCursor).success).toBe(true);
      expect(result.items).toHaveLength(limit);
    }
    cursor = result.nextCursor ?? undefined;
  } while (cursor !== undefined && pages < 50);
  return { ids, pages };
}

async function fullOrder(keyset: Keyset): Promise<string[]> {
  const result = await fetchPage(keyset, undefined, 100);
  expect(result.nextCursor).toBeNull();
  return result.items;
}

function expectInvalidCursor(fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('invalid_cursor');
    expect((error as ApiError).status).toBe(400);
    return;
  }
  throw new Error('expected 400 invalid_cursor');
}

async function firstCursor(keyset: Keyset, filters: PageFilters = {}): Promise<string> {
  const result = await fetchPage(keyset, undefined, 2, filters);
  if (result.nextCursor === null) {
    throw new Error('expected a next page');
  }
  return result.nextCursor;
}

function decode(cursor: string): { v: number; s: (string | null)[]; f: string } {
  return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
    v: number;
    s: (string | null)[];
    f: string;
  };
}

function encode(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

describe('page limit', () => {
  it('defaults to 20 and accepts 1..100', () => {
    expect(resolvePageLimit(undefined)).toBe(20);
    expect(resolvePageLimit(1)).toBe(1);
    expect(resolvePageLimit(100)).toBe(100);
  });

  it.each([0, -1, 101, 1.5, Number.NaN])('rejects %s with 400 validation_failed', (limit) => {
    expect(() => resolvePageLimit(limit)).toThrow(ApiError);
    try {
      resolvePageLimit(limit);
    } catch (error) {
      expect((error as ApiError).code).toBe('validation_failed');
      expect((error as ApiError).errors).toEqual([{ path: 'query.limit', issue: 'out_of_range' }]);
    }
  });

  it('fetches limit + 1 rows', () => {
    const page = openPage(BY_CREATED, { limit: 5 }, hasher);
    expect(page.limit).toBe(5);
    expect(page.fetchSize).toBe(6);
    expect(page.where).toBeUndefined();
    expect(openPage(BY_CREATED, {}, hasher).limit).toBe(20);
  });
});

describe('keyset definition', () => {
  it('requires a non-null tie-breaker and a valid list name', () => {
    expect(() => defineKeyset('test.bad', [])).toThrow(RangeError);
    expect(() =>
      defineKeyset('test.bad', [
        { column: users.emailVerifiedAt, type: 'timestamp', nullable: true },
      ]),
    ).toThrow(RangeError);
    expect(() => defineKeyset('Bad Name', [{ column: users.id, type: 'uuid' }])).toThrow(
      RangeError,
    );
  });
});

describe('keyset paging over real rows', () => {
  it.each([
    ['created_at asc with microsecond ties', BY_CREATED],
    ['created_at desc', BY_CREATED_DESC],
    ['nullable timestamp asc (nulls last)', BY_VERIFIED_NULLABLE],
    ['nullable timestamp desc (nulls last)', BY_VERIFIED_DESC_NULLABLE],
    ['text key with duplicates', BY_NAME],
    ['nullable integer desc, mixed directions', BY_STEP_DESC_NULLABLE],
  ] as const)('%s: every row exactly once, in order', async (_name, keyset) => {
    const expected = await fullOrder(keyset);
    expect(expected).toHaveLength(ROWS);
    for (const limit of [1, 2, 5, 7, ROWS - 1, ROWS, 100]) {
      const { ids, pages } = await walk(keyset, limit);
      expect(ids).toEqual(expected);
      expect(new Set(ids).size).toBe(ROWS);
      expect(pages).toBe(Math.max(1, Math.ceil(ROWS / limit)));
    }
  });

  it('orders ties on created_at by id and keeps microsecond precision in the cursor', async () => {
    const rows = await database.client.db
      .select({
        id: users.id,
        at: sql<string>`to_char(${users.createdAt} at time zone 'UTC', 'US')`,
      })
      .from(users)
      .where(inGroup());
    const expected = [...rows]
      .sort((a, b) => (a.at === b.at ? (a.id < b.id ? -1 : 1) : a.at < b.at ? -1 : 1))
      .map((row) => row.id);
    expect(await fullOrder(BY_CREATED)).toEqual(expected);
    const cursor = await firstCursor(BY_CREATED);
    expect(decode(cursor).s[0]).toMatch(/^2026-03-01T10:00:00\.12345[67]Z$/);
  });

  it('places null sort values after all others in both directions', async () => {
    const asc = await fullOrder(BY_VERIFIED_NULLABLE);
    const desc = await fullOrder(BY_VERIFIED_DESC_NULLABLE);
    const nullIds = new Set(
      (
        await database.client.db
          .select({ id: users.id })
          .from(users)
          .where(and(inGroup(), sql`${users.emailVerifiedAt} is null`))
      ).map((row) => row.id),
    );
    expect(nullIds.size).toBeGreaterThan(0);
    for (const order of [asc, desc]) {
      const tail = order.slice(order.length - nullIds.size);
      expect(new Set(tail)).toEqual(nullIds);
    }
  });

  it('a cursor issued inside the null block continues there', async () => {
    const { ids } = await walk(BY_VERIFIED_NULLABLE, 1);
    expect(ids).toEqual(await fullOrder(BY_VERIFIED_NULLABLE));
  });

  it('returns an empty page with no cursor when nothing matches', async () => {
    const page = openPage(BY_CREATED, { limit: 5 }, hasher);
    const rows = await database.client.db
      .select({ id: users.id, pageKey: page.key })
      .from(users)
      .where(and(eq(users.email, 'nobody@nowhere.test'), page.where))
      .orderBy(...page.orderBy)
      .limit(page.fetchSize);
    expect(page.finish(rows, (row) => row.id)).toEqual({ items: [], nextCursor: null });
  });

  it('refuses rows that did not select page.key', () => {
    const page = openPage(BY_CREATED, { limit: 1 }, hasher);
    const rows = [{ pageKey: ['x'] }, { pageKey: ['y'] }];
    expect(() => page.finish(rows, (row) => row)).toThrow(TypeError);
  });
});

describe('cursor integrity', () => {
  it('round-trips with the same filters (undefined equals null, key order irrelevant)', async () => {
    const filters = { teamId: GROUP, status: null, scope: 'all' };
    const cursor = await firstCursor(BY_CREATED, filters);
    expect(() => openPage(BY_CREATED, { cursor, filters }, hasher)).not.toThrow();
    expect(() =>
      openPage(
        BY_CREATED,
        { cursor, filters: { scope: 'all', status: undefined, teamId: GROUP } },
        hasher,
      ),
    ).not.toThrow();
  });

  it('rejects a cursor reused with different filters', async () => {
    const cursor = await firstCursor(BY_CREATED, { teamId: GROUP, status: null });
    expectInvalidCursor(() =>
      openPage(BY_CREATED, { cursor, filters: { teamId: GROUP, status: 'pending' } }, hasher),
    );
    expectInvalidCursor(() =>
      openPage(BY_CREATED, { cursor, filters: { teamId: randomUUID(), status: null } }, hasher),
    );
    expectInvalidCursor(() => openPage(BY_CREATED, { cursor, filters: { teamId: GROUP } }, hasher));
    expectInvalidCursor(() =>
      openPage(BY_CREATED, { cursor, filters: { teamId: GROUP, status: null, extra: 1 } }, hasher),
    );
  });

  it('rejects a cursor of another list, even with the same key shape', async () => {
    const cursor = await firstCursor(BY_CREATED);
    expectInvalidCursor(() => openPage(BY_CREATED_DESC, { cursor }, hasher));
  });

  it('rejects a cursor signed with another HASH_SECRET', async () => {
    const cursor = await firstCursor(BY_CREATED);
    expectInvalidCursor(() => openPage(BY_CREATED, { cursor }, otherHasher));
  });

  it('rejects altered sort values and tags', async () => {
    const cursor = await firstCursor(BY_CREATED);
    const payload = decode(cursor);
    const shifted = { ...payload, s: ['2020-01-01T00:00:00.000000Z', payload.s[1]] };
    expectInvalidCursor(() => openPage(BY_CREATED, { cursor: encode(shifted) }, hasher));
    const otherId = { ...payload, s: [payload.s[0], randomUUID()] };
    expectInvalidCursor(() => openPage(BY_CREATED, { cursor: encode(otherId) }, hasher));
    const flipped = payload.f.startsWith('0') ? `1${payload.f.slice(1)}` : `0${payload.f.slice(1)}`;
    expectInvalidCursor(() =>
      openPage(BY_CREATED, { cursor: encode({ ...payload, f: flipped }) }, hasher),
    );
  });

  it.each([
    ['not base64url', '***'],
    ['empty', ''],
    ['not JSON', Buffer.from('not json').toString('base64url')],
    ['JSON array', encode([1, [], 'x'])],
    ['JSON null', encode(null)],
    ['unknown version', 'v2'],
    ['extra field', 'extra'],
    ['missing tag', 'notag'],
    ['short tag', 'shorttag'],
    ['wrong key count', 'keys'],
    ['null on a non-null key', 'nullkey'],
    ['number instead of string', 'number'],
    ['millisecond timestamp', 'millis'],
    ['too long', 'A'.repeat(513)],
  ])('rejects a malformed cursor: %s', async (_name, variant) => {
    const payload = decode(await firstCursor(BY_CREATED));
    const variants: Record<string, unknown> = {
      v2: { ...payload, v: 2 },
      extra: { ...payload, x: 1 },
      notag: { v: payload.v, s: payload.s },
      shorttag: { ...payload, f: payload.f.slice(0, 16) },
      keys: { ...payload, s: [payload.s[0]] },
      nullkey: { ...payload, s: [null, payload.s[1]] },
      number: { ...payload, s: [Date.now(), payload.s[1]] },
      millis: { ...payload, s: ['2026-03-01T10:00:00.123Z', payload.s[1]] },
    };
    const cursor = variant in variants ? encode(variants[variant]) : variant;
    expectInvalidCursor(() => openPage(BY_CREATED, { cursor }, hasher));
  });

  it('accepts a null sort value only on a nullable key', async () => {
    const { ids } = await walk(BY_VERIFIED_NULLABLE, 1);
    expect(ids).toHaveLength(ROWS);
  });
});

describe('long text sort keys', () => {
  /** Email local parts of 120 three-byte characters: a verbatim cursor would exceed 512 chars. */
  const LONG_GROUP = `long${randomBytes(4).toString('hex')}`;
  const LONG_ROWS = 7;
  const BY_EMAIL = defineKeyset('test.email', [
    { column: users.email, type: 'text' },
    { column: users.id, type: 'uuid' },
  ]);
  const BY_EMAIL_DESC_MIXED = defineKeyset('test.email-mixed', [
    { column: users.email, type: 'text', direction: 'desc' },
    { column: users.id, type: 'uuid' },
  ]);
  const BY_EMAIL_EXPRESSION = defineKeyset('test.email-expression', [
    { column: sql`${users.email}`, type: 'text' },
    { column: users.id, type: 'uuid' },
  ]);

  function inLongGroup() {
    return like(users.email, `%@${LONG_GROUP}.test`);
  }

  async function longPage(keyset: Keyset, cursor: string | undefined, limit: number) {
    const page = openPage(keyset, { cursor, limit }, hasher);
    const rows = await database.client.db
      .select({ id: users.id, pageKey: page.key })
      .from(users)
      .where(and(inLongGroup(), page.where))
      .orderBy(...page.orderBy)
      .limit(page.fetchSize);
    return page.finish(rows, (row) => row.id);
  }

  async function walkLong(keyset: Keyset): Promise<string[]> {
    const ids: string[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < 50; pages += 1) {
      const result = await longPage(keyset, cursor, 2);
      ids.push(...result.items);
      if (result.nextCursor === null) {
        return ids;
      }
      expect(result.nextCursor.length).toBeLessThanOrEqual(512);
      expect(cursorSchema.safeParse(result.nextCursor).success).toBe(true);
      cursor = result.nextCursor;
    }
    throw new Error('paging did not end');
  }

  beforeAll(async () => {
    await database.client.db.insert(users).values(
      Array.from({ length: LONG_ROWS }, (_, index) => ({
        // Two rows share each local part, so the id tie-breaker matters too.
        email: `${'漢'.repeat(118)}${String.fromCodePoint(0x4e00 + Math.floor(index / 2))}${index}@${LONG_GROUP}.test`,
        displayName: `Uzun ${index}`,
      })),
    );
  });

  it.each([
    ['asc', BY_EMAIL],
    ['desc text, asc id', BY_EMAIL_DESC_MIXED],
  ] as const)(
    '%s: pages every row exactly once with cursors within 512 chars',
    async (_n, keyset) => {
      const expected = (await longPage(keyset, undefined, 100)).items;
      expect(expected).toHaveLength(LONG_ROWS);
      expect(await walkLong(keyset)).toEqual(expected);
    },
  );

  it('rejects an altered reference cursor', async () => {
    const first = await longPage(BY_EMAIL, undefined, 2);
    const payload = decode(first.nextCursor ?? '') as unknown as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['f', 'r', 'v']);
    expectInvalidCursor(() =>
      openPage(BY_EMAIL, { cursor: encode({ ...payload, r: randomUUID() }) }, hasher),
    );
    expectInvalidCursor(() =>
      openPage(BY_EMAIL_DESC_MIXED, { cursor: first.nextCursor ?? '' }, hasher),
    );
  });

  it('a list that cannot reference its rows answers 400 invalid_cursor instead of 500', async () => {
    await expect(longPage(BY_EMAIL_EXPRESSION, undefined, 2)).rejects.toMatchObject({
      code: 'invalid_cursor',
      status: 400,
    });
    const aliased = alias(users, 'aliased_user');
    const BY_ALIAS = defineKeyset('test.email-alias', [
      { column: aliased.email, type: 'text' },
      { column: aliased.id, type: 'uuid' },
    ]);
    const page = openPage(BY_ALIAS, { limit: 1 }, hasher);
    const rows = await database.client.db
      .select({ id: aliased.id, pageKey: page.key })
      .from(aliased)
      .where(like(aliased.email, `%@${LONG_GROUP}.test`))
      .orderBy(...page.orderBy)
      .limit(page.fetchSize);
    expectInvalidCursor(() => page.finish(rows, (row) => row.id));
  });

  it('a reference to a deleted row ends the list instead of repeating rows', async () => {
    const first = await longPage(BY_EMAIL, undefined, 2);
    const [, last] = first.items;
    await database.client.db.delete(users).where(eq(users.id, last ?? ''));
    const next = await longPage(BY_EMAIL, first.nextCursor ?? undefined, 2);
    expect(next).toEqual({ items: [], nextCursor: null });
  });
});
