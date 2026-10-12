import { inject, Injectable } from '@angular/core';
import { ApiError } from '../api-error';
import type { CsrfResponse, SignInResponse } from '../api-types';
import { API_BASE_URL, API_CLIENT_OPTIONS, FETCH } from '../config';
import { newRequestId, REQUEST_ID_HEADER, send } from '../http';
import { type AuthAttempt, type AuthStrategy, SessionEvents } from './auth-strategy';

export const CSRF_HEADER = 'X-CSRF-Token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Web and PWA: the API sets the HttpOnly `__Host-iv_session` cookie on the same origin; this
 * strategy never sees it. Mutations echo the session-bound CSRF token in `X-CSRF-Token`; the
 * token lives in memory only and is fetched again with `POST /auth/csrf` after a reload.
 */
@Injectable({ providedIn: 'root' })
export class CookieAuthStrategy extends SessionEvents implements AuthStrategy {
  readonly mode = 'cookie' as const;
  readonly credentials: RequestCredentials = 'include';

  private readonly baseUrl = inject(API_BASE_URL);
  private readonly fetchFn = inject(FETCH);
  private readonly options = inject(API_CLIENT_OPTIONS);

  private session = false;
  private csrfToken: string | null = null;
  private generation = 0;
  private csrfInFlight: Promise<boolean> | null = null;

  async authorize(method: string, headers: Headers): Promise<AuthAttempt> {
    if (this.session && !SAFE_METHODS.has(method.toUpperCase())) {
      if (this.csrfToken === null) await this.fetchCsrf();
      if (this.csrfToken !== null) headers.set(CSRF_HEADER, this.csrfToken);
    }
    return { authenticated: this.session, generation: this.generation };
  }

  async recover(error: ApiError, attempt: AuthAttempt): Promise<boolean> {
    if (!attempt.authenticated) return false;
    if (error.status === 403 && error.code === 'csrf.invalid') {
      if (attempt.generation !== this.generation && this.csrfToken !== null) return true;
      this.csrfToken = null;
      return this.fetchCsrf();
    }
    if (error.status === 401) this.end();
    return false;
  }

  async establish(body: SignInResponse): Promise<void> {
    if (body.auth_mode !== 'cookie') {
      throw new Error('cookie strategy received a bearer sign-in');
    }
    this.session = true;
    this.csrfToken = body.csrf_token;
    this.generation += 1;
  }

  async restore(): Promise<boolean> {
    // The cookie is HttpOnly, so only `GET /me` can tell whether it is still valid.
    this.session = true;
    return true;
  }

  async clear(): Promise<void> {
    this.session = false;
    this.csrfToken = null;
    this.generation += 1;
  }

  private end(): void {
    const had = this.session;
    void this.clear();
    if (had) this.notifyEnded();
  }

  /** Single-flight `POST /auth/csrf`; resolves true when a token is held afterwards. */
  private fetchCsrf(): Promise<boolean> {
    this.csrfInFlight ??= this.requestCsrf().finally(() => {
      this.csrfInFlight = null;
    });
    return this.csrfInFlight;
  }

  private async requestCsrf(): Promise<boolean> {
    const requestId = newRequestId();
    const response = await send(
      this.fetchFn,
      `${this.baseUrl}/auth/csrf`,
      {
        method: 'POST',
        headers: { Accept: 'application/json', [REQUEST_ID_HEADER]: requestId },
        credentials: this.credentials,
      },
      { timeoutMs: this.options.timeoutMs, requestId },
    );
    if (!response.ok) {
      const error = await ApiError.fromResponse(response, requestId, this.options.now());
      if (error.status === 401) {
        this.end();
        return false;
      }
      throw error;
    }
    let body: Partial<CsrfResponse>;
    try {
      body = (await response.json()) as Partial<CsrfResponse>;
    } catch {
      throw new ApiError('invalid_response', response.status, 'invalid_response', requestId);
    }
    if (typeof body.csrf_token !== 'string' || body.csrf_token === '') {
      throw new ApiError('invalid_response', response.status, 'invalid_response', requestId);
    }
    this.csrfToken = body.csrf_token;
    this.generation += 1;
    return true;
  }
}
