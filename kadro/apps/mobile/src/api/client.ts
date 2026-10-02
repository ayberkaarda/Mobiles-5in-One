import { ApiError, problemFromResponse } from './errors';

/** Client type header of ADR-0014: selects the bearer transport and JSON token bodies. */
export const CLIENT_HEADER = 'x-kadro-client';
export const CLIENT_TYPE = 'mobile';

export const DEFAULT_TIMEOUT_MS = 15_000;
/** Pauses before the 1st and 2nd retry of an idempotent request. */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [500, 1_500];

/** Statuses after which an idempotent request may succeed when repeated. */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

const API_PATH = /^\/api\/v1\/[A-Za-z0-9\-._~/]*$/;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * - `required`: sends the bearer token, refreshing it first when needed; fails with 401 when
 *   there is no session.
 * - `optional`: sends the token when a session exists (public lists that personalize).
 * - `none`: never sends a token and never refreshes (auth endpoints themselves).
 */
export type AuthMode = 'required' | 'optional' | 'none';

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  readonly method?: HttpMethod;
  readonly query?: Readonly<Record<string, QueryValue>>;
  readonly body?: unknown;
  readonly auth?: AuthMode;
  readonly signal?: AbortSignal;
}

/** What the client needs from the session (implemented by `auth-store/session.ts`). */
export interface SessionPort {
  /** A non-expired access token held in memory, or `null`. */
  getAccessToken(): string | null;
  /** Whether a refresh token is stored, i.e. a refresh can be attempted. */
  hasSession(): boolean;
  /**
   * Single-flight refresh (ADR-0019). Resolves to the new access token, or `null` when the session
   * ended (refresh rejected); rejects on a transport failure, keeping the session.
   */
  refreshAccessToken(): Promise<string | null>;
}

export interface ApiClientOptions {
  /** `EXPO_PUBLIC_API_URL`, validated by `@kadro/config/mobile`. */
  readonly baseUrl: string;
  readonly session: SessionPort;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly retryDelaysMs?: readonly number[];
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface ApiClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(baseUrl: string, path: string, query: RequestOptions['query']): string {
  // Only relative API paths are accepted, so no caller can point the client (and the bearer
  // token) at another host or escape the API prefix.
  if (!API_PATH.test(path) || path.includes('..') || path.includes('//')) {
    throw new TypeError('API path must be a relative /api/v1/ path');
  }
  // Built by hand: React Native's URL and URLSearchParams implementations are partial.
  const pairs = Object.entries(query ?? {})
    .filter(
      (entry): entry is [string, string | number | boolean] =>
        entry[1] !== undefined && entry[1] !== null,
    )
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  const suffix = pairs.length > 0 ? `?${pairs.join('&')}` : '';
  return `${baseUrl.replace(/\/+$/, '')}${path}${suffix}`;
}

/** Scheme and authority of an absolute URL, lower-cased (`https://api.kadro.app`). */
export function originOf(url: string): string | null {
  const match = /^(https?:\/\/[^/?#]+)/i.exec(url);
  return match?.[1]?.toLowerCase() ?? null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function abortError(): Error {
  const error = new Error('The request was cancelled');
  error.name = 'AbortError';
  return error;
}

/**
 * Settles with `promise`, or rejects with an AbortError as soon as the caller cancels. The
 * awaited work itself (a shared refresh) keeps running for its other waiters.
 */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  // Looked up per call, so a fetch installed after the client is created (polyfill, network
  // inspector, test interceptor) is used.
  const fetchImpl: typeof fetch = (input, init) =>
    (options.fetchImpl ?? globalThis.fetch)(input, init);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? defaultSleep;
  const apiOrigin = originOf(options.baseUrl);
  /**
   * Failures of a token refresh. They end the call without the request-level retry: a refresh
   * whose answer was lost may already have rotated the token on the server, and presenting the
   * same token again would be reuse and revoke the session family (ADR-0019).
   */
  const refreshFailures = new WeakSet<object>();

  async function refreshFor(signal: AbortSignal | undefined): Promise<string | null> {
    try {
      return await untilAborted(options.session.refreshAccessToken(), signal);
    } catch (error) {
      if (error instanceof ApiError) {
        refreshFailures.add(error);
      }
      throw error;
    }
  }

  async function send(
    url: string,
    method: HttpMethod,
    body: unknown,
    accessToken: string | null,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      accept: 'application/json, application/problem+json',
      [CLIENT_HEADER]: CLIENT_TYPE,
    };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    if (accessToken !== null) {
      headers.authorization = `Bearer ${accessToken}`;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onCallerAbort = (): void => controller.abort();
    if (signal?.aborted === true) {
      controller.abort();
    } else {
      signal?.addEventListener('abort', onCallerAbort, { once: true });
    }

    try {
      const response = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // The API never redirects; a redirect is treated as an error, cookies are never sent.
        redirect: 'error',
        credentials: 'omit',
        signal: controller.signal,
      });
      // React Native's networking layer follows redirects on its own, whatever `redirect` says.
      // A response from another origin is never trusted.
      const responseUrl = response.url ?? '';
      if (response.redirected || (responseUrl !== '' && originOf(responseUrl) !== apiOrigin)) {
        throw new ApiError({ kind: 'invalid_response', status: response.status });
      }
      return response;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (timedOut) {
        throw new ApiError({ kind: 'timeout', cause: error });
      }
      if (signal?.aborted === true || isAbortError(error)) {
        // Cancelled by the caller (screen left, query cancelled): not an API failure.
        throw error;
      }
      throw new ApiError({ kind: 'network', cause: error });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onCallerAbort);
    }
  }

