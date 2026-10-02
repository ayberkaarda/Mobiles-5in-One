import { randomUUID } from 'node:crypto';

import { type WebEnv } from '@kadro/config';
import { type AuthClient } from '@kadro/contracts';

import { generateOpaqueToken, hashToken } from './tokens.js';

/**
 * Refresh-token and web-session rotation as pure functions (security checklist item 12,
 * ADR-0014). Mobile refresh tokens and web session cookies are rows of `refresh_tokens` that differ
 * only in `client` and lifetime. The functions here decide; the caller performs the writes.
 *
 * Rotation protocol for the caller, inside one transaction:
 * 1. look the presented token up by `hashToken(token)`;
 * 2. `evaluateRefresh(row, ...)`;
 * 3. on `rotate`: `UPDATE refresh_tokens SET revoked_at = now() WHERE id = $revokeTokenId AND
 *    revoked_at IS NULL RETURNING id`. Zero rows means a concurrent use of the same token: handle
 *    it exactly like `reuse`. Otherwise insert `next.row`;
 * 4. on `reuse`: `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $familyId AND
 *    revoked_at IS NULL`, then answer 401.
 * Because every rotation revokes its predecessor, "unrevoked" equals "newest in the chain"
 * (matrix footnote 1), and any presentation of a revoked token is treated as theft.
 */

export type RefreshTokenEnv = Pick<WebEnv, 'REFRESH_TOKEN_TTL_SECONDS' | 'SESSION_TTL_SECONDS'>;

/** Lifetime of a new row: 30-day refresh token (mobile) or 7-day rolling session (web). */
export function refreshTtlSeconds(env: RefreshTokenEnv, client: AuthClient): number {
  return client === 'mobile' ? env.REFRESH_TOKEN_TTL_SECONDS : env.SESSION_TTL_SECONDS;
}

/** New rotation family: one per login, shared by every token rotated from it. */
export function newFamilyId(): string {
  return randomUUID();
}

/** Values for a new `refresh_tokens` row (the id is assigned by the database layer). */
export interface RefreshTokenRowValues {
  tokenHash: string;
  userId: string;
  client: AuthClient;
  familyId: string;
  deviceLabel: string | null;
  expiresAt: Date;
  rotatedFrom: string | null;
  stepUpUntil: Date | null;
}

export interface IssuedRefreshToken {
  /** Returned to the client once (body for mobile, cookie for web); never stored or logged. */
  token: string;
  row: RefreshTokenRowValues;
}

export interface IssueRefreshTokenInput {
  userId: string;
  client: AuthClient;
  ttlSeconds: number;
  deviceLabel?: string | null;
  now?: Date;
}

/** Starts a new family at login or provider sign-in. */
export function issueRefreshToken(input: IssueRefreshTokenInput): IssuedRefreshToken {
  const now = input.now ?? new Date();
  const token = generateOpaqueToken();
  return {
    token,
    row: {
      tokenHash: hashToken(token),
      userId: input.userId,
      client: input.client,
      familyId: newFamilyId(),
      deviceLabel: input.deviceLabel ?? null,
      expiresAt: new Date(now.getTime() + input.ttlSeconds * 1_000),
      rotatedFrom: null,
      stepUpUntil: null,
    },
  };
}

/** The `refresh_tokens` columns the rotation decision reads. */
export interface StoredRefreshToken {
  id: string;
  userId: string;
  client: AuthClient;
  familyId: string;
  deviceLabel: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  stepUpUntil: Date | null;
}

export type RefreshVerdict =
  | {
      kind: 'rotate';
      userId: string;
      familyId: string;
      /** Row to revoke (conditionally, see the module protocol). */
      revokeTokenId: string;
      next: IssuedRefreshToken;
    }
  /** A revoked token was presented: revoke every token of `familyId`, then answer 401. */
  | { kind: 'reuse'; userId: string; familyId: string; code: 'unauthenticated' }
  | { kind: 'reject'; reason: 'unknown' | 'wrong_client' | 'expired'; code: 'unauthenticated' };

export interface EvaluateRefreshInput {
  /** Transport of the current request (`x-kadro-client`). */
  client: AuthClient;
  ttlSeconds: number;
  now?: Date;
}

/**
 * Decides what to do with a presented refresh token or session cookie. `stored` is the row found
 * by its hash, or `null`. A token presented over the other client's transport is rejected without
 * touching the family (ADR-0014).
 */
export function evaluateRefresh(
  stored: StoredRefreshToken | null,
  input: EvaluateRefreshInput,
): RefreshVerdict {
  if (stored === null) {
    return { kind: 'reject', reason: 'unknown', code: 'unauthenticated' };
  }
  if (stored.client !== input.client) {
    return { kind: 'reject', reason: 'wrong_client', code: 'unauthenticated' };
  }
  if (stored.revokedAt !== null) {
    return {
      kind: 'reuse',
      userId: stored.userId,
      familyId: stored.familyId,
      code: 'unauthenticated',
    };
  }
  const now = input.now ?? new Date();
  if (stored.expiresAt.getTime() <= now.getTime()) {
    return { kind: 'reject', reason: 'expired', code: 'unauthenticated' };
  }
  const token = generateOpaqueToken();
  return {
    kind: 'rotate',
    userId: stored.userId,
    familyId: stored.familyId,
    revokeTokenId: stored.id,
    next: {
      token,
      row: {
        tokenHash: hashToken(token),
        userId: stored.userId,
        client: stored.client,
        familyId: stored.familyId,
        deviceLabel: stored.deviceLabel,
        expiresAt: new Date(now.getTime() + input.ttlSeconds * 1_000),
        rotatedFrom: stored.id,
        stepUpUntil: stored.stepUpUntil,
      },
    },
  };
}

/** Web sessions are extended at most once per hour of use (ADR-0014). */
export const SESSION_EXTENSION_INTERVAL_SECONDS = 3_600;

/**
 * Rolling web-session expiry: returns the new `expires_at` when the session should be extended
 * on this request, or `null` when it was extended less than an hour ago or has already expired.
 */
export function sessionExtension(
  expiresAt: Date,
  ttlSeconds: number,
  now: Date = new Date(),
): Date | null {
  if (expiresAt.getTime() <= now.getTime()) {
    return null;
  }
  const target = now.getTime() + ttlSeconds * 1_000;
  return target - expiresAt.getTime() >= SESSION_EXTENSION_INTERVAL_SECONDS * 1_000
    ? new Date(target)
    : null;
}
