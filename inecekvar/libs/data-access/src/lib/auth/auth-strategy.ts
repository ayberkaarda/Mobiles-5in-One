import { InjectionToken } from '@angular/core';
import type { ApiError } from '../api-error';
import type { AuthMode, SignInResponse } from '../api-types';

/** What `authorize` attached to one attempt; handed back to `recover` after a 401 or 403. */
export interface AuthAttempt {
  /** True when the attempt carried a credential (bearer token, or a known cookie session). */
  readonly authenticated: boolean;
  /** Credential generation within the session; a newer one allows retry without refresh. */
  readonly generation: number;
  /** Session identity, unchanged by token rotation and changed by establish or clear. */
  readonly session: number;
}

/**
 * How a client proves who it is (spec section 4, ADR-0008). Web and PWA use the HttpOnly
 * session cookie plus the `X-CSRF-Token` header; native apps use a bearer access token kept in
 * memory and a refresh token in platform secure storage. Tokens never leave the strategy: the
 * sign-in body is handed to `establish` and only the user object travels further.
 */
export interface AuthStrategy {
  readonly mode: AuthMode;
  /** `fetch` credentials mode for every API request. */
  readonly credentials: RequestCredentials;
  isCurrentSession(session: number): boolean;
  /** Adds the credential headers for one attempt; may fetch a CSRF token or refresh first. */
  authorize(method: string, headers: Headers): Promise<AuthAttempt>;
  /**
   * Called once after an authenticated attempt answered 401, or 403 `csrf.invalid`.
   * Resolves true when the request should be retried once. Stale attempts leave the new session alone.
   */
  recover(error: ApiError, attempt: AuthAttempt): Promise<boolean>;
  /** Takes the body of a successful login or magic-link verification. */
  establish(body: SignInResponse): Promise<void>;
  /** On start: true when a session may exist and `GET /me` is worth asking. */
  restore(): Promise<boolean>;
  /** Forgets every credential held on this device. */
  clear(): Promise<void>;
  /** Drops memory immediately, then revokes with the captured credential. */
  logout(path: '/auth/logout' | '/auth/logout-all'): Promise<void>;
  /** Completes revocation using only the retained cookie or secure refresh token. */
  completePendingLogout(): Promise<void>;
  /** Called when the server ends the session (expired, revoked, refresh refused). */
  onSessionEnded(listener: () => void): () => void;
}

export const AUTH_STRATEGY = new InjectionToken<AuthStrategy>('AUTH_STRATEGY');

/** Statuses that mean the server refused a credential, as opposed to being unreachable. */
export function isCredentialRejection(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 422;
}

export abstract class SessionEvents {
  private readonly listeners = new Set<() => void>();

  onSessionEnded(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected notifyEnded(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
