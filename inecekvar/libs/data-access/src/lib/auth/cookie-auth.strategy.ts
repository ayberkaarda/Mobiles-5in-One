import { inject, Injectable } from '@angular/core';
import { ApiError } from '../api-error';
import type { CsrfResponse, SignInResponse } from '../api-types';
import { API_BASE_URL, API_CLIENT_OPTIONS, FETCH } from '../config';
import { newRequestId, readJson, REQUEST_ID_HEADER, send } from '../http';
import { type AuthAttempt, type AuthStrategy, SessionEvents } from './auth-strategy';
import { PENDING_LOGOUT_MARKER } from './pending-logout-marker';

export const CSRF_HEADER = 'X-CSRF-Token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Web and PWA sessions use an HttpOnly cookie and an in-memory CSRF token. */
@Injectable({ providedIn: 'root' })
export class CookieAuthStrategy extends SessionEvents implements AuthStrategy {
  readonly mode = 'cookie' as const;

  private readonly baseUrl = inject(API_BASE_URL);
  private readonly fetchFn = inject(FETCH);
  private readonly options = inject(API_CLIENT_OPTIONS);
  private readonly marker = inject(PENDING_LOGOUT_MARKER);

  private session = false;
  private sessionId = 0;
  private csrfToken: string | null = null;
  private generation = 0;
  private csrfInFlight: Promise<boolean> | null = null;

  get credentials(): RequestCredentials {
    return this.marker.isSet() ? 'omit' : 'include';
  }

  isCurrentSession(session: number): boolean {
    return session === this.sessionId;
  }

  async authorize(method: string, headers: Headers): Promise<AuthAttempt> {
    const session = this.sessionId;
    if (!this.marker.isSet() && this.session && !SAFE_METHODS.has(method.toUpperCase())) {
      if (this.csrfToken === null) await this.fetchCsrf();
      if (session === this.sessionId && this.csrfToken !== null && !this.marker.isSet()) {
        headers.set(CSRF_HEADER, this.csrfToken);
      }
    }
    return {
      authenticated: session === this.sessionId && this.session && !this.marker.isSet(),
      generation: this.generation,
      session,
    };
  }

  async recover(error: ApiError, attempt: AuthAttempt): Promise<boolean> {
    if (attempt.session !== this.sessionId || !attempt.authenticated || this.marker.isSet()) {
      return false;
    }
    if (error.status === 403 && error.code === 'csrf.invalid') {
      if (attempt.generation !== this.generation && this.csrfToken !== null) return true;
      this.csrfToken = null;
      return this.fetchCsrf();
    }
    if (error.status === 401) this.end();
    return false;
  }

  async establish(body: SignInResponse): Promise<void> {
    if (body.auth_mode !== 'cookie') throw new Error('cookie strategy received a bearer sign-in');
    this.sessionId += 1;
    this.csrfInFlight = null;
    this.session = true;
    this.csrfToken = body.csrf_token;
    this.generation += 1;
    this.marker.clear();
  }

  async restore(): Promise<boolean> {
    if (this.marker.isSet()) return false;
    this.session = true;
    return true;
  }

  async clear(): Promise<void> {
    this.sessionId += 1;
    this.session = false;
    this.csrfToken = null;
    this.csrfInFlight = null;
    this.generation += 1;
  }

  async logout(path: '/auth/logout' | '/auth/logout-all'): Promise<void> {
    const csrf = this.csrfToken;
    const clearing = this.clear();
    const session = this.sessionId;
    await clearing;
    await this.revoke(path, csrf, session);
  }

  async completePendingLogout(): Promise<void> {
    const clearing = this.clear();
    const session = this.sessionId;
    await clearing;
    await this.revoke('/auth/logout', null, session);
  }

  private async revoke(
    path: '/auth/logout' | '/auth/logout-all',
    csrf: string | null,
    session: number,
  ): Promise<void> {
    try {
      const token = csrf ?? (await this.csrfRequest());
      if (session !== this.sessionId) throw ApiError.noResponse('aborted', newRequestId());
      await this.post(path, { [CSRF_HEADER]: token });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
    }
    if (session !== this.sessionId) throw ApiError.noResponse('aborted', newRequestId());
    await this.clear();
  }

  private end(): void {
    const had = this.session;
    void this.clear();
    if (had) this.notifyEnded();
  }

  private fetchCsrf(): Promise<boolean> {
    if (this.csrfInFlight !== null) return this.csrfInFlight;
    const pending: Promise<boolean> = this.requestCsrf().finally(() => {
      if (this.csrfInFlight === pending) this.csrfInFlight = null;
    });
    this.csrfInFlight = pending;
    return pending;
  }

  private async requestCsrf(): Promise<boolean> {
    const session = this.sessionId;
    let token: string;
    try {
      token = await this.csrfRequest();
    } catch (error) {
      if (session !== this.sessionId) return false;
      if (error instanceof ApiError && error.status === 401) {
        this.end();
        return false;
      }
      throw error;
    }
    if (session !== this.sessionId || this.marker.isSet()) return false;
    this.csrfToken = token;
    this.generation += 1;
    return true;
  }

  private async csrfRequest(): Promise<string> {
    const value = await this.post('/auth/csrf');
    return (value as CsrfResponse).csrf_token;
  }

  private post(path: string, headers: Readonly<Record<string, string>> = {}): Promise<unknown> {
    const requestId = newRequestId();
    return send(
      this.fetchFn,
      this.baseUrl + path,
      {
        method: 'POST',
        headers: { Accept: 'application/json', [REQUEST_ID_HEADER]: requestId, ...headers },
        credentials: 'include',
      },
      { timeoutMs: this.options.timeoutMs, requestId },
      async (response) => {
        if (!response.ok) {
          throw await ApiError.fromResponse(response, requestId, this.options.now());
        }
        if (path === '/auth/csrf') {
          const value = await readJson(response, requestId);
          if (typeof value !== 'object' || value === null) {
            throw new ApiError('invalid_response', response.status, 'invalid_response', requestId);
          }
          const token = (value as Partial<CsrfResponse>).csrf_token;
          if (typeof token !== 'string' || token === '') {
            throw new ApiError('invalid_response', response.status, 'invalid_response', requestId);
          }
          return value;
        }
        await response.text();
        return undefined;
      },
    );
  }
}
