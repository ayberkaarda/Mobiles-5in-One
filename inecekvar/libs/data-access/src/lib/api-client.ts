import { computed, inject, Injectable, signal } from '@angular/core';
import { ApiError } from './api-error';
import type { ApiPathTemplate, HttpMethod, PathParamNames } from './api-types';
import { AUTH_STRATEGY, type AuthAttempt } from './auth/auth-strategy';
import { API_BASE_URL, API_CLIENT_OPTIONS, FETCH } from './config';
import { newRequestId, REQUEST_ID_HEADER, send } from './http';

type QueryValue = string | number | boolean | null | undefined;

export interface ApiRequest<P extends ApiPathTemplate> {
  method: HttpMethod;
  /** A path of `docs/api/openapi.json` without `/v1`, for example `/lines/{slug}`. */
  path: P;
  params?: Record<PathParamNames<P>, string>;
  query?: Readonly<Record<string, QueryValue>>;
  body?: unknown;
  headers?: Readonly<Record<string, string>>;
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * `false` for the sign-in endpoints: no credential header is attached and a 401 is an answer
   * (wrong password), not a reason to refresh.
   */
  auth?: boolean;
  /** Sign-in may replace a cookie while an earlier logout remains pending. */
  credentials?: RequestCredentials;
}

const IDEMPOTENT = new Set<HttpMethod>(['GET', 'PUT', 'DELETE']);

/** Bytes received so far and the declared total (`null` when unknown or compressed). */
export type ProgressListener = (received: number, total: number | null) => void;

/** A response body as received, with what the server declared about it. */
export interface ApiBytes {
  bytes: Uint8Array;
  /** `Content-Length` when the body was not content-encoded, else `null`. */
  declaredLength: number | null;
  etag: string | null;
  contentType: string | null;
}

/**
 * The one HTTP entry point to the API: fetch with a timeout, an `X-Request-ID` per call, RFC 9457
 * problems as `ApiError`, one retry after a recoverable 401 (refresh or new CSRF token) and one
 * retry after a short 429 on idempotent methods. Longer 429s surface with `retryAfterSeconds`
 * and set `rateLimitedUntil` for the UI.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly baseUrl = inject(API_BASE_URL);
  private readonly fetchFn = inject(FETCH);
  private readonly options = inject(API_CLIENT_OPTIONS);
  private readonly strategy = inject(AUTH_STRATEGY);

  private readonly inFlight = signal(0);
  private readonly limitedUntil = signal<number | null>(null);

  /** True while at least one request is running. */
  readonly busy = computed(() => this.inFlight() > 0);
  /** Epoch milliseconds until which the last 429 asked the client to wait, or null. */
  readonly rateLimitedUntil = this.limitedUntil.asReadonly();

  async request<T, P extends ApiPathTemplate = ApiPathTemplate>(req: ApiRequest<P>): Promise<T> {
    this.inFlight.update((n) => n + 1);
    try {
      return await this.run<T, P>(req, readBody);
    } finally {
      this.inFlight.update((n) => n - 1);
    }
  }

  /**
   * Like `request`, but returns the raw body bytes with the length and validator headers, and
   * reports progress while the body streams in. Used for offline pack and tile downloads, which
   * are stored and verified as received.
   */
  async requestBytes<P extends ApiPathTemplate = ApiPathTemplate>(
    req: ApiRequest<P>,
    onProgress?: ProgressListener,
    maxBytes?: number,
  ): Promise<ApiBytes> {
    this.inFlight.update((n) => n + 1);
    try {
      return await this.run<ApiBytes, P>(req, (response, requestId) =>
        readBytes(response, onProgress, maxBytes, requestId),
      );
    } finally {
      this.inFlight.update((n) => n - 1);
    }
  }

  private async run<T, P extends ApiPathTemplate>(
    req: ApiRequest<P>,
    read: (response: Response, requestId: string) => Promise<T>,
  ): Promise<T> {
    const url = this.baseUrl + buildPath(req.path, req.params) + buildQuery(req.query);
    const requestId = newRequestId();
    const useAuth = req.auth !== false;
    let authRetried = false;
    let rateRetried = false;
    let failedAttempt: { session: number; error: ApiError } | null = null;

    for (;;) {
      if (failedAttempt !== null && !this.strategy.isCurrentSession(failedAttempt.session)) {
        throw failedAttempt.error;
      }
      const headers = new Headers({ Accept: 'application/json', ...req.headers });
      headers.set(REQUEST_ID_HEADER, requestId);
      if (req.body !== undefined) headers.set('Content-Type', 'application/json');
      let attempt: AuthAttempt | null = null;
      if (useAuth) attempt = await this.strategy.authorize(req.method, headers);
      if (failedAttempt !== null && attempt?.session !== failedAttempt.session) {
        throw failedAttempt.error;
      }

      const result = await send(
        this.fetchFn,
        url,
        {
          method: req.method,
          headers,
          body: req.body === undefined ? undefined : JSON.stringify(req.body),
          credentials: req.credentials ?? this.strategy.credentials,
        },
        { timeoutMs: req.timeoutMs ?? this.options.timeoutMs, signal: req.signal, requestId },
        async (response) => {
          if (response.ok) {
            return { ok: true as const, value: await read(response, requestId) };
          }
          return {
            ok: false as const,
            error: await ApiError.fromResponse(response, requestId, this.options.now()),
          };
        },
      );

      if (result.ok) return result.value;

      const error = result.error;
      const authFailure =
        error.status === 401 || (error.status === 403 && error.code === 'csrf.invalid');
      if (authFailure && attempt !== null && !authRetried) {
        authRetried = true;
        failedAttempt = { session: attempt.session, error };
        if (await this.strategy.recover(error, attempt)) continue;
        throw error;
      }
      if (error.status === 429) {
        const wait = error.retryAfterSeconds;
        if (wait !== null) this.limitedUntil.set(this.options.now() + wait * 1000);
        if (
          !rateRetried &&
          IDEMPOTENT.has(req.method) &&
          wait !== null &&
          wait <= this.options.maxAutoRetryAfterSeconds
        ) {
          rateRetried = true;
          await this.options.sleep(wait * 1000);
          continue;
        }
      }
      throw error;
    }
  }
}

