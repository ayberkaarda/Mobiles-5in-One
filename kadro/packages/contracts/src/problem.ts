import { z } from 'zod';

import { slugSchema } from './districts.js';

/**
 * Stable machine-readable error codes. Clients map each code to localized copy
 * (`apps/mobile` i18n `errors.json`); the server never sends user-facing prose that depends on
 * internal state. Codes and their statuses follow docs/security/authorization-matrix.md §2.
 */
export const ERROR_CODES = [
  'validation_failed',
  'payload_too_large',
  'unsupported_media_type',
  'unauthenticated',
  'invalid_credentials',
  'token_invalid',
  'account_deactivated',
  'step_up_required',
  'reauth_required',
  'forbidden',
  'csrf_failed',
  'email_unverified',
  'entitlement_required',
  'not_found',
  'method_not_allowed',
  'conflict',
  'account_link_required',
  'password_breached',
  'captain_must_transfer',
  'team_has_history',
  'last_admin',
  'match_full',
  'totp_not_enrolled',
  'match_terms_frozen',
  'lineup_invalid_player',
  'already_applied',
  'application_not_pending',
  'call_closed',
  'match_not_open',
  'already_participant',
  'invalid_status_transition',
  'match_state_conflict',
  'slots_below_confirmed',
  'slots_below_lineup',
  'player_not_confirmed',
  'mvp_vote_closed',
  'already_voted',
  'invalid_votee',
  'open_call_exists',
  'invalid_missing_count',
  'invalid_call_expiry',
  'already_reviewed',
  'deletion_pending',
  'invite_limit',
  'lineup_side_full',
  'review_not_eligible',
  'venue_exists',
  'upload_not_pending',
  'invalid_cursor',
  'rate_limited',
  'internal_error',
  'service_unavailable',
] as const;
export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Default HTTP status for each error code. `ApiError` uses this so code and status never disagree. */
export const ERROR_STATUS = {
  validation_failed: 400,
  payload_too_large: 413,
  unsupported_media_type: 415,
  unauthenticated: 401,
  invalid_credentials: 401,
  token_invalid: 401,
  account_deactivated: 401,
  step_up_required: 401,
  reauth_required: 401,
  forbidden: 403,
  csrf_failed: 403,
  email_unverified: 403,
  entitlement_required: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  account_link_required: 409,
  password_breached: 422,
  captain_must_transfer: 409,
  team_has_history: 409,
  last_admin: 409,
  match_full: 409,
  totp_not_enrolled: 409,
  match_terms_frozen: 409,
  lineup_invalid_player: 409,
  already_applied: 409,
  application_not_pending: 409,
  call_closed: 409,
  match_not_open: 409,
  already_participant: 409,
  invalid_status_transition: 409,
  match_state_conflict: 409,
  slots_below_confirmed: 409,
  slots_below_lineup: 409,
  player_not_confirmed: 409,
  mvp_vote_closed: 409,
  already_voted: 409,
  invalid_votee: 409,
  open_call_exists: 409,
  invalid_missing_count: 409,
  invalid_call_expiry: 409,
  already_reviewed: 409,
  deletion_pending: 409,
  invite_limit: 409,
  lineup_side_full: 409,
  review_not_eligible: 403,
  venue_exists: 409,
  upload_not_pending: 409,
  invalid_cursor: 400,
  rate_limited: 429,
  internal_error: 500,
  service_unavailable: 503,
} as const satisfies Record<ErrorCode, number>;

/**
 * Fixed, generic English `title` for each code (RFC 9457). Clients localize by `code`, never by
 * `title`; the API serves exactly these strings so a title can never carry internal state.
 */
