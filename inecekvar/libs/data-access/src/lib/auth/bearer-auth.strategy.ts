import { inject, Injectable } from '@angular/core';
import { ApiError } from '../api-error';
import type { RefreshResponse, SignInResponse } from '../api-types';
import { API_BASE_URL, API_CLIENT_OPTIONS, FETCH } from '../config';
import { newRequestId, readJson, REQUEST_ID_HEADER, send } from '../http';
import {
  type AuthAttempt,
  type AuthStrategy,
  isCredentialRejection,
  SessionEvents,
} from './auth-strategy';
import { PENDING_LOGOUT_MARKER } from './pending-logout-marker';
import { SECURE_TOKEN_STORE } from './secure-token-store';

const EXPIRY_MARGIN_MS = 30_000;

/** Native access tokens live in memory; refresh tokens rotate in secure storage. */
@Injectable({ providedIn: 'root' })
export class BearerAuthStrategy extends SessionEvents implements AuthStrategy {
  readonly mode = 'bearer' as const;
  readonly credentials: RequestCredentials = 'omit';

  private readonly baseUrl = inject(API_BASE_URL);
  private readonly fetchFn = inject(FETCH);
  private readonly options = inject(API_CLIENT_OPTIONS);
  private readonly store = inject(SECURE_TOKEN_STORE);
  private readonly marker = inject(PENDING_LOGOUT_MARKER);

  private accessToken: string | null = null;
  private accessExpiresAt = 0;
  private refreshable = false;
  private generation = 0;
  private epoch = 0;
  private refreshInFlight: Promise<boolean> | null = null;
  private mutations: Promise<void> = Promise.resolve();

  isCurrentSession(session: number): boolean {
    return session === this.epoch;
  }

  async authorize(_method: string, headers: Headers): Promise<AuthAttempt> {
    const session = this.epoch;
    if (!this.marker.isSet() && !this.hasLiveAccessToken() && this.refreshable) {
      await this.refresh();
    }
    const token =
      session === this.epoch && !this.marker.isSet() && this.hasLiveAccessToken()
        ? this.accessToken
        : null;
    if (token !== null) headers.set('Authorization', `Bearer ${token}`);
    return { authenticated: token !== null, generation: this.generation, session };
  }

  async recover(error: ApiError, attempt: AuthAttempt): Promise<boolean> {
    if (
      attempt.session !== this.epoch ||
      this.marker.isSet() ||
      error.status !== 401 ||
      !attempt.authenticated
    ) {
      return false;
    }
    if (attempt.generation !== this.generation && this.hasLiveAccessToken()) return true;
    if (!this.refreshable) {
      await this.end();
      return false;
    }
    return this.refresh();
  }

  async establish(body: SignInResponse): Promise<void> {
    if (body.auth_mode !== 'bearer') throw new Error('bearer strategy received a cookie sign-in');
    this.dropMemory();
    const epoch = this.epoch;
    await this.lock(async () => {
      if (epoch !== this.epoch) return;
      await this.store.set(body.refresh_token);
      if (epoch !== this.epoch) return;
      this.accept(body.access_token, body.expires_in);
      this.refreshable = true;
      this.marker.clear();
    });
  }

  async restore(): Promise<boolean> {
    if (this.marker.isSet()) return false;
    const epoch = this.epoch;
    await this.mutations;
    const token = await this.store.get();
    if (epoch !== this.epoch || this.marker.isSet()) return false;
    this.refreshable = token !== null;
    return this.refreshable;
  }

  async clear(): Promise<void> {
    this.dropMemory();
    try {
      await this.lock(() => this.store.clear());
    } catch (error) {
      this.marker.set();
      throw error;
    }
  }

  async logout(path: '/auth/logout' | '/auth/logout-all'): Promise<void> {
    const access = this.accessToken;
    this.dropMemory();
    const epoch = this.epoch;
    await this.revoke(path, access, epoch);
  }

