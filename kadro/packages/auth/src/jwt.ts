import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';

import { type WebEnv } from '@kadro/config';
import {
  ACCESS_TOKEN_AUDIENCE,
  type AccessTokenClaims,
  accessTokenClaimsSchema,
} from '@kadro/contracts';
import { calculateJwkThumbprint, errors, exportJWK, jwtVerify, SignJWT } from 'jose';

/** Only accepted signing algorithm. Tokens with any other `alg` (including `none`) are rejected. */
export const ACCESS_TOKEN_ALG = 'ES256';
/** JOSE `typ` header of access tokens (RFC 9068), so other JWTs cannot be replayed as access tokens. */
export const ACCESS_TOKEN_TYPE = 'at+jwt';
/** Allowed clock skew between instances when checking `exp` and `iat`. */
export const CLOCK_TOLERANCE_SECONDS = 5;

/*
 * Claim set and audience come from `@kadro/contracts` (ADR-0012): exactly `sub`, `sid`, `iat`,
 * `exp`, `aud`, `iss`; any additional claim makes a token invalid.
 */

export type AccessTokenEnv = Pick<
  WebEnv,
  'WEB_ORIGIN' | 'JWT_PRIVATE_KEY' | 'JWT_PUBLIC_KEY' | 'ACCESS_TOKEN_TTL_SECONDS'
>;

export interface IssuedAccessToken {
  token: string;
  expiresAt: Date;
}

export type AccessTokenVerdict =
  | { ok: true; claims: AccessTokenClaims }
  | { ok: false; code: 'unauthenticated'; reason: 'expired' | 'invalid' };

export interface AccessTokenService {
  /** RFC 7638 thumbprint of the public key, sent as `kid`. */
  readonly keyId: string;
  readonly issuer: string;
  readonly ttlSeconds: number;
  issue(subject: { userId: string; sessionId: string }, now?: Date): Promise<IssuedAccessToken>;
  verify(token: string, now?: Date): Promise<AccessTokenVerdict>;
}

function invalid(reason: 'expired' | 'invalid'): AccessTokenVerdict {
  return { ok: false, code: 'unauthenticated', reason };
}

function loadKeys(env: AccessTokenEnv): { privateKey: KeyObject; publicKey: KeyObject } {
  return {
    privateKey: createPrivateKey(env.JWT_PRIVATE_KEY),
    publicKey: createPublicKey(env.JWT_PUBLIC_KEY),
  };
}

/**
 * ES256 access tokens for mobile clients. The issuer is `WEB_ORIGIN`, the lifetime
 * `ACCESS_TOKEN_TTL_SECONDS` (default 900 s); both come from the validated `@kadro/config` env,
 * which also guarantees that the key pair is a matching EC P-256 pair.
 */
export async function createAccessTokenService(env: AccessTokenEnv): Promise<AccessTokenService> {
  const { privateKey, publicKey } = loadKeys(env);
  const keyId = await calculateJwkThumbprint(await exportJWK(publicKey), 'sha256');
  const issuer = env.WEB_ORIGIN;
  const ttlSeconds = env.ACCESS_TOKEN_TTL_SECONDS;

  async function issue(
    subject: { userId: string; sessionId: string },
    now: Date = new Date(),
  ): Promise<IssuedAccessToken> {
    const iat = Math.floor(now.getTime() / 1_000);
    const exp = iat + ttlSeconds;
    const claims = accessTokenClaimsSchema.parse({
      sub: subject.userId,
      sid: subject.sessionId,
      iat,
      exp,
      aud: ACCESS_TOKEN_AUDIENCE,
      iss: issuer,
    });
    const token = await new SignJWT({ sid: claims.sid })
      .setProtectedHeader({ alg: ACCESS_TOKEN_ALG, typ: ACCESS_TOKEN_TYPE, kid: keyId })
      .setSubject(claims.sub)
      .setIssuer(claims.iss)
      .setAudience(claims.aud)
      .setIssuedAt(claims.iat)
      .setExpirationTime(claims.exp)
      .sign(privateKey);
    return { token, expiresAt: new Date(exp * 1_000) };
  }

  async function verify(token: string, now: Date = new Date()): Promise<AccessTokenVerdict> {
    try {
      const { payload, protectedHeader } = await jwtVerify(token, publicKey, {
        algorithms: [ACCESS_TOKEN_ALG],
        typ: ACCESS_TOKEN_TYPE,
        issuer,
        audience: ACCESS_TOKEN_AUDIENCE,
        requiredClaims: ['sub', 'sid', 'iat', 'exp'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        maxTokenAge: ttlSeconds + CLOCK_TOLERANCE_SECONDS,
        currentDate: now,
      });
      if (protectedHeader.kid !== keyId) {
        return invalid('invalid');
      }
      const parsed = accessTokenClaimsSchema.safeParse(payload);
      if (!parsed.success) {
        return invalid('invalid');
      }
      const claims = parsed.data;
      const nowSeconds = Math.floor(now.getTime() / 1_000);
      if (
        claims.exp - claims.iat > ttlSeconds ||
        claims.iat > nowSeconds + CLOCK_TOLERANCE_SECONDS
      ) {
        return invalid('invalid');
      }
      return { ok: true, claims };
    } catch (error) {
      return invalid(error instanceof errors.JWTExpired ? 'expired' : 'invalid');
    }
  }

  return { keyId, issuer, ttlSeconds, issue, verify };
}
