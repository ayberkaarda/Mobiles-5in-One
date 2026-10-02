import {
  ERROR_STATUS,
  ERROR_TITLES,
  type ErrorCode,
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
  type ProblemFieldError,
  problemTypeFor,
} from '@kadro/contracts';

/**
 * Terse API errors (security checklist item 13). Every `/api/v1` failure is an RFC 9457 problem
 * body `{ type, title, status, code, requestId }`, optionally with field `errors` on
 * `validation_failed`. Titles are fixed per code; nothing derived from internal state (stack
 * traces, SQL, constraint names, file paths, input values) ever reaches a response.
 */

/**
 * Fixed, generic English titles, owned by `@kadro/contracts` so code list and titles cannot drift.
 * Clients localize by `code`, never by `title`.
 */
export const PROBLEM_TITLES: Readonly<Record<ErrorCode, string>> = ERROR_TITLES;

export interface ApiErrorOptions {
  /** Field-level failures; only for `validation_failed`. Paths and issue codes only, no values. */
  readonly errors?: readonly ProblemFieldError[];
  /** Extra response headers such as `Retry-After` (429) or `WWW-Authenticate` (401). */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * RFC 9457 extension members of `@kadro/contracts` (`existingSlug`, only on `venue_exists`,
   * ADR-0038). Anything the contract does not allow for the code is dropped from the body.
   */
  readonly extensions?: ProblemExtensions;
  /** Underlying error, kept for server-side logging only. */
  readonly cause?: unknown;
}

/**
 * An expected, client-facing failure. The status is always `ERROR_STATUS[code]`, so code and
 * status can never disagree.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly errors: readonly ProblemFieldError[] | undefined;
  readonly headers: Readonly<Record<string, string>>;
  readonly extensions: ProblemExtensions;

  constructor(code: ErrorCode, options: ApiErrorOptions = {}) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApiError';
    this.code = code;
    // eslint-disable-next-line security/detect-object-injection -- code is a typed ErrorCode key
    this.status = ERROR_STATUS[code];
    this.errors = options.errors;
    this.headers = options.headers ?? {};
    this.extensions = options.extensions ?? {};
  }
}

/** Extension members a problem body may carry (`problemDetailsSchema`). */
export type ProblemExtensions = Pick<ProblemDetails, 'existingSlug'>;

/**
 * Builds the problem body for a code. Field errors are capped at the schema maximum (50);
 * `existingSlug` is kept on `venue_exists` only.
 */
export function problemBody(
  code: ErrorCode,
  requestId: string,
  errors?: readonly ProblemFieldError[],
  extensions: ProblemExtensions = {},
): ProblemDetails {
  const body: ProblemDetails = {
    type: problemTypeFor(code),
    // eslint-disable-next-line security/detect-object-injection -- code is a typed ErrorCode key
    title: PROBLEM_TITLES[code],
    // eslint-disable-next-line security/detect-object-injection -- code is a typed ErrorCode key
    status: ERROR_STATUS[code],
    code,
    requestId,
  };
  if (code === 'validation_failed' && errors !== undefined && errors.length > 0) {
    body.errors = errors.slice(0, 50);
  }
  if (code === 'venue_exists' && extensions.existingSlug !== undefined) {
    body.existingSlug = extensions.existingSlug;
  }
  return body;
}

/** Headers present on every API response, success or failure (items 9 and 13). */
export const API_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function problemResponse(error: ApiError, requestId: string): Response {
  const headers = new Headers({
    ...API_RESPONSE_HEADERS,
    ...error.headers,
    'Content-Type': PROBLEM_CONTENT_TYPE,
  });
  return new Response(
    JSON.stringify(problemBody(error.code, requestId, error.errors, error.extensions)),
    {
      status: error.status,
      headers,
    },
  );
}

// ---------------------------------------------------------------------------
// Database errors
// ---------------------------------------------------------------------------

/** The fields of a PostgreSQL error that are safe to use for mapping and logging. */
export interface PgErrorInfo {
  /** SQLSTATE, e.g. `23514`. */
  readonly code: string;
  readonly constraint: string | undefined;
}

const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

/**
 * Finds the PostgreSQL error in a cause chain. Drizzle wraps driver errors in
 * `DrizzleQueryError` (whose message contains the SQL text and bound parameters), with the
 * `pg.DatabaseError` as `cause`. Detection is structural so this module does not depend on `pg`.
 */
export function findPgError(error: unknown): PgErrorInfo | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current !== null && typeof current === 'object'; depth += 1) {
    const candidate = current as { code?: unknown; severity?: unknown; constraint?: unknown };
    if (
      typeof candidate.code === 'string' &&
      SQLSTATE_PATTERN.test(candidate.code) &&
      typeof candidate.severity === 'string'
    ) {
      return {
        code: candidate.code,
        constraint: typeof candidate.constraint === 'string' ? candidate.constraint : undefined,
      };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export const SQLSTATE = {
  uniqueViolation: '23505',
  checkViolation: '23514',
  serializationFailure: '40001',
  deadlockDetected: '40P01',
  queryCanceled: '57014',
} as const;

/**
 * Named constraints and triggers whose violation is an expected domain outcome. The database is
 * the last line of defence behind the domain services; when a race lets a request reach the
 * constraint, the client still receives the documented code instead of a 500.
 */
export const CONSTRAINT_ERROR_CODES: Readonly<Record<string, ErrorCode>> = {
  // ADR-0004: trigger raising 23514 once a match has been locked.
  matches_terms_frozen: 'match_terms_frozen',
  // ADR-0010: one application per user and open call.
  open_call_applications_open_call_id_user_id_key: 'already_applied',
  team_members_team_id_user_id_key: 'already_participant',
  match_rsvps_match_id_user_id_key: 'conflict',
  // handoff contracts-to-web-001 §3 (Phase 2 domain codes).
  open_calls_one_open_per_match_key: 'open_call_exists',
  venue_reviews_venue_id_user_id_key: 'already_reviewed',
  mvp_votes_match_id_voter_id_key: 'already_voted',
  deletion_requests_pending_user_key: 'deletion_pending',
  mvp_votes_no_self_vote: 'invalid_votee',
};

/**
 * Maps a database failure to a safe API error, or returns `null` when the failure is not an
 * expected outcome (the caller then answers 500 `internal_error` and logs the SQLSTATE).
 */
export function apiErrorFromDatabase(error: unknown): ApiError | null {
  const pgError = findPgError(error);
  if (pgError === undefined) {
    return null;
  }
  const mapped =
    pgError.constraint === undefined
      ? undefined
      : Object.hasOwn(CONSTRAINT_ERROR_CODES, pgError.constraint)
        ? CONSTRAINT_ERROR_CODES[pgError.constraint]
        : undefined;
  if (mapped !== undefined) {
    return new ApiError(mapped, { cause: error });
  }
  switch (pgError.code) {
    case SQLSTATE.uniqueViolation:
      return new ApiError('conflict', { cause: error });
    case SQLSTATE.serializationFailure:
    case SQLSTATE.deadlockDetected:
    case SQLSTATE.queryCanceled:
      return new ApiError('service_unavailable', { cause: error, headers: { 'Retry-After': '1' } });
    default:
      return null;
  }
}

/** Normalizes anything thrown by a handler into an `ApiError`; unknown failures become 500. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  return apiErrorFromDatabase(error) ?? new ApiError('internal_error', { cause: error });
}
