/**
 * Failure of an API call.
 * - `problem`: the server answered with an error status (RFC 9457 body when `code` is set).
 * - `network`: no response (offline, DNS, TLS, connection reset).
 * - `timeout`: no response within the client time limit.
 * - `invalid_response`: a success status with an unreadable body, or a response that did not come
 *   from the configured API origin.
 */
export type ApiErrorKind = 'problem' | 'network' | 'timeout' | 'invalid_response';

export interface ApiFieldError {
  readonly path: string;
  readonly issue: string;
}

interface ApiErrorInit {
  readonly kind: ApiErrorKind;
  readonly status?: number | null;
  readonly code?: string | null;
  readonly requestId?: string | null;
  readonly fieldErrors?: readonly ApiFieldError[];
  readonly cause?: unknown;
}

function summary(init: ApiErrorInit): string {
  return ['API', init.kind, init.status, init.code]
    .filter((part) => part !== undefined && part !== null)
    .join(' ');
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  /** Stable problem code (`ERROR_CODES` in `@kadro/contracts`), or `null` when there is none. */
  readonly code: string | null;
  readonly requestId: string | null;
  readonly fieldErrors: readonly ApiFieldError[];

  constructor(init: ApiErrorInit) {
    // The message carries no server text, so the error is safe to log.
    super(summary(init), { cause: init.cause });
    this.name = 'ApiError';
    this.kind = init.kind;
    this.status = init.status ?? null;
    this.code = init.code ?? null;
    this.requestId = init.requestId ?? null;
    this.fieldErrors = init.fieldErrors ?? [];
  }

  /** The request is rejected as such; repeating it unchanged gives the same answer. */
  get isClientError(): boolean {
    return (
      this.kind === 'problem' && this.status !== null && this.status >= 400 && this.status < 500
    );
  }
}

const CODE_PATTERN = /^[a-z][a-z_]{0,63}$/;
const MAX_REQUEST_ID = 128;
const MAX_FIELD_ERRORS = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readFieldErrors(value: unknown): ApiFieldError[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .slice(0, MAX_FIELD_ERRORS)
    .filter(
      (entry): entry is ApiFieldError =>
        isRecord(entry) &&
        typeof entry.path === 'string' &&
        entry.path.length <= 200 &&
        typeof entry.issue === 'string' &&
        CODE_PATTERN.test(entry.issue),
    )
    .map((entry) => ({ path: entry.path, issue: entry.issue }));
}

/**
 * Reads an RFC 9457 problem body (`{type, title, status, code, requestId, errors?}`). Only the
 * machine fields are kept; `title` and `detail` are dropped so server prose never reaches the UI.
 * A body that is not a problem document yields an error with `code: null`.
 */
export function problemFromResponse(status: number, body: unknown): ApiError {
  if (!isRecord(body)) {
    return new ApiError({ kind: 'problem', status });
  }
  const code = typeof body.code === 'string' && CODE_PATTERN.test(body.code) ? body.code : null;
  const requestId =
    typeof body.requestId === 'string' &&
    body.requestId.length > 0 &&
    body.requestId.length <= MAX_REQUEST_ID
      ? body.requestId
      : null;
  return new ApiError({
    kind: 'problem',
    status,
    code,
    requestId,
    fieldErrors: readFieldErrors(body.errors),
  });
}

/** 401 from an endpoint that needs a session: the session is gone and the user must sign in. */
export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'problem' && error.status === 401;
}
