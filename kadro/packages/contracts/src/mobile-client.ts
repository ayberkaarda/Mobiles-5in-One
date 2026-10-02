import { AUTH_CLIENT_HEADER } from './auth.js';
import { ERROR_CODES, type ErrorCode } from './problem.js';

/**
 * Contract between the mobile app and the API (ADR-0014, ADR-0019, ADR-0045, ADR-0063). The
 * server side of every rule already exists; these constants let the app state the same rules in
 * code and tests instead of restating them in prose.
 *
 * - Every request sends `x-kadro-client: mobile` and never an `Origin` header (400 otherwise).
 * - Authenticated requests send `Authorization: Bearer <access JWT>`; the access token lives
 *   15 minutes and the refresh token 30 days, both in `expo-secure-store` only.
 * - Refresh is single-flight: concurrent 401 `unauthenticated` responses share one
 *   `POST auth/refresh`; a rotated token presented twice revokes the whole family (ADR-0019).
 *   After one refresh the original request is retried once; a second 401 signs the user out.
 * - Problem responses are mapped by `code` to the app's `errors.json` copy, never by `title`,
 *   `detail` or status alone.
 * - The RevenueCat `app_user_id` is `users.id` (see `revenueCatAppUserId`).
 */

export const MOBILE_CLIENT_HEADERS = { [AUTH_CLIENT_HEADER]: 'mobile' } as const;

/** Lifetimes the app plans with; the server values come from configuration with these defaults. */
export const MOBILE_TOKEN_LIFETIMES = {
  accessTokenSeconds: 900,
  refreshTokenSeconds: 2_592_000,
} as const;

/** Codes after which the app runs one single-flight refresh and retries the request once. */
export const MOBILE_REFRESH_TRIGGER_CODES = [
  'unauthenticated',
] as const satisfies readonly ErrorCode[];

/** Codes after which the app discards its tokens and returns to sign-in without a refresh. */
export const MOBILE_SIGN_OUT_CODES = [
  'account_deactivated',
] as const satisfies readonly ErrorCode[];

/** True for a string the API can send as problem `code`. */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

/** What the app does with a problem response, decided by `code` only. */
export type MobileProblemAction = 'refresh' | 'signOut' | 'show';

export function mobileProblemAction(code: ErrorCode): MobileProblemAction {
  if ((MOBILE_REFRESH_TRIGGER_CODES as readonly ErrorCode[]).includes(code)) {
    return 'refresh';
  }
  if ((MOBILE_SIGN_OUT_CODES as readonly ErrorCode[]).includes(code)) {
    return 'signOut';
  }
  return 'show';
}
