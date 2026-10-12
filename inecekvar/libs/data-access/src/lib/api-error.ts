/**
 * Typed failure of an API call. Server errors follow RFC 9457 (spec section 6.13): the body has
 * `type`, `title`, `status`, `code`, `request_id` and an optional fixed `detail`. The client maps
 * `code` to copy; the message never contains a body, a token or user input.
 */
export type ApiErrorKind =
  /** A problem+json body from the API. */
  | 'problem'
  /** HTTP 429; `retryAfterSeconds` says when to try again. */
  | 'rate_limited'
  /** A non-2xx answer without a problem body (proxy page, empty body). */
  | 'http'
  /** No answer: offline, DNS, refused connection, CORS rejection. */
  | 'network'
  /** No answer within the client timeout. */
  | 'timeout'
  /** The caller cancelled the request. */
  | 'aborted'
  /** A 2xx answer whose body could not be read as the expected JSON. */
  | 'invalid_response';

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  code: string;
  request_id: string;
  detail?: string;
}

export function isProblemBody(value: unknown): value is ProblemBody {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body['type'] === 'string' &&
    typeof body['title'] === 'string' &&
    typeof body['status'] === 'number' &&
    typeof body['code'] === 'string' &&
    typeof body['request_id'] === 'string' &&
    (body['detail'] === undefined || typeof body['detail'] === 'string')
  );
}

/** `Retry-After` as delta seconds or an HTTP date; null when absent or unreadable. */
export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - nowMs) / 1000));
}

export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly kind: ApiErrorKind,
    /** HTTP status, 0 when no response arrived. */
    readonly status: number,
    /** Stable machine code, for example `auth.required`, `csrf.invalid`, `network`. */
    readonly code: string,
    /** Request id from the problem body, the response header or the one the client sent. */
    readonly requestId: string,
    readonly detail: string | null = null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(status > 0 ? `${code} (HTTP ${status})` : code);
  }

  /** Reads a non-2xx response into an error; never throws. */
  static async fromResponse(
    response: Response,
    sentRequestId: string,
    nowMs: number,
  ): Promise<ApiError> {
    const headerId = response.headers.get('X-Request-ID');
    const retryAfter = parseRetryAfter(response.headers.get('Retry-After'), nowMs);
    let problem: ProblemBody | null = null;
    const contentType = response.headers.get('Content-Type') ?? '';
    if (contentType.includes('json')) {
      try {
        const body: unknown = await response.json();
        if (isProblemBody(body)) problem = body;
      } catch {
        problem = null;
      }
    }
    const status = response.status;
    const kind: ApiErrorKind = status === 429 ? 'rate_limited' : problem ? 'problem' : 'http';
    const code = problem?.code ?? (status === 429 ? 'rate_limited' : `http.${status}`);
    return new ApiError(
      kind,
      status,
      code,
      problem?.request_id ?? headerId ?? sentRequestId,
      problem?.detail ?? null,
      retryAfter,
    );
  }

  static noResponse(kind: 'network' | 'timeout' | 'aborted', requestId: string): ApiError {
    return new ApiError(kind, 0, kind, requestId);
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
