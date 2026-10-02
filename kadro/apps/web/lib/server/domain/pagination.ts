import { timingSafeEqual } from 'node:crypto';

import { cursorSchema, LIMITS, type Paginated } from '@kadro/contracts';
import {
  type AnyColumn,
  and,
  asc,
  Column,
  desc,
  is,
  isNull,
  or,
  type SQL,
  sql,
  type Table,
} from 'drizzle-orm';

import { ApiError } from '../errors';
import { type KeyedHasher } from '../keyed-hash';
import { validationError } from '../validate';

/**
 * Keyset (cursor) pagination for list endpoints (ADR-0039). Never `OFFSET`.
 *
 * A list declares its fixed sort once with {@link defineKeyset}; the last key must be a unique,
 * non-null tie-breaker (usually `id`). A request opens a {@link Page} from `cursor`, `limit` and
 * the filter set of the query:
 *
 * ```ts
 * const page = openPage(APPLICATIONS, { cursor, limit, filters: { callId, status } }, runtime.keyedHash);
 * const rows = await db
 *   .select({ id: apps.id, pageKey: page.key })
 *   .from(apps)
 *   .where(and(scope, page.where))
 *   .orderBy(...page.orderBy)
 *   .limit(page.fetchSize);
 * return json(page.finish(rows, toItem));
 * ```
 *
 * Cursor format: base64url JSON `{ v: 1, s: [sort key values], f: tag }`. The sort key values are
 * read by the database as text (`pageKey`), so timestamps keep their microsecond precision and
 * rows sharing a `created_at` are neither repeated nor skipped. `f` is an HMAC-SHA256 tag (key
 * derived from `HASH_SECRET`, purpose `page-cursor`) over the list name, the canonical filter set
 * and the sort key values: a cursor that was altered, built by hand, issued for another list or
 * reused with different filters is rejected with 400 `invalid_cursor`.
 *
 * Long text keys (for example a folded non-Latin venue name) could push the cursor past the
 * 512-character contract limit. Such a cursor is issued in reference form `{ v: 1, r: id, f }`
 * instead: it carries only the tie-breaker id (same HMAC), and the next page reads the sort key
 * values of that row with scalar subqueries. This needs every key to be a non-null column of one
 * plain (non-aliased) table ending in a `uuid` id; a list that cannot reference its rows answers
 * 400 `invalid_cursor` instead of failing. If the referenced row is deleted between two requests,
 * the next page is empty and the list ends there.
 */

export type KeysetKeyType = 'timestamp' | 'uuid' | 'text' | 'integer';
export type SortDirection = 'asc' | 'desc';

export interface KeysetKey {
  /** Column (or SQL expression) the list is sorted by. */
  readonly column: AnyColumn | SQL;
  readonly type: KeysetKeyType;
  /** Defaults to `asc`. */
  readonly direction?: SortDirection;
  /** Nullable keys sort `NULLS LAST` in both directions. The last key must not be nullable. */
  readonly nullable?: boolean;
}

export interface Keyset {
  /** Stable list name; a cursor is valid only for the list that issued it. */
  readonly list: string;
  readonly keys: readonly KeysetKey[];
}

/** Values that identify the result set of a list request (path ids, query filters). */
export type FilterValue = string | number | boolean | null | undefined;
export type PageFilters = Readonly<Record<string, FilterValue>>;

export interface PageInput {
  readonly cursor?: string | undefined;
  /** Page size, 1..100; defaults to 20. */
  readonly limit?: number | undefined;
  /** Every query parameter and path id that shapes the result set; `undefined` equals `null`. */
  readonly filters?: PageFilters;
}

/** Rows fetched for a page must carry the sort key values selected through {@link Page.key}. */
export interface PageKeyed {
  readonly pageKey: readonly (string | null)[];
}

