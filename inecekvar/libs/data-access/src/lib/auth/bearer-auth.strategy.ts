import { inject, Injectable } from '@angular/core';
import { ApiError } from '../api-error';
import type { RefreshResponse, SignInResponse } from '../api-types';
import { API_BASE_URL, API_CLIENT_OPTIONS, FETCH } from '../config';
import { newRequestId, REQUEST_ID_HEADER, send } from '../http';
import {
  type AuthAttempt,
  type AuthStrategy,
  isCredentialRejection,
  SessionEvents,
} from './auth-strategy';
import { SECURE_TOKEN_STORE } from './secure-token-store';

/** Refresh this long before the access token's stated expiry, to absorb clock skew. */
const EXPIRY_MARGIN_MS = 30_000;

/**
 * Native apps: the 15 minute access token is kept in this object only (never persisted, never
 * logged); the 30 day refresh token is kept in secure storage and rotated on every use
 * (ADR-0008). Refresh is single-flight: concurrent 401s share one `POST /auth/refresh`, because
 * a second use of the same refresh token is reuse and revokes the whole family.
 */
@Injectable({ providedIn: 'root' })
export class BearerAuthStrategy extends SessionEvents implements AuthStrategy {
  readonly mode = 'bearer' as const;
  readonly credentials: RequestCredentials = 'omit';

  private readonly baseUrl = inject(API_BASE_URL);
  private readonly fetchFn = inject(FETCH);
  private readonly options = inject(API_CLIENT_OPTIONS);
  private readonly store = inject(SECURE_TOKEN_STORE);

  private accessToken: string | null = null;
  private accessExpiresAt = 0;
  private refreshable = false;
  private generation = 0;
  /** Bumped by `clear`; a refresh that started before a logout must not store its result. */
  private epoch = 0;
  private refreshInFlight: Promise<boolean> | null = null;

  async authorize(_method: string, headers: Headers): Promise<AuthAttempt> {
    if (!this.hasLiveAccessToken() && this.refreshable) {
      await this.refresh();
    }
    const token = this.hasLiveAccessToken() ? this.accessToken : null;
    if (token !== null) headers.set('Authorization', `Bearer ${token}`);
    return { authenticated: token !== null, generation: this.generation };
  }

  async recover(error: ApiError, attempt: AuthAttempt): Promise<boolean> {
    if (error.status !== 401 || !attempt.authenticated) return false;
    // Another request already refreshed while this one was in flight.
    if (attempt.generation !== this.generation && this.hasLiveAccessToken()) return true;
    if (!this.refreshable) {
      await this.end();
      return false;
    }
    return this.refresh();
  }

  async establish(body: SignInResponse): Promise<void> {
    if (body.auth_mode !== 'bearer') {
      throw new Error('bearer strategy received a cookie sign-in');
    }
    await this.store.set(body.refresh_token);
    this.accept(body.access_token, body.expires_in);
    this.refreshable = true;
  }

  async restore(): Promise<boolean> {
    this.refreshable = (await this.store.get()) !== null;
    return this.refreshable;
  }

  async clear(): Promise<void> {
    this.epoch += 1;
    this.generation += 1;
    this.accessToken = null;
    this.accessExpiresAt = 0;
    this.refreshable = false;
    await this.store.clear();
  }

  /** Single-flight refresh; resolves false when the server refused (session ended). */
  refresh(): Promise<boolean> {
    this.refreshInFlight ??= this.rotate().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async rotate(): Promise<boolean> {
    const epoch = this.epoch;
    const refreshToken = await this.store.get();
    if (refreshToken === null) {
      await this.end();
      return false;
    }
    const requestId = newRequestId();
    const response = await send(
      this.fetchFn,
      `${this.baseUrl}/auth/refresh`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          [REQUEST_ID_HEADER]: requestId,
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
        credentials: this.credentials,
      },
      { timeoutMs: this.options.timeoutMs, requestId },
    );
    if (!response.ok) {
      const error = await ApiError.fromResponse(response, requestId, this.options.now());
      // Offline, 429 and 5xx keep the refresh token: the session is not over, the call failed.
      if (!isCredentialRejection(error.status)) throw error;
      if (epoch === this.epoch) await this.end();
      return false;
    }
    let body: Partial<RefreshResponse>;
    try {
      body = (await response.json()) as Partial<RefreshResponse>;
    } catch {
      throw new ApiError('invalid_response', response.status, 'invalid_response', requestId);
    }
    if (
      typeof body.access_token !== 'string' ||
      typeof body.refresh_token !== 'string' ||
      typeof body.expires_in !== 'number'
    ) {
      throw new ApiError('invalid_response', response.status, 'invalid_response', requestId);
    }
    if (epoch !== this.epoch) return false;
    // Store the rotated token before using the new access token: the old one is now spent.
    await this.store.set(body.refresh_token);
    this.accept(body.access_token, body.expires_in);
    return true;
  }

  private accept(accessToken: string, expiresInSeconds: number): void {
    this.accessToken = accessToken;
    this.accessExpiresAt = this.options.now() + expiresInSeconds * 1000 - EXPIRY_MARGIN_MS;
    this.generation += 1;
  }

  private hasLiveAccessToken(): boolean {
    return this.accessToken !== null && this.options.now() < this.accessExpiresAt;
  }

  private async end(): Promise<void> {
    const had = this.refreshable || this.accessToken !== null;
    await this.clear();
    if (had) this.notifyEnded();
  }
}
