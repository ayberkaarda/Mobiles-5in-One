import { issueRefreshToken, refreshTtlSeconds } from '@kadro/auth';
import {
  type AuthClient,
  type MeResponse,
  type MobileAuthResponse,
  type TokenPair,
  type WebAuthResponse,
} from '@kadro/contracts';
import { refreshTokens, type Transaction } from '@kadro/db';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { csrfCookie, sessionCookie } from '../cookies';
import { json } from '../http';
import { type ServerRuntime } from '../runtime';
import { type Executor } from './profile';

/**
 * Session issuance and revocation (security checklist item 12, ADR-0014). Mobile and web
 * sessions are both `refresh_tokens` rows; only the hash of the opaque token is stored.
 *
 * - mobile: ES256 access JWT (`sid` = family id) + opaque refresh token, both in the body;
 * - web: the opaque token is the `__Host-` session cookie (HttpOnly) and a CSRF token bound to
 *   the family id is set as the CSRF cookie and returned in the body; no token in the body.
 */

export type IssuedSession =
  | { readonly client: 'mobile'; readonly familyId: string; readonly tokens: TokenPair }
  | {
      readonly client: 'web';
      readonly familyId: string;
      readonly csrfToken: string;
      readonly cookies: readonly string[];
    };

/** Credentials for an already-inserted row: the plaintext token and its family. */
export interface SessionToken {
  readonly token: string;
  readonly familyId: string;
  readonly userId: string;
  readonly expiresAt: Date;
}

export async function credentialsFor(
  runtime: ServerRuntime,
  client: AuthClient,
  session: SessionToken,
): Promise<IssuedSession> {
  if (client === 'mobile') {
    const access = await runtime.accessTokens.issue(
      { userId: session.userId, sessionId: session.familyId },
      runtime.now(),
    );
    return {
      client,
      familyId: session.familyId,
      tokens: {
        tokenType: 'Bearer',
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt.toISOString(),
        refreshToken: session.token,
        refreshTokenExpiresAt: session.expiresAt.toISOString(),
      },
    };
  }
  const ttl = runtime.env.SESSION_TTL_SECONDS;
  const csrfToken = runtime.csrf.issue(session.familyId);
  return {
    client,
    familyId: session.familyId,
    csrfToken,
    cookies: [
      sessionCookie(runtime.env, session.token, ttl),
      csrfCookie(runtime.env, csrfToken, ttl),
    ],
  };
}

/** Starts a new rotation family for a successful sign-in. */
export async function startSession(
  runtime: ServerRuntime,
  db: Executor,
  input: { userId: string; client: AuthClient; deviceLabel?: string | undefined },
): Promise<IssuedSession> {
  const issued = issueRefreshToken({
    userId: input.userId,
    client: input.client,
    ttlSeconds: refreshTtlSeconds(runtime.env, input.client),
    deviceLabel: input.deviceLabel ?? null,
    now: runtime.now(),
  });
  await db.insert(refreshTokens).values(issued.row);
  return credentialsFor(runtime, input.client, {
    token: issued.token,
    familyId: issued.row.familyId,
    userId: input.userId,
    expiresAt: issued.row.expiresAt,
  });
}

export function withCookies(response: Response, cookies: readonly string[]): Response {
  for (const cookie of cookies) {
    response.headers.append('Set-Cookie', cookie);
  }
  return response;
}

/** 200 response of login and provider sign-in, shaped by the client type. */
export function signedInResponse(session: IssuedSession, user: MeResponse): Response {
  if (session.client === 'mobile') {
    const body: MobileAuthResponse = { user, tokens: session.tokens };
    return json(body);
  }
  const body: WebAuthResponse = { user, csrfToken: session.csrfToken };
  return withCookies(json(body), session.cookies);
}

/**
 * Serializes every write to one refresh family for the rest of the transaction: rotation (revoke
 * predecessor, insert successor) and revocation (reuse detection, logout, password reset) take the
 * same transaction-scoped advisory lock first. Under READ COMMITTED each statement after the lock
 * sees every row committed by the previous holder, so a revocation can never miss a successor
 * inserted by a rotation that overlapped it.
 */
export async function lockFamily(tx: Transaction, familyId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`refresh-family:${familyId}`}, 0))`,
  );
}

/**
 * Revokes every unrevoked token of a family (logout, reuse detection) under the family lock.
 * `userId` restricts the update to that user's rows when the family id came from a credential
 * rather than the database.
 */
export async function revokeFamily(
  tx: Transaction,
  familyId: string,
  now: Date,
  userId?: string,
): Promise<number> {
  await lockFamily(tx, familyId);
  const revoked = await tx
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(refreshTokens.familyId, familyId),
        isNull(refreshTokens.revokedAt),
        userId === undefined ? undefined : eq(refreshTokens.userId, userId),
      ),
    )
    .returning({ id: refreshTokens.id });
  return revoked.length;
}

/**
 * Revokes every session of a user, mobile and web (password reset). The user's families are
 * locked in a fixed (sorted) order before the update, so a rotation in flight either commits
 * first and its successor is revoked here, or starts after this transaction and finds its
 * predecessor revoked.
 */
export async function revokeAllSessions(
  tx: Transaction,
  userId: string,
  now: Date,
): Promise<number> {
  const families = await tx
    .selectDistinct({ familyId: refreshTokens.familyId })
    .from(refreshTokens)
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  for (const familyId of families.map((row) => row.familyId).sort()) {
    await lockFamily(tx, familyId);
  }
  const revoked = await tx
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id });
  return revoked.length;
}
