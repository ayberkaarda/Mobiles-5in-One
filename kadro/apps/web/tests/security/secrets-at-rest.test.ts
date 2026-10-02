import { hashToken } from '@kadro/auth';
import { mobileRefreshResponseSchema, webRefreshResponseSchema } from '@kadro/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as forgot } from '../../app/api/v1/auth/forgot/route';
import { POST as login } from '../../app/api/v1/auth/login/route';
import { POST as refresh } from '../../app/api/v1/auth/refresh/route';
import { POST as register } from '../../app/api/v1/auth/register/route';
import { POST as reset } from '../../app/api/v1/auth/reset/route';
import { POST as verifyEmail } from '../../app/api/v1/auth/verify-email/route';
import {
  type AuthHarness,
  mobile,
  mobileLogin,
  newPassword,
  parseSetCookies,
  post,
  setupAuthHarness,
  uniqueEmail,
  web,
} from '../auth/support';

/**
 * Security checklist item 11, "DB dump shows only `$argon2id$` hashes". Runs the real auth flows
 * (register, verify, wrong and correct login, mobile and web sessions, rotation, forgot, reset,
 * login with the new password), collecting every password and token the server handed out or
 * received. It then dumps every row of every table and asserts that:
 *
 * - `users.password_hash` holds only Argon2id PHC strings with the spec parameters
 *   (m = 65536 KiB, t = 3, p = 1);
 * - `token_hash` columns hold only 64-character lowercase hex SHA-256 digests, and each issued
 *   token is stored as exactly that digest;
 * - no plain password, token, session cookie or CSRF value appears in any column of any table.
 *
 * The constant-work proof for login (same Argon2id verification for unknown, social-only and
 * wrong-password attempts) is `tests/auth/login-races.test.ts`, "login does the same work for
 * every failure"; it uses a spy instead of wall-clock timing.
 */

const ARGON2ID_PHC = /^\$argon2id\$v=19\$m=65536,t=3,p=1\$[A-Za-z0-9+/]{16,}\$[A-Za-z0-9+/]{32,}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

let auth: AuthHarness;

beforeAll(async () => {
  auth = await setupAuthHarness('web_security_at_rest', { RATE_LIMIT_AUTH_MAX: '100' });
});

afterAll(async () => {
  await auth.database.dispose();
});

interface Collected {
  /** Stored in clear by design; the positive control of the dump. */
  readonly email: string;
  readonly passwords: string[];
  /** Opaque tokens the server stores hashed (refresh tokens, web sessions, email tokens). */
  readonly hashedTokens: string[];
  /** Values that must never be stored at all (access JWTs, CSRF tokens). */
  readonly unstored: string[];
}

async function runFlows(): Promise<Collected> {
  const email = uniqueEmail();
  const collected: Collected = { email, passwords: [], hashedTokens: [], unstored: [] };
  const password = newPassword();
  collected.passwords.push(password);

  expect(
    (await post(register, mobile(), { email, password, displayName: 'Kayit Oyuncu' })).status,
  ).toBe(202);
  await auth.drain();
  const verifyToken = auth.mail.tokenFor(email, 'verify_email');
  collected.hashedTokens.push(verifyToken);
  expect((await post(verifyEmail, mobile(), { token: verifyToken })).status).toBe(204);

  const wrong = newPassword();
  collected.passwords.push(wrong);
  expect((await post(login, mobile(), { email, password: wrong })).status).toBe(401);

  const phone = await mobileLogin(login, email, password);
  collected.hashedTokens.push(phone.tokens.refreshToken);
  collected.unstored.push(phone.tokens.accessToken);
  const rotated = await post(refresh, mobile(), { refreshToken: phone.tokens.refreshToken });
  expect(rotated.status).toBe(200);
  const next = mobileRefreshResponseSchema.parse(await rotated.json());
  collected.hashedTokens.push(next.tokens.refreshToken);
  collected.unstored.push(next.tokens.accessToken);

  const signedIn = await post(login, web(), { email, password });
  expect(signedIn.status).toBe(200);
  const cookies = parseSetCookies(signedIn);
  const session = cookies.get(auth.harness.env.SESSION_COOKIE_NAME)?.value ?? '';
  const csrf = cookies.get(auth.harness.env.CSRF_COOKIE_NAME)?.value ?? '';
  collected.hashedTokens.push(session);
  collected.unstored.push(csrf);
  const cookie = `${auth.harness.env.SESSION_COOKIE_NAME}=${session}; ${auth.harness.env.CSRF_COOKIE_NAME}=${csrf}`;
  const webRotated = await post(refresh, web(undefined, { cookie, 'x-csrf-token': csrf }), {});
  expect(webRotated.status).toBe(200);
  const webNext = webRefreshResponseSchema.parse(await webRotated.json());
  collected.hashedTokens.push(
    parseSetCookies(webRotated).get(auth.harness.env.SESSION_COOKIE_NAME)?.value ?? '',
  );
  collected.unstored.push(webNext.csrfToken);

  expect((await post(forgot, mobile(), { email })).status).toBe(202);
  await auth.drain();
  const resetToken = auth.mail.tokenFor(email, 'password_reset');
  collected.hashedTokens.push(resetToken);
  const replacement = newPassword();
  collected.passwords.push(replacement);
  expect((await post(reset, mobile(), { token: resetToken, password: replacement })).status).toBe(
    204,
  );
  const again = await mobileLogin(login, email, replacement);
  collected.hashedTokens.push(again.tokens.refreshToken);
  collected.unstored.push(again.tokens.accessToken);

  for (const value of [...collected.passwords, ...collected.hashedTokens, ...collected.unstored]) {
    expect(value.length, 'every collected value is non-empty').toBeGreaterThanOrEqual(16);
  }
  return collected;
}

