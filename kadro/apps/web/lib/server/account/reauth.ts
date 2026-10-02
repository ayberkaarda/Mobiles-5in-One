import { verifyPassword } from '@kadro/auth';
import { type DeleteAccountRequest } from '@kadro/contracts';
import { type User } from '@kadro/db';
import { decodeJwt } from 'jose';

import { authServices } from '../auth/services';
import { ApiError } from '../errors';
import { type ServerRuntime } from '../runtime';

/**
 * Re-authentication proof of `DELETE me` (authorization matrix footnotes 4 and 5, ADR-0032).
 *
 * - `password`: verified with Argon2id against the account's hash; a social-only account is
 *   verified against the dummy hash (same work) and fails.
 * - `provider` + `identityToken`: verified like a sign-in (signature, issuer, audience, expiry,
 *   nonce), then it must name the subject linked to this account and be issued at most
 *   {@link REAUTH_TOKEN_MAX_AGE_SECONDS} ago. Each token is accepted once: its keyed hash is
 *   recorded for longer than any token could stay fresh.
 * - Staff accounts (`moderator`, `admin`) must also present a fresh TOTP code. TOTP secrets are
 *   enrolled through `POST admin/totp/enroll`, which does not exist yet, so no account holds a
 *   verifiable secret: {@link verifyStaffTotp} fails closed and staff deletion answers 401
 *   `step_up_required` until enrollment ships with its secret key.
 *
 * Nothing about the proof (password, token, code) is logged or stored in clear.
 */

export const REAUTH_TOKEN_MAX_AGE_SECONDS = 300;
/** Clock skew tolerated on `iat` (same as sign-in). */
const CLOCK_TOLERANCE_SECONDS = 5;
/** Replay record lifetime: longer than freshness plus tolerance. */
const REPLAY_WINDOW_SECONDS = 900;

export type ReauthAccount = Pick<User, 'id' | 'passwordHash' | 'appleSub' | 'googleSub'>;

function issuedRecently(token: string, now: Date): boolean {
  try {
    const { iat } = decodeJwt(token);
    if (typeof iat !== 'number') {
      return false;
    }
    const age = Math.floor(now.getTime() / 1_000) - iat;
    return age <= REAUTH_TOKEN_MAX_AGE_SECONDS && age >= -CLOCK_TOLERANCE_SECONDS;
  } catch {
    return false;
  }
}

/** Records the token as used; `false` when it was already used inside the replay window. */
async function spendIdentityToken(runtime: ServerRuntime, token: string): Promise<boolean> {
  const key = `reauth:${runtime.keyedHash('rate-limit', `reauth-identity-token:${token}`)}`;
  const result = await runtime.limiter.hit(key, { max: 1, windowSeconds: REPLAY_WINDOW_SECONDS });
  return result.allowed;
}

/**
 * `true` when the body carries a valid proof for `account`. An unreachable provider key set is
 * 503 `service_unavailable` (the client retries), never a silent pass.
 */
export async function verifyReauthProof(
  runtime: ServerRuntime,
  account: ReauthAccount,
  body: DeleteAccountRequest,
): Promise<boolean> {
  if (body.password !== undefined) {
    return verifyPassword(account.passwordHash, body.password);
  }
  if (body.provider === undefined || body.identityToken === undefined) {
    return false;
  }
  const services = authServices(runtime);
  const verifier = body.provider === 'apple' ? services.apple : services.google;
  const now = runtime.now();
  const verdict = await verifier.verify(body.identityToken, body.nonce, now);
  if (!verdict.ok) {
    if (verdict.reason === 'unavailable') {
      throw new ApiError('service_unavailable', { headers: { 'Retry-After': '5' } });
    }
    return false;
  }
  const linked = body.provider === 'apple' ? account.appleSub : account.googleSub;
  if (linked === null || linked !== verdict.identity.subject) {
    return false;
  }
  if (!issuedRecently(body.identityToken, now)) {
    return false;
  }
  return spendIdentityToken(runtime, body.identityToken);
}

/**
 * Fresh TOTP code of a staff account (footnote 5). Fails closed while no TOTP secret can be
 * enrolled or decrypted (see the module comment); a code alone never passes.
 */
export function verifyStaffTotp(
  _account: Pick<User, 'totpSecretEnc'>,
  _code: string | undefined,
): boolean {
  return false;
}