export interface Page {
  readonly limit: number;
  /** `limit + 1`: the extra row tells whether a next page exists. */
  readonly fetchSize: number;
  /** Keyset condition for rows after the cursor; `undefined` on the first page. */
  readonly where: SQL | undefined;
  /** `ORDER BY` terms of the keyset, in order. */
  readonly orderBy: readonly SQL[];
  /** Select this expression as `pageKey`; it returns the sort key values as text. */
  readonly key: SQL<(string | null)[]>;
  /** Cuts the fetched rows to `limit` and issues `nextCursor` when more rows exist. */
  finish<Row extends PageKeyed, Item>(
    rows: readonly Row[],
    toItem: (row: Row) => Item,
  ): Paginated<Item>;
}

const CURSOR_VERSION = 1;
const MAX_KEYS = 4;
const TAG_HEX_LENGTH = 32;
const MAX_TEXT_KEY_LENGTH = 512;
/** `to_char` pattern: UTC, microseconds, as produced and parsed by PostgreSQL. */
const TIMESTAMP_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
const TIMESTAMP_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INTEGER_TEXT = /^-?\d{1,19}$/;
const LIST_NAME = /^[a-z][a-z0-9._-]{0,63}$/;
const TAG_TEXT = /^[0-9a-f]{32}$/;

/** The table and id column a reference cursor points into, when the keyset allows one. */
interface RowReference {
  readonly table: Table;
  readonly id: AnyColumn;
}

/** Marker drizzle sets on `alias()` tables; a reference subquery needs the plain table. */
const DRIZZLE_IS_ALIAS = Symbol.for('drizzle:IsAlias');

const REFERENCES = new WeakMap<Keyset, RowReference | null>();

function rowReference(keys: readonly KeysetKey[]): RowReference | null {
  const last = keys.at(-1);
  if (last === undefined || last.type !== 'uuid' || !is(last.column, Column)) {
    return null;
  }
  const table = last.column.table;
  const aliased = Reflect.get(table, DRIZZLE_IS_ALIAS) === true;
  const sameTable = keys.every(
    (key) => key.nullable !== true && is(key.column, Column) && key.column.table === table,
  );
  return aliased || !sameTable ? null : { table, id: last.column };
}

/** Position after which the next page starts: sort key values, or a reference to a row. */
type CursorPosition =
  | { readonly kind: 'values'; readonly values: readonly (string | null)[] }
  | { readonly kind: 'reference'; readonly id: string };

/** Declares the fixed sort of a list. Throws on a definition that cannot paginate correctly. */
export function defineKeyset(list: string, keys: readonly KeysetKey[]): Keyset {
  if (!LIST_NAME.test(list)) {
    throw new RangeError(`invalid keyset list name "${list}"`);
  }
  const last = keys.at(-1);
  if (last === undefined || keys.length > MAX_KEYS) {
    throw new RangeError(`keyset "${list}" needs 1..${MAX_KEYS} keys`);
  }
  if (last.nullable === true) {
    throw new RangeError(`keyset "${list}" must end with a non-null unique tie-breaker`);
  }
  const keyset: Keyset = Object.freeze({ list, keys: Object.freeze([...keys]) });
  REFERENCES.set(keyset, rowReference(keys));
  return keyset;
}

/** Page size from an already parsed query: absent → 20, otherwise an integer in 1..100. */
export function resolvePageLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return LIMITS.pageSize.default;
  }
  if (!Number.isInteger(limit) || limit < LIMITS.pageSize.min || limit > LIMITS.pageSize.max) {
    throw validationError('query', 'out_of_range', 'limit');
  }
  return limit;
}

function invalidCursor(): ApiError {
  return new ApiError('invalid_cursor');
}

function canonicalFilters(filters: PageFilters): [string, string | number | boolean | null][] {
  return Object.entries(filters)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new RangeError(`page filter "${name}" must be a finite number`);
      }
      return [name, value ?? null];
    });
}

function cursorTag(
  keyedHash: KeyedHasher,
  keyset: Keyset,
  filters: string,
  position: CursorPosition,
): string {
  const at = position.kind === 'values' ? position.values : { r: position.id };
  const material = JSON.stringify([CURSOR_VERSION, keyset.list, filters, at]);
  return keyedHash('page-cursor', material).slice(0, TAG_HEX_LENGTH);
}

