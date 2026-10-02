import { evaluateRefresh, hashToken, refreshTtlSeconds } from '@kadro/auth';
import {
  type AuthClient,
  type MobileRefreshResponse,
  opaqueTokenSchema,
  type WebRefreshResponse,
} from '@kadro/contracts';
import { refreshTokens, users } from '@kadro/db';
import { and, eq, isNull } from 'drizzle-orm';

import { recordAudit } from '../audit';
import { assertCsrf } from '../authorize';
import { readCookie } from '../cookies';
import { ApiError } from '../errors';
import { json } from '../http';
import { type Logger } from '../logging';
import { type ServerRuntime } from '../runtime';
import { credentialsFor, lockFamily, revokeFamily, withCookies } from './sessions';

/**
 * `POST auth/refresh` (security checklist item 12; ADR-0014, ADR-0019; matrix §3.1 footnote 1).
 *
 * The decision comes from `evaluateRefresh` of `@kadro/auth`; this module performs the writes
 * of its protocol. Rotation is atomic in the database: the presented row is revoked with
 * `UPDATE ... WHERE id = $id AND revoked_at IS NULL RETURNING id`. PostgreSQL serializes two
 * concurrent updates of the same row, so exactly one request sees one changed row and inserts the
 * successor; the other sees zero rows, which is handled exactly like reuse: the whole family,
 * including the winner's new token, is revoked in the same transaction and the request gets 401.
 * A token presented over the other client's transport is rejected without touching the family.
 */

export interface RefreshContext {
  readonly runtime: ServerRuntime;
  readonly client: AuthClient;
  readonly request: Request;
  readonly ip: string | null;
  readonly logger: Logger;
}

function unauthenticated(): ApiError {
  return new ApiError('unauthenticated');
}

/** The presented opaque token: body for mobile, session cookie for web. */
export function presentedRefreshToken(
  runtime: ServerRuntime,
  client: AuthClient,
  request: Request,
  body: { refreshToken?: string },
): string {
  if (client === 'mobile') {
    if (body.refreshToken === undefined) {
      throw unauthenticated();
    }
    return body.refreshToken;
  }
  const lookup = readCookie(request.headers.get('cookie'), runtime.env.SESSION_COOKIE_NAME);
  if (lookup.kind !== 'present') {
    throw unauthenticated();
  }
  const parsed = opaqueTokenSchema.safeParse(lookup.value);
  if (!parsed.success) {
    throw unauthenticated();
  }
  return parsed.data;
}

export async function refreshSession(context: RefreshContext, token: string): Promise<Response> {
  const { runtime, client } = context;
  const now = runtime.now();
  const [stored] = await runtime.db
    .select({
      id: refreshTokens.id,
      userId: refreshTokens.userId,
      client: refreshTokens.client,
      familyId: refreshTokens.familyId,
      deviceLabel: refreshTokens.deviceLabel,
      expiresAt: refreshTokens.expiresAt,
      revokedAt: refreshTokens.revokedAt,
      stepUpUntil: refreshTokens.stepUpUntil,
    })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashToken(token)))
    .limit(1);

  const verdict = evaluateRefresh(stored ?? null, {
    client,
    ttlSeconds: refreshTtlSeconds(runtime.env, client),
    now,
  });
  if (verdict.kind === 'reject') {
    context.logger.info({ event: 'refresh_rejected', reason: verdict.reason }, 'refresh rejected');
    throw unauthenticated();
  }

  // Web: the cookie is consumed here, so the CSRF pair is checked against its family.
  if (client === 'web') {
    assertCsrf(runtime, context.request, verdict.familyId);
  }

  const revokeOnReuse = async (): Promise<void> => {
    await runtime.db.transaction(async (tx) => {
      const revoked = await revokeFamily(tx, verdict.familyId, now);
      await recordAudit(tx, runtime.keyedHash, {
        actorId: verdict.userId,
        action: 'auth.refreshReuse',
        targetType: 'session',
        targetId: verdict.familyId,
        ip: context.ip,
        metadata: { client, revokedSessions: revoked },
      });
    });
    context.logger.warn({ event: 'refresh_reuse_detected', client }, 'refresh token reuse');
  };

  // Reuse is handled before the rate limit: a limited family must still be revoked.
  if (verdict.kind === 'reuse') {
    await revokeOnReuse();
    throw unauthenticated();
  }

  // Group R: per refresh family, for rotations only.
  const limit = await runtime.limiter.hit(`refresh:family:${verdict.familyId}`, {
    max: runtime.env.RATE_LIMIT_REFRESH_MAX,
    windowSeconds: runtime.env.RATE_LIMIT_REFRESH_WINDOW_SECONDS,
  });
  if (!limit.allowed) {
    throw new ApiError('rate_limited', {
      headers: { 'Retry-After': String(limit.retryAfterSeconds) },
    });
  }

  // ADR-0012: a deactivated account gets no new credentials; its family is closed.
  const [user] = await runtime.db
    .select({ deactivatedAt: users.deactivatedAt })
    .from(users)
    .where(eq(users.id, verdict.userId))
    .limit(1);
  if (user === undefined) {
    throw unauthenticated();
  }
  if (user.deactivatedAt !== null) {
    await runtime.db.transaction((tx) => revokeFamily(tx, verdict.familyId, now));
    throw new ApiError('account_deactivated');
  }

  // Rotation holds the family lock: a concurrent revocation of the family waits for it and
  // then sees (and revokes) the successor inserted here.
  const rotated = await runtime.db.transaction(async (tx): Promise<boolean> => {
    await lockFamily(tx, verdict.familyId);
    const spent = await tx
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.id, verdict.revokeTokenId), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    if (spent.length === 0) {
      return false;
    }
    await tx.insert(refreshTokens).values(verdict.next.row);
    return true;
  });
  if (!rotated) {
    // Zero rows: a concurrent use of the same token won; handled exactly like reuse.
    await revokeOnReuse();
    throw unauthenticated();
  }

  const session = await credentialsFor(runtime, client, {
    token: verdict.next.token,
    familyId: verdict.familyId,
    userId: verdict.userId,
    expiresAt: verdict.next.row.expiresAt,
  });
  if (session.client === 'mobile') {
    const body: MobileRefreshResponse = { tokens: session.tokens };
    return json(body);
  }
  const body: WebRefreshResponse = { csrfToken: session.csrfToken };
  return withCookies(json(body), session.cookies);
}