interface TableDump {
  readonly table: string;
  readonly rows: string[];
}

/** Every row of every base table outside the system schemas, as JSON text (all columns). */
async function dumpDatabase(): Promise<TableDump[]> {
  const db = auth.database.client.db;
  const tables = await db.execute<{ table_schema: string; table_name: string }>(sql`
    select table_schema, table_name
    from information_schema.tables
    where table_type = 'BASE TABLE'
      and table_schema not in ('pg_catalog', 'information_schema')
    order by table_schema, table_name
  `);
  const dumps: TableDump[] = [];
  for (const { table_schema: schema, table_name: table } of tables.rows) {
    const result = await db.execute<{ row: string }>(
      sql`select row_to_json(t)::text as row from ${sql.identifier(schema)}.${sql.identifier(table)} t`,
    );
    dumps.push({ table: `${schema}.${table}`, rows: result.rows.map((entry) => entry.row) });
  }
  return dumps;
}

async function columnValues(table: string, column: string): Promise<(string | null)[]> {
  const result = await auth.database.client.db.execute<{ value: string | null }>(
    sql`select ${sql.identifier(column)} as value from ${sql.identifier(table)}`,
  );
  return result.rows.map((entry) => entry.value);
}

describe('secrets at rest after the real auth flows (§6 item 11)', () => {
  let collected: Collected;
  let dump: TableDump[];

  beforeAll(async () => {
    collected = await runFlows();
    dump = await dumpDatabase();
  });

  it('stores password hashes only as Argon2id with the spec parameters', async () => {
    const hashes = (await columnValues('users', 'password_hash')).filter(
      (value): value is string => value !== null,
    );
    expect(hashes.length).toBeGreaterThan(0);
    for (const hash of hashes) {
      expect(hash).toMatch(ARGON2ID_PHC);
    }
  });

  it('stores refresh, session and email tokens only as SHA-256 hex digests', async () => {
    const stored = new Set<string>();
    for (const table of ['refresh_tokens', 'email_tokens']) {
      const values = await columnValues(table, 'token_hash');
      expect(values.length, table).toBeGreaterThan(0);
      for (const value of values) {
        expect(value, table).toMatch(SHA256_HEX);
        stored.add(value ?? '');
      }
    }
    for (const token of collected.hashedTokens) {
      expect(stored.has(hashToken(token)), 'issued token stored as its SHA-256 digest').toBe(true);
    }
  });

  it('uses only Argon2id or SHA-256 hex in every *_hash column of the schema', async () => {
    const columns = await auth.database.client.db.execute<{
      table_name: string;
      column_name: string;
    }>(sql`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public' and column_name like '%\\_hash'
      order by table_name, column_name
    `);
    expect(columns.rows.map((entry) => `${entry.table_name}.${entry.column_name}`)).toEqual(
      expect.arrayContaining([
        'users.password_hash',
        'refresh_tokens.token_hash',
        'email_tokens.token_hash',
      ]),
    );
    for (const { table_name: table, column_name: column } of columns.rows) {
      for (const value of await columnValues(table, column)) {
        if (value !== null) {
          expect(
            ARGON2ID_PHC.test(value) || SHA256_HEX.test(value),
            `${table}.${column} holds a value that is neither Argon2id nor SHA-256 hex`,
          ).toBe(true);
        }
      }
    }
  });

  it('has no plain password, token, session cookie or CSRF value in any table', () => {
    const tablesWithRows = dump
      .filter((entry) => entry.rows.length > 0)
      .map((entry) => entry.table);
    expect(tablesWithRows).toEqual(
      expect.arrayContaining(['public.users', 'public.refresh_tokens', 'public.email_tokens']),
    );
    // Positive control: the dump really contains column text (the email is stored in clear).
    expect(
      dump.some(
        (entry) =>
          entry.table === 'public.users' && entry.rows.some((row) => row.includes(collected.email)),
      ),
    ).toBe(true);
    const secrets = [...collected.passwords, ...collected.hashedTokens, ...collected.unstored];
    for (const { table, rows } of dump) {
      for (const row of rows) {
        for (const secret of secrets) {
          expect(row.includes(secret), `plain secret found in ${table}`).toBe(false);
        }
      }
    }
  });
});
