import { type SQL, sql } from 'drizzle-orm';
import { type AnyPgColumn, char, check, timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

/** Time-ordered UUIDv7 generated in the application. Ids are not secrets (see authorization matrix §5). */
export function newId(): string {
  return uuidv7();
}

export function primaryId() {
  return uuid('id').primaryKey().$defaultFn(newId);
}

export function timestamptz(name: string) {
  return timestamp(name, { withTimezone: true, mode: 'date' });
}

/**
 * Lowercase hex SHA-256 digest (64 characters). Secrets such as refresh tokens, email tokens and
 * invite codes are stored only in this form; the plaintext never reaches the database.
 */
export function sha256Hex(name: string) {
  return char(name, { length: 64 });
}

export function sha256HexCheck(name: string, column: AnyPgColumn) {
  return check(name, sql`${column} ~ '^[0-9a-f]{64}$'`);
}

/** Case-insensitive key expression for unique indexes on user-entered text such as email. */
export function lowerExpr(column: AnyPgColumn): SQL {
  return sql`lower(${column})`;
}

/** `created_at` / `updated_at` pair shared by every table. */
export function timestamps() {
  return {
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  };
}