  async function readBody<T>(response: Response): Promise<T> {
    if (response.ok) {
      if (response.status === 204) {
        return undefined as T;
      }
      try {
        return (await response.json()) as T;
      } catch (error) {
        throw new ApiError({ kind: 'invalid_response', status: response.status, cause: error });
      }
    }
    let problem: unknown = null;
    try {
      problem = await response.json();
    } catch {
      problem = null;
    }
    throw problemFromResponse(response.status, problem);
  }

  async function tokenFor(mode: AuthMode, signal: AbortSignal | undefined): Promise<string | null> {
    if (mode === 'none') {
      return null;
    }
    const current = options.session.getAccessToken();
    if (current !== null) {
      return current;
    }
    if (!options.session.hasSession()) {
      if (mode === 'required') {
        throw new ApiError({ kind: 'problem', status: 401, code: 'unauthenticated' });
      }
      return null;
    }
    const refreshed = await refreshFor(signal);
    if (refreshed === null && mode === 'required') {
      throw new ApiError({ kind: 'problem', status: 401, code: 'unauthenticated' });
    }
    return refreshed;
  }

  /** One logical call: the request plus, after a 401, a single refresh and replay. */
  async function attempt(
    url: string,
    method: HttpMethod,
    body: unknown,
    auth: AuthMode,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    const token = await tokenFor(auth, signal);
    const response = await send(url, method, body, token, signal);
    if (response.status !== 401 || token === null) {
      return response;
    }
    // The access token was rejected (expired early, revoked): refresh once through the shared
    // gate and replay. Concurrent 401s all wait for the same refresh.
    const refreshed = await refreshFor(signal);
    if (refreshed === null) {
      return response;
    }
    return send(url, method, body, refreshed, signal);
  }

  return {
    async request<T>(path: string, requestOptions: RequestOptions = {}): Promise<T> {
      const method = requestOptions.method ?? 'GET';
      const auth = requestOptions.auth ?? 'required';
      const url = buildUrl(options.baseUrl, path, requestOptions.query);
      // Only GET is repeated automatically: it is idempotent, while a repeated POST could create
      // a second team or application.
      const maxRetries = method === 'GET' ? retryDelays.length : 0;

      for (let retry = 0; ; retry += 1) {
        try {
          const response = await attempt(
            url,
            method,
            requestOptions.body,
            auth,
            requestOptions.signal,
          );
          if (RETRYABLE_STATUSES.has(response.status) && retry < maxRetries) {
            await untilAborted(sleep(retryDelays.at(retry) ?? 0), requestOptions.signal);
            continue;
          }
          return await readBody<T>(response);
        } catch (error) {
          const transient =
            error instanceof ApiError &&
            (error.kind === 'network' || error.kind === 'timeout') &&
            !refreshFailures.has(error);
          if (!transient || retry >= maxRetries) {
            throw error;
          }
          await untilAborted(sleep(retryDelays.at(retry) ?? 0), requestOptions.signal);
        }
      }
    },
  };
}
