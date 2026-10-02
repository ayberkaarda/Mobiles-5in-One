import { hashToken } from '@kadro/auth';
import { refreshTokens } from '@kadro/db';
import { eq } from 'drizzle-orm';

import { recordAudit } from '../audit';
import { type Principal } from '../authorize';
import { clearedSessionCookies } from '../cookies';
import { type ServerRuntime } from '../runtime';
import { revokeFamily, withCookies } from './sessions';

/**
 * `POST auth/logout` (matrix §3.1: self). Revokes the caller's session: the refresh family named
 * by the access token's `sid` (mobile) or by the session cookie (web). A mobile client also sends
 * its refresh token; its family is revoked too when it belongs to the caller, and ignored
 * otherwise, so the endpoint cannot be used to probe or revoke other users' tokens. The answer is
 * always 204; web clients get both cookies expired.
 */
export async function logout(
  runtime: ServerRuntime,
  principal: Principal,
  input: { refreshToken?: string | undefined; ip: string | null },
): Promise<Response> {
  const now = runtime.now();
  await runtime.db.transaction(async (tx) => {
    const families = new Set([principal.sessionId]);
    if (input.refreshToken !== undefined) {
      const [presented] = await tx
        .select({
          userId: refreshTokens.userId,
          familyId: refreshTokens.familyId,
          client: refreshTokens.client,
        })
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hashToken(input.refreshToken)))
        .limit(1);
      if (
        presented !== undefined &&
        presented.userId === principal.userId &&
        presented.client === principal.client
      ) {
        families.add(presented.familyId);
      }
    }
    for (const familyId of [...families].sort()) {
      const revoked = await revokeFamily(tx, familyId, now, principal.userId);
      await recordAudit(tx, runtime.keyedHash, {
        actorId: principal.userId,
        action: 'auth.sessionRevoked',
        targetType: 'session',
        targetId: familyId,
        ip: input.ip,
        metadata: { client: principal.client, reason: 'logout', revokedSessions: revoked },
      });
    }
  });
  const response = new Response(null, { status: 204 });
  return principal.client === 'web'
    ? withCookies(response, clearedSessionCookies(runtime.env))
    : response;
}