function validKeyText(key: KeysetKey, value: unknown): boolean {
  if (value === null) {
    return key.nullable === true;
  }
  if (typeof value !== 'string') {
    return false;
  }
  switch (key.type) {
    case 'timestamp':
      return TIMESTAMP_TEXT.test(value);
    case 'uuid':
      return UUID_TEXT.test(value);
    case 'integer':
      return INTEGER_TEXT.test(value);
    case 'text':
      return value.length <= MAX_TEXT_KEY_LENGTH;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeCursor(
  keyset: Keyset,
  cursor: string,
  filters: string,
  keyedHash: KeyedHasher,
): CursorPosition {
  if (!cursorSchema.safeParse(cursor).success) {
    throw invalidCursor();
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  if (!isRecord(payload)) {
    throw invalidCursor();
  }
  const fields = Object.keys(payload).sort().join(',');
  const { v, s, r, f } = payload;
  if (v !== CURSOR_VERSION || typeof f !== 'string' || !TAG_TEXT.test(f)) {
    throw invalidCursor();
  }
  let position: CursorPosition;
  if (fields === 'f,r,v') {
    if (!REFERENCES.get(keyset) || typeof r !== 'string' || !UUID_TEXT.test(r)) {
      throw invalidCursor();
    }
    position = { kind: 'reference', id: r };
  } else if (fields === 'f,s,v' && Array.isArray(s) && s.length === keyset.keys.length) {
    const values: (string | null)[] = [];
    for (const [index, key] of keyset.keys.entries()) {
      const value: unknown = s.at(index);
      if (!validKeyText(key, value)) {
        throw invalidCursor();
      }
      values.push(value as string | null);
    }
    position = { kind: 'values', values };
  } else {
    throw invalidCursor();
  }
  const expected = Buffer.from(cursorTag(keyedHash, keyset, filters, position), 'hex');
  if (!timingSafeEqual(Buffer.from(f, 'hex'), expected)) {
    throw invalidCursor();
  }
  return position;
}

function encodeCursor(
  keyset: Keyset,
  filters: string,
  values: readonly (string | null)[],
  keyedHash: KeyedHasher,
): string {
  const encode = (position: CursorPosition): string => {
    const at = position.kind === 'values' ? { s: position.values } : { r: position.id };
    const payload = {
      v: CURSOR_VERSION,
      ...at,
      f: cursorTag(keyedHash, keyset, filters, position),
    };
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  };
  const cursor = encode({ kind: 'values', values });
  if (cursor.length <= LIMITS.cursor.max) {
    return cursor;
  }
  const id = values.at(-1);
  if (!REFERENCES.get(keyset) || typeof id !== 'string' || !UUID_TEXT.test(id)) {
    // The list cannot shorten its cursor (see the module comment): a client error, never a 500.
    throw invalidCursor();
  }
  return encode({ kind: 'reference', id });
}

/** The cursor value bound with the type of its key column. */
function bound(key: KeysetKey, value: string): SQL {
  switch (key.type) {
    case 'timestamp':
      return sql`${value}::timestamptz`;
    case 'uuid':
      return sql`${value}::uuid`;
    case 'integer':
      return sql`${value}::bigint`;
    case 'text':
      return sql`${value}::text`;
  }
}

/**
 * Right-hand side per key: the bound cursor value, `null` for a null sort value, or (reference
 * form) a scalar subquery reading that key from the referenced row.
 */
function operands(keyset: Keyset, position: CursorPosition): (SQL | null)[] {
  if (position.kind === 'values') {
    return keyset.keys.map((key, index) => {
      const value = position.values.at(index) ?? null;
      return value === null ? null : bound(key, value);
    });
  }
  const reference = REFERENCES.get(keyset);
  if (!reference) {
    throw invalidCursor();
  }
  return keyset.keys.map(
    (key) =>
      sql`(select ${key.column} from ${reference.table} where ${reference.id} = ${position.id}::uuid)`,
  );
}

/** Rows strictly after `operand` on this key alone (nulls sort last). */
function afterOnKey(key: KeysetKey, operand: SQL | null): SQL {
  if (operand === null) {
    return sql`false`;
  }
  const strict =
    key.direction === 'desc' ? sql`${key.column} < ${operand}` : sql`${key.column} > ${operand}`;
  return key.nullable === true ? sql`(${strict} or ${key.column} is null)` : strict;
}

function equalOnKey(key: KeysetKey, operand: SQL | null): SQL {
  return operand === null ? isNull(key.column) : sql`${key.column} = ${operand}`;
}

/**
 * Condition selecting the rows after `position` in keyset order. Uniform non-null keys use a row
 * comparison, which PostgreSQL turns into one index range scan.
 */
function keysetCondition(keyset: Keyset, position: CursorPosition): SQL {
  const rhs = operands(keyset, position);
  const pairs = keyset.keys.map((key, index) => ({ key, operand: rhs.at(index) ?? null }));
  const direction = keyset.keys[0]?.direction ?? 'asc';
  const uniform = pairs.every(
    ({ key, operand }) =>
      key.nullable !== true && operand !== null && (key.direction ?? 'asc') === direction,
  );
  if (uniform) {
    const columns = sql.join(
      pairs.map(({ key }) => sql`${key.column}`),
      sql`, `,
    );
    const params = sql.join(
      pairs.map(({ operand }) => operand ?? sql`null`),
      sql`, `,
    );
    return direction === 'desc' ? sql`(${columns}) < (${params})` : sql`(${columns}) > (${params})`;
  }
  let condition: SQL | undefined;
  for (const { key, operand } of pairs.reverse()) {
    const after = afterOnKey(key, operand);
    condition =
      condition === undefined ? after : or(after, and(equalOnKey(key, operand), condition));
  }
  return condition ?? sql`false`;
}

function keysetOrderBy(keyset: Keyset): SQL[] {
  return keyset.keys.map((key) => {
    if (key.nullable === true) {
      return key.direction === 'desc'
        ? sql`${key.column} desc nulls last`
        : sql`${key.column} asc nulls last`;
    }
    return key.direction === 'desc' ? desc(key.column) : asc(key.column);
  });
}

/** `text[]` of the sort key values, exactly as the keyset condition compares them. */
function keysetKeyExpression(keyset: Keyset): SQL<(string | null)[]> {
  const parts = keyset.keys.map((key) =>
    key.type === 'timestamp'
      ? sql`to_char(${key.column} at time zone 'UTC', ${TIMESTAMP_FORMAT})`
      : sql`(${key.column})::text`,
  );
  return sql<(string | null)[]>`array[${sql.join(parts, sql`, `)}]::text[]`;
}

function rowKey(keyset: Keyset, row: PageKeyed): (string | null)[] {
  const values: unknown = row.pageKey;
  if (
    !Array.isArray(values) ||
    values.length !== keyset.keys.length ||
    !values.every((value) => value === null || typeof value === 'string')
  ) {
    throw new TypeError(`rows of list "${keyset.list}" must select page.key as pageKey`);
  }
  return values as (string | null)[];
}

/**
 * Opens one page of `keyset`: validates `limit` (400 `validation_failed`) and `cursor`
 * (400 `invalid_cursor`) against the filter set of this request.
 */
export function openPage(keyset: Keyset, input: PageInput, keyedHash: KeyedHasher): Page {
  const limit = resolvePageLimit(input.limit);
  const filters = JSON.stringify(canonicalFilters(input.filters ?? {}));
  const after =
    input.cursor === undefined ? null : decodeCursor(keyset, input.cursor, filters, keyedHash);
  return {
    limit,
    fetchSize: limit + 1,
    where: after === null ? undefined : keysetCondition(keyset, after),
    orderBy: keysetOrderBy(keyset),
    key: keysetKeyExpression(keyset),
    finish(rows, toItem) {
      const pageRows = rows.slice(0, limit);
      const last = pageRows.at(-1);
      const nextCursor =
        rows.length > limit && last !== undefined
          ? encodeCursor(keyset, filters, rowKey(keyset, last), keyedHash)
          : null;
      return { items: pageRows.map(toItem), nextCursor };
    },
  };
}
