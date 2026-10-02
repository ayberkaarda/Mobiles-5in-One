import { AUTH_CLIENT_HEADER, CSRF_HEADER, ERROR_CODES, type ErrorCode } from '@kadro/contracts';

/**
 * Minimal same-origin transport for the web pages (ADR-0014, ADR-0040 "Headers and CSP").
 * Requests go to fixed `/api/v1` paths on the page's own origin with `x-kadro-client: web`; the
 * CSRF header is added only for cookie-authenticated mutations. Response handling reduces every
 * answer to an {@link ApiOutcome}; the page never shows server text.
 */

/** Every endpoint the web pages call. Paths are constants, never built from input. */
export const PAGE_ENDPOINTS = {
  verifyEmail: '/api/v1/auth/verify-email',
  reset: '/api/v1/auth/reset',
  forgot: '/api/v1/auth/forgot',
  login: '/api/v1/auth/login',
  deleteAccount: '/api/v1/me',
} as const;
export type PageEndpoint = keyof typeof PAGE_ENDPOINTS;

const TARGETS: ReadonlyMap<PageEndpoint, { readonly path: string; readonly method: string }> =
  new Map([
    ['verifyEmail', { path: PAGE_ENDPOINTS.verifyEmail, method: 'POST' }],
    ['reset', { path: PAGE_ENDPOINTS.reset, method: 'POST' }],
    ['forgot', { path: PAGE_ENDPOINTS.forgot, method: 'POST' }],
    ['login', { path: PAGE_ENDPOINTS.login, method: 'POST' }],
    ['deleteAccount', { path: PAGE_ENDPOINTS.deleteAccount, method: 'DELETE' }],
  ]);

export interface ApiRequest {
  readonly url: string;
  readonly init: RequestInit;
}

/**
 * Builds the request for `endpoint`. `csrfToken` is required by signed-in mutations
 * (`deleteAccount`) and must not be sent to the unauthenticated auth entry points.
 */
export function buildApiRequest(
  endpoint: PageEndpoint,
  body: Readonly<Record<string, unknown>>,
  csrfToken?: string,
): ApiRequest {
  const target = TARGETS.get(endpoint);
  if (target === undefined) {
    throw new TypeError('unknown endpoint');
  }
  const headers = new Headers({
    accept: 'application/json',
    'content-type': 'application/json',
  });
  headers.set(AUTH_CLIENT_HEADER, 'web');
  if (endpoint === 'deleteAccount') {
    if (csrfToken === undefined || csrfToken === '') {
      throw new TypeError('deleteAccount needs the CSRF token');
    }
    headers.set(CSRF_HEADER, csrfToken);
  }
  return {
    url: target.path,
    init: {
      method: target.method,
      headers,
      body: JSON.stringify(body),
      credentials: 'same-origin',
      mode: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    },
  };
}

export type ApiOutcome =
  | { readonly kind: 'ok'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'rate_limited'; readonly retryAfterSeconds: number | null }
  | { readonly kind: 'problem'; readonly status: number; readonly code: ErrorCode | null }
  | { readonly kind: 'network' };

const KNOWN_CODES: ReadonlySet<string> = new Set(ERROR_CODES);

/** Seconds from a `Retry-After` value (delta-seconds or HTTP date), or `null` when unusable. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (/^\d{1,9}$/.test(trimmed)) {
    return Number(trimmed);
  }
  // IMF-fixdate only ("Thu, 01 Oct 2026 10:02:00 GMT"); other strings are not trusted as dates.
  const date = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(trimmed)
    ? Date.parse(trimmed)
    : Number.NaN;
  if (Number.isNaN(date)) {
    return null;
  }
  return Math.max(0, Math.ceil((date - now) / 1000));
}

function problemCode(body: unknown): ErrorCode | null {
  if (typeof body !== 'object' || body === null || !('code' in body)) {
    return null;
  }
  const code = (body as { code: unknown }).code;
  return typeof code === 'string' && KNOWN_CODES.has(code) ? (code as ErrorCode) : null;
}

/** Reduces a status, headers and parsed body to an outcome. */
export function interpretResponse(
  status: number,
  headers: Pick<Headers, 'get'>,
  body: unknown,
  now: number = Date.now(),
): ApiOutcome {
  if (status >= 200 && status < 300) {
    return { kind: 'ok', status, body };
  }
  if (status === 429) {
    return {
      kind: 'rate_limited',
      retryAfterSeconds: parseRetryAfter(headers.get('retry-after'), now),
    };
  }
  return { kind: 'problem', status, code: problemCode(body) };
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

async function readBody(response: Response): Promise<unknown> {
  const type = response.headers.get('content-type') ?? '';
  if (response.status === 204 || !/json/i.test(type)) {
    return null;
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/** Sends a request built by {@link buildApiRequest}; network failures become `network`. */
export async function sendApiRequest(
  fetchImpl: FetchLike,
  request: ApiRequest,
): Promise<ApiOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(request.url, request.init);
  } catch {
    return { kind: 'network' };
  }
  return interpretResponse(response.status, response.headers, await readBody(response));
}
