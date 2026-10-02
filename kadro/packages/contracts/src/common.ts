import { z } from 'zod';

import { LIMITS } from './limits.js';

/** Primary keys are UUIDv7. They are time-ordered and therefore never treated as secrets. */
export const idSchema = z.uuid({ version: 'v7' });
export type Id = z.infer<typeof idSchema>;

export const isoDateTimeSchema = z.iso.datetime({ offset: true });

/** Email input is trimmed and lower-cased before validation so lookups stay case-insensitive. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(LIMITS.email.max));

/** Password for registration and reset. Length only; breach screening happens server-side. */
export const newPasswordSchema = z
  .string()
  .min(LIMITS.password.min, `must be at least ${LIMITS.password.min} characters`)
  .max(LIMITS.password.max);

/**
 * Password presented at login. Only the upper bound is enforced so that the response for a
 * too-short password is the same generic `invalid_credentials` as for a wrong one.
 */
export const currentPasswordSchema = z.string().min(1).max(LIMITS.password.max);

/** Control and format characters (including bidi overrides) are not allowed in visible names. */
const VISIBLE_TEXT = /^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*$/u;

/**
 * Trimmed single-line user text between `min` and `max` characters without control or format
 * characters. Used for every visible name (teams, venues, free-text venue of a match).
 */
export function visibleTextSchema(min: number, max: number) {
  return z
    .string()
    .trim()
    .min(min)
    .max(max)
    .regex(VISIBLE_TEXT, 'must not contain control characters');
}

/**
 * Trimmed multi-line user text up to `max` characters. Carriage returns are normalized to line
 * feeds; other control and format characters are rejected. Clients render it as plain text.
 */
export function multilineTextSchema(max: number) {
  return z
    .string()
    .transform((value) => value.replace(/\r\n?/g, '\n').trim())
    .pipe(
      z
        .string()
        .min(1)
        .max(max)
        .refine(
          (value) => value.split('\n').every((line) => VISIBLE_TEXT.test(line)),
          'must not contain control characters',
        ),
    );
}

/** Absolute `https` URL in a response (public object URLs, invite links, presigned uploads). */
export const httpsUrlSchema = z.url({ protocol: /^https$/ });

export const displayNameSchema = z
  .string()
  .trim()
  .min(LIMITS.displayName.min)
  .max(LIMITS.displayName.max)
  .regex(VISIBLE_TEXT, 'must not contain control characters');

export const deviceLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.deviceLabel.max)
  .regex(VISIBLE_TEXT, 'must not contain control characters');

/** Opaque server-issued token (refresh, email verification, password reset), base64url. */
export const opaqueTokenSchema = z
  .string()
  .min(LIMITS.opaqueToken.min)
  .max(LIMITS.opaqueToken.max)
  .regex(/^[A-Za-z0-9_-]+$/, 'must be a base64url token');

/** Compact JWS (three base64url segments) as issued by Apple or Google. */
export const compactJwsSchema = z
  .string()
  .max(LIMITS.identityToken.max)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'must be a compact JWS');

/** Response body for endpoints that intentionally reveal nothing (forgot, register). */
export const acceptedResponseSchema = z.strictObject({
  status: z.literal('accepted'),
});
export type AcceptedResponse = z.infer<typeof acceptedResponseSchema>;