export const ERROR_TITLES = {
  validation_failed: 'Request validation failed',
  payload_too_large: 'Request body too large',
  unsupported_media_type: 'Unsupported media type',
  unauthenticated: 'Authentication required',
  invalid_credentials: 'Invalid credentials',
  token_invalid: 'Token invalid or expired',
  account_deactivated: 'Account deactivated',
  step_up_required: 'Step-up authentication required',
  reauth_required: 'Re-authentication required',
  forbidden: 'Forbidden',
  csrf_failed: 'CSRF validation failed',
  email_unverified: 'Email address not verified',
  entitlement_required: 'Subscription required',
  not_found: 'Not found',
  method_not_allowed: 'Method not allowed',
  conflict: 'Conflict',
  account_link_required: 'Account linking required',
  password_breached: 'Password found in a data breach',
  captain_must_transfer: 'Captaincy must be transferred first',
  team_has_history: 'Team has played matches and other members',
  last_admin: 'Last administrator',
  match_full: 'Match is full',
  totp_not_enrolled: 'TOTP not enrolled',
  match_terms_frozen: 'Match terms are frozen',
  lineup_invalid_player: 'Lineup contains an ineligible player',
  already_applied: 'Already applied',
  application_not_pending: 'Application is not pending',
  call_closed: 'Open call closed',
  match_not_open: 'Match is not open',
  already_participant: 'Already a participant',
  invalid_status_transition: 'Status transition not allowed',
  match_state_conflict: 'Match status does not allow this action',
  slots_below_confirmed: 'Slots cannot drop below the confirmed players',
  slots_below_lineup: 'Slots too few for the current lineup sides',
  player_not_confirmed: 'Player is not confirmed for this match',
  mvp_vote_closed: 'MVP voting is closed',
  already_voted: 'Already voted',
  invalid_votee: 'Invalid MVP candidate',
  open_call_exists: 'Match already has an open call',
  invalid_missing_count: 'Missing player count exceeds free slots',
  invalid_call_expiry: 'Open call must expire before the match starts',
  already_reviewed: 'Venue already reviewed',
  deletion_pending: 'Account deletion already pending',
  invite_limit: 'Too many active invites',
  lineup_side_full: 'Lineup side is full',
  review_not_eligible: 'Review requires a played match at this venue',
  venue_exists: 'Venue already exists',
  upload_not_pending: 'Upload is not pending',
  invalid_cursor: 'Invalid pagination cursor',
  rate_limited: 'Too many requests',
  internal_error: 'Internal server error',
  service_unavailable: 'Service unavailable',
} as const satisfies Record<ErrorCode, string>;

export const PROBLEM_TYPE_BASE = 'https://kadro.app/problems/';

/** RFC 9457 `type` URI for a code, e.g. `https://kadro.app/problems/not_found`. */
export function problemTypeFor(code: ErrorCode): string {
  return `${PROBLEM_TYPE_BASE}${code}`;
}

/**
 * One failed field of a `validation_failed` response. `path` is the dotted location
 * (`displayName`, `items.0.id`) and `issue` the zod issue code. Input values are never echoed.
 */
export const problemFieldErrorSchema = z.strictObject({
  path: z.string().max(200),
  issue: z.string().regex(/^[a-z][a-z_]{0,63}$/),
});
export type ProblemFieldError = z.infer<typeof problemFieldErrorSchema>;

/**
 * RFC 9457 problem details as returned by every `/api/v1` error response.
 * `code` is the stable identifier clients switch on; `requestId` correlates the response with
 * server logs. No stack traces, SQL, file paths or input values are ever included.
 */
export const problemDetailsSchema = z
  .strictObject({
    type: z.url({ protocol: /^https$/ }),
    title: z.string().min(1).max(200),
    status: z.number().int().min(400).max(599),
    code: errorCodeSchema,
    requestId: z.string().min(1).max(128),
    detail: z.string().max(500).optional(),
    errors: z.array(problemFieldErrorSchema).max(50).optional(),
    /**
     * RFC 9457 extension member, only on 409 `venue_exists`: slug of the existing venue with the
     * same normalised name in the district, sent only when the caller can read it (ADR-0038).
     */
    existingSlug: slugSchema
      .optional()
      .describe(
        'Only on 409 venue_exists: slug of the existing venue, when readable by the caller (ADR-0038).',
      ),
  })
  .refine((problem) => problem.existingSlug === undefined || problem.code === 'venue_exists', {
    message: 'existingSlug is only allowed with venue_exists',
    path: ['existingSlug'],
  });
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
