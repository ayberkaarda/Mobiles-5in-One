import { z } from 'zod';

import {
  compactJwsSchema,
  idSchema,
  currentPasswordSchema,
  deviceLabelSchema,
  displayNameSchema,
  emailSchema,
  isoDateTimeSchema,
  newPasswordSchema,
  opaqueTokenSchema,
} from './common.js';
import { LIMITS } from './limits.js';
import { meResponseSchema } from './users.js';

/**
 * Every `/auth/*` request carries this header. Its value is stored in `refresh_tokens.client`, so
 * one table holds both kinds of session:
 * - `mobile`: the opaque refresh token travels in request/response bodies, is kept in
 *   `expo-secure-store`, and is paired with a short-lived ES256 access JWT.
 * - `web`: the opaque token is the value of the `__Host-` session cookie (HttpOnly, never in a body)
 *   and is paired with a CSRF token; there is no access JWT.
 * The server rejects a token whose stored `client` differs from the header (a mobile refresh token
 * can never be replayed as a web cookie, and vice versa). A missing or unknown header is 400
 * `validation_failed`.
 */
export const AUTH_CLIENT_HEADER = 'x-kadro-client';
export const AUTH_CLIENTS = ['mobile', 'web'] as const;
export const authClientSchema = z.enum(AUTH_CLIENTS);
export type AuthClient = z.infer<typeof authClientSchema>;

/** `aud` claim of every access JWT issued by the API. */
export const ACCESS_TOKEN_AUDIENCE = 'kadro-api';

/**
 * Claims of the ES256 access JWT (ADR-0012). `sub` is the user id (UUIDv7); `sid` identifies the
 * session or refresh-token family and may be any UUID version (mobile families use UUIDv4).
 * `iss` is the web origin. No other claims are accepted.
 */
export const accessTokenClaimsSchema = z.strictObject({
  sub: idSchema,
  sid: z.uuid(),
  iat: z.number().int().min(0),
  exp: z.number().int().positive(),
  aud: z.literal(ACCESS_TOKEN_AUDIENCE),
  iss: z.string().min(1),
});
export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;

/** Header carrying the CSRF token for cookie-authenticated mutations (double-submit). */
export const CSRF_HEADER = 'x-csrf-token';