  async completePendingLogout(): Promise<void> {
    this.dropMemory();
    const epoch = this.epoch;
    await this.mutations;
    await this.revoke('/auth/logout', null, epoch);
  }

  refresh(): Promise<boolean> {
    if (this.marker.isSet()) return Promise.resolve(false);
    if (this.refreshInFlight !== null) return this.refreshInFlight;
    const pending: Promise<boolean> = this.rotate().finally(() => {
      if (this.refreshInFlight === pending) this.refreshInFlight = null;
    });
    this.refreshInFlight = pending;
    return pending;
  }

  private async rotate(): Promise<boolean> {
    const epoch = this.epoch;
    const refreshToken = await this.store.get();
    if (epoch !== this.epoch) return false;
    if (refreshToken === null) {
      await this.end();
      return false;
    }
    let body: RefreshResponse;
    try {
      body = await this.requestRefresh(refreshToken);
    } catch (error) {
      if (epoch !== this.epoch) return false;
      if (!(error instanceof ApiError) || !isCredentialRejection(error.status)) throw error;
      await this.end();
      return false;
    }
    return this.lock(async () => {
      if (epoch !== this.epoch) return false;
      await this.store.set(body.refresh_token);
      if (epoch !== this.epoch) return false;
      this.accept(body.access_token, body.expires_in);
      return true;
    });
  }

  private async revoke(
    path: '/auth/logout' | '/auth/logout-all',
    access: string | null,
    epoch: number,
  ): Promise<void> {
    if (access === null) {
      const refreshToken = await this.store.get();
      this.assertEpoch(epoch);
      if (refreshToken !== null) {
        try {
          const body = await this.requestRefresh(refreshToken);
          await this.lock(async () => {
            this.assertEpoch(epoch);
            await this.store.set(body.refresh_token);
            this.assertEpoch(epoch);
          });
          access = body.access_token;
        } catch (error) {
          this.assertEpoch(epoch);
          if (!(error instanceof ApiError) || !isCredentialRejection(error.status)) throw error;
        }
      }
    }
    this.assertEpoch(epoch);
    if (access !== null) {
      try {
        await this.post(path, undefined, { Authorization: `Bearer ${access}` });
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
      }
    }
    this.assertEpoch(epoch);
    await this.clear();
  }

  private async requestRefresh(refreshToken: string): Promise<RefreshResponse> {
    const value = await this.post('/auth/refresh', { refresh_token: refreshToken });
    return value as RefreshResponse;
  }

  private post(
    path: string,
    body?: unknown,
    headers: Readonly<Record<string, string>> = {},
  ): Promise<unknown> {
    const requestId = newRequestId();
    return send(
      this.fetchFn,
      this.baseUrl + path,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          [REQUEST_ID_HEADER]: requestId,
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: this.credentials,
      },
      { timeoutMs: this.options.timeoutMs, requestId },
      async (response) => {
        if (!response.ok) {
          throw await ApiError.fromResponse(response, requestId, this.options.now());
        }
        if (path === '/auth/refresh') {
          const value = await readJson(response, requestId);
          if (typeof value !== 'object' || value === null) {
            throw new ApiError('invalid_response', response.status, 'invalid_response', requestId);
          }
          const tokens = value as Partial<RefreshResponse>;
          if (
            typeof tokens.access_token !== 'string' ||
            typeof tokens.refresh_token !== 'string' ||
            typeof tokens.expires_in !== 'number'
          ) {
            throw new ApiError('invalid_response', response.status, 'invalid_response', requestId);
          }
          return value;
        }
        await response.text();
        return undefined;
      },
    );
  }

  private lock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(operation);
    this.mutations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private dropMemory(): void {
    this.epoch += 1;
    this.generation += 1;
    this.accessToken = null;
    this.accessExpiresAt = 0;
    this.refreshable = false;
    this.refreshInFlight = null;
  }

  private assertEpoch(epoch: number): void {
    if (epoch !== this.epoch) throw ApiError.noResponse('aborted', newRequestId());
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
