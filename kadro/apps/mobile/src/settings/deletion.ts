import { createStore } from 'zustand/vanilla';

import { ApiError } from '../api/errors';

import { createRawNonce, type RandomBytes } from '../auth/nonce';
import { type AppleAuthPort } from '../auth/providers';
import { sha256Hex } from '../auth/sha256';
import { currentPasswordIssue, type ValidationKey } from '../auth/validation';
import { type DeleteAccountRequest, type MeResponse } from '../profile/contracts';
import { type ProfileApi } from '../profile/profile-api';

/** The grace-period screen; outside both route guards, so it stays open after the sign-out. */
export const DELETION_NOTICE_ROUTE = '/ayarlar/hesap-silindi';

/** Contracts `LIMITS.totpCode.length`, `LIMITS.accountDeletionGraceSeconds` (tests compare). */
export const TOTP_LENGTH = 6;
export const DELETION_GRACE_DAYS = 7;

/**
 * How the account proves the request (authorization matrix footnote 4):
 * - `password`: the account has a password; it is entered again;
 * - `apple`: a social-only account linked to Apple re-authenticates with a fresh Apple token;
 * - `web`: a social-only account whose provider cannot run here (Google is not wired, Apple not
 *   available on this device): the deletion is started on the web page instead.
 */
export type ProofMethod = 'password' | 'apple' | 'web';

export function proofMethod(
  me: Pick<MeResponse, 'providers'>,
  appleAvailable: boolean,
): ProofMethod {
  if (me.providers.password) {
    return 'password';
  }
  if (me.providers.apple && appleAvailable) {
    return 'apple';
  }
  return 'web';
}

/** Staff accounts also send a fresh TOTP code (footnote 5). */
export function needsTotp(me: Pick<MeResponse, 'role'>): boolean {
  return me.role !== 'user';
}

/**
 * Issue keys of the deletion form. The password rules are the auth form's (`auth` namespace);
 * the TOTP key names its namespace, because the form's translator is the `auth` one.
 */
export type DeletionValidationKey = ValidationKey | 'common:deletion.totpInvalid';

const TOTP_PATTERN = /^[0-9]{6}$/;

export function totpIssue(code: string): DeletionValidationKey | null {
  return TOTP_PATTERN.test(code) ? null : 'common:deletion.totpInvalid';
}

export function passwordProofIssue(password: string): DeletionValidationKey | null {
  return currentPasswordIssue(password);
}

export function passwordProof(password: string, totpCode: string | null): DeleteAccountRequest {
  return totpCode === null ? { password } : { password, totpCode };
}

export type AppleProof =
  | { readonly kind: 'proof'; readonly body: DeleteAccountRequest }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unavailable' };

/**
 * A fresh Apple identity token for the request: a new raw nonce whose SHA-256 goes to Apple,
 * the raw nonce goes with the token to the server (as at sign-in, ADR-0049). The token is used at
 * once: the server accepts it for five minutes and only once.
 */
export async function appleProof(
  apple: AppleAuthPort,
  randomBytes: RandomBytes,
  totpCode: string | null,
): Promise<AppleProof> {
  const nonce = createRawNonce(randomBytes);
  if (nonce === null || !(await apple.isAvailable())) {
    return { kind: 'unavailable' };
  }
  const credential = await apple.authorize(sha256Hex(nonce));
  if (credential === null) {
    return { kind: 'cancelled' };
  }
  const body: DeleteAccountRequest = {
    provider: 'apple',
    identityToken: credential.identityToken,
    nonce,
    ...(totpCode === null ? {} : { totpCode }),
  };
  return { kind: 'proof', body };
}

/** What the screen after the request shows; memory only, gone when the app is closed. */
export interface DeletionNotice {
  /** A deletion was requested on this device during this run. */
  readonly pending: boolean;
  /** End of the grace period, when the server's answer arrived (unknown after a lost answer). */
  readonly graceUntil: string | null;
}

export const NO_DELETION_NOTICE: DeletionNotice = { pending: false, graceUntil: null };

export function createDeletionNoticeStore() {
  return createStore<DeletionNotice>()(() => NO_DELETION_NOTICE);
}

export type DeletionNoticeStore = ReturnType<typeof createDeletionNoticeStore>;

export interface StartDeletionDeps {
  readonly profile: Pick<ProfileApi, 'deleteAccount'>;
  readonly session: { signOut(options: { revokeRemote: boolean }): Promise<void> };
  readonly notice: DeletionNoticeStore;
  /** Opens the grace-period screen; called before the session ends, so it stays reachable. */
  readonly showNotice: () => void;
}

/**
 * Answers to `DELETE me` that mean the account is already closed for deletion: the 202 of an
 * earlier attempt was lost (timeout, connection drop), so a repeat finds the request pending
 * (409 `deletion_pending`) or the account deactivated (401 `account_deactivated`).
 */
export function isDeletionAlreadyPending(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    ((error.status === 409 && error.code === 'deletion_pending') ||
      (error.status === 401 && error.code === 'account_deactivated'))
  );
}

/**
 * `DELETE me`, then local cleanup. The server has already revoked every session, so the device
 * signs out without a logout call; the sign-out listeners drop the query caches (memory and
 * device) and the push state. The sign-out runs even when opening the notice fails. An answer
 * saying the deletion is already pending is handled the same way, without a date. Any other
 * failure rejects and changes nothing locally. Resolves to the end of the grace period, if known.
 */
export async function startDeletion(
  deps: StartDeletionDeps,
  body: DeleteAccountRequest,
): Promise<string | null> {
  let graceUntil: string | null;
  try {
    ({ graceUntil } = await deps.profile.deleteAccount(body));
  } catch (error) {
    if (!isDeletionAlreadyPending(error)) {
      throw error;
    }
    graceUntil = null;
  }
  deps.notice.setState({ pending: true, graceUntil });
  try {
    deps.showNotice();
  } finally {
    await deps.session.signOut({ revokeRemote: false });
  }
  return graceUntil;
}