function buildPath(template: string, params?: Readonly<Record<string, string>>): string {
  return template.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = params?.[name];
    if (value === undefined || value === '') {
      throw new Error(`missing path parameter ${name}`);
    }
    return encodeURIComponent(value);
  });
}

function buildQuery(query?: Readonly<Record<string, QueryValue>>): string {
  if (!query) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) search.append(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/**
 * Streams the body and reports progress. A content-encoded body is decoded by the browser, so
 * its `Content-Length` (the encoded size) is not comparable and is reported as unknown.
 */
async function readBytes(
  response: Response,
  onProgress?: ProgressListener,
  maxBytes = Number.MAX_SAFE_INTEGER,
  requestId = '',
): Promise<ApiBytes> {
  const encoding = response.headers.get('Content-Encoding');
  const rawLength = response.headers.get('Content-Length');
  const parsed = rawLength !== null && /^\d+$/.test(rawLength) ? Number(rawLength) : null;
  const declaredLength = encoding && encoding !== 'identity' ? null : parsed;
  const limit = Math.min(maxBytes, declaredLength ?? maxBytes);
  const oversize = () =>
    new ApiError('invalid_response', response.status, 'body_too_large', requestId);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw oversize();
  if (parsed !== null && parsed > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw oversize();
  }
  const meta = {
    declaredLength,
    etag: response.headers.get('ETag'),
    contentType: response.headers.get('Content-Type'),
  };
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > limit) throw oversize();
    onProgress?.(bytes.length, declaredLength);
    return { bytes, ...meta };
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  onProgress?.(0, declaredLength);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > limit) throw oversize();
      chunks.push(value);
      onProgress?.(received, declaredLength);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, ...meta };
}

async function readBody<T>(response: Response, requestId: string): Promise<T> {
  if (response.status === 204 || response.status === 205) return undefined as T;
  const text = await response.text();
  if (text === '') return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError('invalid_response', response.status, 'invalid_response', requestId);
  }
}
