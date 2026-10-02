import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { type WebEnv } from '@kadro/config';

import { constantTimeEqual } from './tokens.js';

/**
 * Signed double-submit CSRF tokens for cookie-authenticated web mutations (security checklist
 * item 12, threat model T-AUTH-09). The same token is set in the CSRF cookie and echoed by the
 * page in the `x-csrf-token` header. On top of the cookie/header equality, each token carries an
 * HMAC over the session binding, so a token planted through a cookie-injection bug or taken from
 * another session is rejected.
 *
 * Format: base64url(nonce[32] || HMAC-SHA256(CSRF_SECRET, domain || binding || nonce)[32]),
 * 86 characters of `[A-Za-z0-9_-]`, valid for `opaqueTokenSchema` of `@kadro/contracts`.
 *
 * The binding is the refresh family id of the web session: it stays stable across session
 * rotation, so an open tab keeps working after another tab rotated the cookie.
 */

export type CsrfEnv = Pick<WebEnv, 'CSRF_SECRET'>;

const NONCE_BYTES = 32;
const MAC_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{86}$/;
const DOMAIN = 'kadro.csrf.v1';

export interface CsrfPresentation {
  /** Value of the CSRF cookie, if any. */
  cookieToken: string | null | undefined;
  /** Value of the `x-csrf-token` header, if any. */
  headerToken: string | null | undefined;
  /** Refresh family id of the authenticated web session. */
  sessionBinding: string;
}

export interface CsrfService {
  issue(sessionBinding: string): string;
  verify(presentation: CsrfPresentation): boolean;
}

export function createCsrfService(env: CsrfEnv): CsrfService {
  const key = Buffer.from(env.CSRF_SECRET, 'base64url');

  function mac(sessionBinding: string, nonce: Buffer): Buffer {
    return createHmac('sha256', key)
      .update(DOMAIN, 'utf8')
      .update('\0')
      .update(sessionBinding, 'utf8')
      .update('\0')
      .update(nonce)
      .digest();
  }

  function issue(sessionBinding: string): string {
    const nonce = randomBytes(NONCE_BYTES);
    return Buffer.concat([nonce, mac(sessionBinding, nonce)]).toString('base64url');
  }

  function verify({ cookieToken, headerToken, sessionBinding }: CsrfPresentation): boolean {
    if (typeof cookieToken !== 'string' || typeof headerToken !== 'string') {
      return false;
    }
    const pairMatches = constantTimeEqual(cookieToken, headerToken);
    if (!TOKEN_PATTERN.test(headerToken)) {
      return false;
    }
    const raw = Buffer.from(headerToken, 'base64url');
    if (raw.length !== NONCE_BYTES + MAC_BYTES) {
      return false;
    }
    const expected = mac(sessionBinding, raw.subarray(0, NONCE_BYTES));
    const signatureMatches = timingSafeEqual(expected, raw.subarray(NONCE_BYTES));
    return pairMatches && signatureMatches;
  }

  return { issue, verify };
}
