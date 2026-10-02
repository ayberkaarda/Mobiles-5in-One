import { createHash } from 'node:crypto';

import { constantTimeEqual } from '@kadro/auth';
import { type WebEnv } from '@kadro/config';
import { type JWTPayload, jwtVerify, type JWTVerifyGetKey } from 'jose';

import {
  createJwksSource,
  type JwksFetch,
  type JwksSourceOptions,
  JwksUnavailableError,
} from './jwks';

/**
 * Sign in with Apple and Google (authorization matrix §3.1 footnote 3, threat model T-AUTH-06).
 * Identity tokens are verified with the provider's published keys: algorithm pinned to RS256,
 * issuer pinned, `aud` limited to our configured client ids, `exp` / `iat` checked with a 5 s
 * tolerance, and the nonce bound to the request (Apple: the token carries SHA-256 of the raw
 * nonce the client generated; Google: the raw nonce itself).
 */

export type ProviderName = 'apple' | 'google';

export interface ProviderIdentity {
  readonly provider: ProviderName;
  readonly subject: string;
  /** Lower-cased email from the token, if any. */
  readonly email: string | null;
  /** `true` only when the provider asserts the email as verified. */
  readonly emailVerified: boolean;
  /** Name claim (Google only); Apple sends the name to the app, not in the token. */
  readonly name: string | null;
}

export type ProviderVerdict =
  | { readonly ok: true; readonly identity: ProviderIdentity }
  | { readonly ok: false; readonly reason: 'invalid' | 'unavailable' };

export interface ProviderTokenVerifier {
  verify(token: string, nonce: string | undefined, now: Date): Promise<ProviderVerdict>;
}

export const APPLE_ISSUER = 'https://appleid.apple.com';
export const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'] as const;
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const PROVIDER_ALGORITHMS = ['RS256'];
const CLOCK_TOLERANCE_SECONDS = 5;
const MAX_SUBJECT_LENGTH = 255;

/** Apple sends booleans as JSON booleans or as the strings "true" / "false". */
function claimIsTrue(value: unknown): boolean {
  return value === true || value === 'true';
}

function stringClaim(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

interface VerifyOptions {
  readonly getKey: JWTVerifyGetKey;
  readonly issuer: string | readonly string[];
  readonly audience: readonly string[];
}

async function verifyIdentityToken(
  token: string,
  options: VerifyOptions,
  now: Date,
): Promise<{ ok: true; payload: JWTPayload } | { ok: false; reason: 'invalid' | 'unavailable' }> {
  try {
    const { payload } = await jwtVerify(token, options.getKey, {
      algorithms: PROVIDER_ALGORITHMS,
      issuer: [...(typeof options.issuer === 'string' ? [options.issuer] : options.issuer)],
      audience: [...options.audience],
      requiredClaims: ['sub', 'iat', 'exp'],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      currentDate: now,
    });
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    if (typeof payload.iat !== 'number' || payload.iat > nowSeconds + CLOCK_TOLERANCE_SECONDS) {
      return { ok: false, reason: 'invalid' };
    }
    const subject = payload.sub;
    if (
      typeof subject !== 'string' ||
      subject.length === 0 ||
      subject.length > MAX_SUBJECT_LENGTH
    ) {
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true, payload };
  } catch (error) {
    return { ok: false, reason: error instanceof JwksUnavailableError ? 'unavailable' : 'invalid' };
  }
}

function identityFrom(provider: ProviderName, payload: JWTPayload): ProviderIdentity {
  const email = stringClaim(payload.email);
  return {
    provider,
    subject: payload.sub ?? '',
    email: email === null ? null : email.trim().toLowerCase(),
    emailVerified: email !== null && claimIsTrue(payload.email_verified),
    name: provider === 'google' ? stringClaim(payload.name) : null,
  };
}

export function createAppleVerifier(options: {
  readonly audiences: readonly string[];
  readonly getKey: JWTVerifyGetKey;
}): ProviderTokenVerifier {
  return {
    async verify(token, nonce, now) {
      if (nonce === undefined) {
        return { ok: false, reason: 'invalid' };
      }
      const result = await verifyIdentityToken(
        token,
        { getKey: options.getKey, issuer: APPLE_ISSUER, audience: options.audiences },
        now,
      );
      if (!result.ok) {
        return result;
      }
      const tokenNonce = stringClaim(result.payload.nonce);
      if (tokenNonce === null || !constantTimeEqual(tokenNonce, sha256Hex(nonce))) {
        return { ok: false, reason: 'invalid' };
      }
      return { ok: true, identity: identityFrom('apple', result.payload) };
    },
  };
}

export function createGoogleVerifier(options: {
  readonly clientIds: readonly string[];
  readonly getKey: JWTVerifyGetKey;
}): ProviderTokenVerifier {
  return {
    async verify(token, nonce, now) {
      const result = await verifyIdentityToken(
        token,
        { getKey: options.getKey, issuer: GOOGLE_ISSUERS, audience: options.clientIds },
        now,
      );
      if (!result.ok) {
        return result;
      }
      // A nonce in the request must match the token; a token issued for a nonce-bound request
      // cannot be replayed through a request that omits it.
      const tokenNonce = stringClaim(result.payload.nonce);
      if (nonce !== undefined || tokenNonce !== null) {
        if (nonce === undefined || tokenNonce === null || !constantTimeEqual(tokenNonce, nonce)) {
          return { ok: false, reason: 'invalid' };
        }
      }
      return { ok: true, identity: identityFrom('google', result.payload) };
    },
  };
}

export type ProviderEnv = Pick<WebEnv, 'APPLE_AUDIENCES' | 'GOOGLE_CLIENT_IDS'>;

export interface ProviderVerifiers {
  readonly apple: ProviderTokenVerifier;
  readonly google: ProviderTokenVerifier;
}

/** Production verifiers backed by the providers' JWKS endpoints. */
export function createProviderVerifiers(
  env: ProviderEnv,
  dependencies: {
    readonly fetch: JwksFetch;
    readonly now?: () => number;
    readonly onStaleKeys?: JwksSourceOptions['onStaleKeys'];
  },
): ProviderVerifiers {
  const shared = {
    fetch: dependencies.fetch,
    ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
    ...(dependencies.onStaleKeys === undefined ? {} : { onStaleKeys: dependencies.onStaleKeys }),
  };
  const appleKeys = createJwksSource({ url: APPLE_JWKS_URL, ...shared });
  const googleKeys = createJwksSource({ url: GOOGLE_JWKS_URL, ...shared });
  return {
    apple: createAppleVerifier({ audiences: env.APPLE_AUDIENCES, getKey: appleKeys.getKey }),
    google: createGoogleVerifier({ clientIds: env.GOOGLE_CLIENT_IDS, getKey: googleKeys.getKey }),
  };
}