const nonceSchema = z
  .string()
  .min(LIMITS.nonce.min)
  .max(LIMITS.nonce.max)
  .regex(/^[A-Za-z0-9._~-]+$/, 'must be URL-safe');

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** `POST /api/v1/auth/register`. Response is `acceptedResponseSchema` whether or not the email exists. */
export const registerRequestSchema = z.strictObject({
  email: emailSchema,
  password: newPasswordSchema,
  displayName: displayNameSchema,
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/** `POST /api/v1/auth/login`. Failure is always the generic `invalid_credentials`. */
export const loginRequestSchema = z.strictObject({
  email: emailSchema,
  password: currentPasswordSchema,
  deviceLabel: deviceLabelSchema.optional(),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * `POST /api/v1/auth/refresh`, `x-kadro-client: mobile`. The presented token is rotated; reuse of
 * a rotated token revokes the whole family.
 */
export const mobileRefreshRequestSchema = z.strictObject({
  refreshToken: opaqueTokenSchema,
});
export type MobileRefreshRequest = z.infer<typeof mobileRefreshRequestSchema>;

/**
 * `POST /api/v1/auth/refresh`, `x-kadro-client: web`. Empty body: the session cookie is the
 * token; the request must carry the CSRF header. The cookie is rotated with the same reuse rule.
 */
export const webRefreshRequestSchema = z.strictObject({});
export type WebRefreshRequest = z.infer<typeof webRefreshRequestSchema>;

/** `POST /api/v1/auth/logout`, mobile: the refresh token to revoke (only that one). */
export const mobileLogoutRequestSchema = z.strictObject({
  refreshToken: opaqueTokenSchema,
});
export type MobileLogoutRequest = z.infer<typeof mobileLogoutRequestSchema>;

/** `POST /api/v1/auth/logout`, web: empty body; the session cookie identifies what to revoke. */
export const webLogoutRequestSchema = z.strictObject({});
export type WebLogoutRequest = z.infer<typeof webLogoutRequestSchema>;

/** Request body schema for refresh / logout, selected by the `x-kadro-client` header value. */
export const REFRESH_REQUEST_SCHEMAS = {
  mobile: mobileRefreshRequestSchema,
  web: webRefreshRequestSchema,
} as const satisfies Record<AuthClient, z.ZodType>;
export const LOGOUT_REQUEST_SCHEMAS = {
  mobile: mobileLogoutRequestSchema,
  web: webLogoutRequestSchema,
} as const satisfies Record<AuthClient, z.ZodType>;

/** `POST /api/v1/auth/verify-email`. Single-use token from the verification email. */
export const verifyEmailRequestSchema = z.strictObject({
  token: opaqueTokenSchema,
});
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

/** `POST /api/v1/auth/forgot`. Always answered with 202 `accepted`; no account enumeration. */
export const forgotPasswordRequestSchema = z.strictObject({
  email: emailSchema,
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

/** `POST /api/v1/auth/reset`. Success revokes every refresh token and session of the user. */
export const resetPasswordRequestSchema = z.strictObject({
  token: opaqueTokenSchema,
  password: newPasswordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

/**
 * `POST /api/v1/auth/apple`. `nonce` is the raw value whose SHA-256 the client passed to Apple;
 * the server checks it against the token's `nonce` claim. Apple sends the user's name only on the
 * first authorization, so `displayName` is optional and used only when creating the account.
 */
export const appleSignInRequestSchema = z.strictObject({
  identityToken: compactJwsSchema,
  nonce: nonceSchema,
  displayName: displayNameSchema.optional(),
  deviceLabel: deviceLabelSchema.optional(),
});
export type AppleSignInRequest = z.infer<typeof appleSignInRequestSchema>;

/** `POST /api/v1/auth/google`. ID token verified against Google JWKS and allowed client ids. */
export const googleSignInRequestSchema = z.strictObject({
  idToken: compactJwsSchema,
  nonce: nonceSchema.optional(),
  deviceLabel: deviceLabelSchema.optional(),
});
export type GoogleSignInRequest = z.infer<typeof googleSignInRequestSchema>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** Credentials issued to mobile clients (access JWT ES256, opaque refresh token). */
export const tokenPairSchema = z.strictObject({
  tokenType: z.literal('Bearer'),
  accessToken: compactJwsSchema,
  accessTokenExpiresAt: isoDateTimeSchema,
  refreshToken: opaqueTokenSchema,
  refreshTokenExpiresAt: isoDateTimeSchema,
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

/** Successful login / provider sign-in for `x-kadro-client: mobile` (stored with client `mobile`). */
export const mobileAuthResponseSchema = z.strictObject({
  user: meResponseSchema,
  tokens: tokenPairSchema,
});
export type MobileAuthResponse = z.infer<typeof mobileAuthResponseSchema>;

/**
 * Successful login / provider sign-in for `x-kadro-client: web` (stored with client `web`). The
 * session token travels only in the HttpOnly cookie; `csrfToken` is echoed in the `x-csrf-token` header on mutations.
 */
export const webAuthResponseSchema = z.strictObject({
  user: meResponseSchema,
  csrfToken: opaqueTokenSchema,
});
export type WebAuthResponse = z.infer<typeof webAuthResponseSchema>;

/** `POST /api/v1/auth/refresh` response for mobile: a new pair; the presented token is spent. */
export const mobileRefreshResponseSchema = z.strictObject({
  tokens: tokenPairSchema,
});
export type MobileRefreshResponse = z.infer<typeof mobileRefreshResponseSchema>;

/** `POST /api/v1/auth/refresh` response for web: the rotated cookie is set; a new CSRF token. */
export const webRefreshResponseSchema = z.strictObject({
  csrfToken: opaqueTokenSchema,
});
export type WebRefreshResponse = z.infer<typeof webRefreshResponseSchema>;
