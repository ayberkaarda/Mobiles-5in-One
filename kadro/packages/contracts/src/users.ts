import { z } from 'zod';

import {
  compactJwsSchema,
  currentPasswordSchema,
  displayNameSchema,
  idSchema,
  isoDateTimeSchema,
} from './common.js';
import { LIMITS } from './limits.js';
import { platformRoleSchema } from './roles.js';

/** Preferred field position (`users.position`). */
export const POSITIONS = ['GK', 'DEF', 'MID', 'FWD'] as const;
export const positionSchema = z.enum(POSITIONS);
export type Position = z.infer<typeof positionSchema>;

/** Self-declared skill level (`users.level`), also used by open calls (spec §3 story 6). */
export const LEVELS = ['casual', 'regular', 'competitive'] as const;
export const levelSchema = z.enum(LEVELS);
export type Level = z.infer<typeof levelSchema>;

/**
 * Public projection of another user: what teammates, match participants and review readers see.
 * Never contains email, district, provider identifiers or role.
 */
export const userPublicSchema = z.strictObject({
  id: idSchema,
  displayName: displayNameSchema,
  avatarUrl: z.url({ protocol: /^https$/ }).nullable(),
  position: positionSchema.nullable(),
  level: levelSchema.nullable(),
});
export type UserPublic = z.infer<typeof userPublicSchema>;

/**
 * Narrower projection for match guests (authorization matrix footnote 11): display name, avatar
 * and position of the other participants only.
 */
export const userCardSchema = userPublicSchema.pick({
  id: true,
  displayName: true,
  avatarUrl: true,
  position: true,
});
export type UserCard = z.infer<typeof userCardSchema>;

/** Sign-in methods linked to the account. Provider subject identifiers are never exposed. */
export const linkedProvidersSchema = z.strictObject({
  password: z.boolean(),
  apple: z.boolean(),
  google: z.boolean(),
});
export type LinkedProviders = z.infer<typeof linkedProvidersSchema>;

/** `GET /api/v1/me`: the caller's own profile. */
export const meResponseSchema = z.strictObject({
  ...userPublicSchema.shape,
  email: z.email(),
  emailVerified: z.boolean(),
  role: platformRoleSchema,
  districtId: idSchema.nullable(),
  providers: linkedProvidersSchema,
  createdAt: isoDateTimeSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/**
 * `PATCH /api/v1/me` body. Only the self-writable fields of authorization-matrix §4.1 are
 * accepted; any other key (role, email, avatarKey, ...) is rejected. `null` clears a field;
 * `avatar: null` removes the avatar, which is otherwise set only by the upload worker
 * (ADR-0030). The handler must additionally verify that `districtId` references an existing
 * district.
 */
export const updateMeRequestSchema = z
  .strictObject({
    displayName: displayNameSchema.optional(),
    position: positionSchema.nullable().optional(),
    level: levelSchema.nullable().optional(),
    districtId: idSchema.nullable().optional(),
    avatar: z.null().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'must contain at least one field');
export type UpdateMeRequest = z.infer<typeof updateMeRequestSchema>;

export const PUSH_PLATFORMS = ['ios', 'android'] as const;
export const pushPlatformSchema = z.enum(PUSH_PLATFORMS);
export type PushPlatform = z.infer<typeof pushPlatformSchema>;

/** `POST /api/v1/me/push-tokens` body. The owning user always comes from the session. */
export const registerPushTokenRequestSchema = z.strictObject({
  expoToken: z
    .string()
    .max(LIMITS.expoPushToken.max)
    .regex(/^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$/, 'must be an Expo push token'),
  platform: pushPlatformSchema,
});
export type RegisterPushTokenRequest = z.infer<typeof registerPushTokenRequestSchema>;

const totpCodeSchema = z
  .string()
  .length(LIMITS.totpCode.length)
  .regex(/^[0-9]+$/, 'must be digits');

export const IDENTITY_PROVIDERS = ['apple', 'google'] as const;
export const identityProviderSchema = z.enum(IDENTITY_PROVIDERS);
export type IdentityProvider = z.infer<typeof identityProviderSchema>;

/**
 * `DELETE /api/v1/me` body: starts account deletion (security checklist item 21, ADR-0032).
 * Re-authentication proof (authorization matrix footnote 4), exactly one of:
 * - `password`: the current password of a password account;
 * - `provider` + `identityToken`: an Apple / Google identity token issued at most five minutes
 *   earlier, for social-only accounts; Apple tokens are nonce-bound, so `nonce` is required with
 *   `provider: 'apple'` (optional for Google, as at sign-in).
 * Staff accounts must also send a fresh `totpCode` (footnote 5). A proof is single-use. The
 * account is deactivated at once; signing in again before `graceUntil` cancels the deletion
 * (ADR-0012).
 */
export const deleteAccountRequestSchema = z
  .strictObject({
    password: currentPasswordSchema.optional(),
    provider: identityProviderSchema.optional(),
    identityToken: compactJwsSchema.optional(),
    nonce: z
      .string()
      .min(LIMITS.nonce.min)
      .max(LIMITS.nonce.max)
      .regex(/^[A-Za-z0-9._~-]+$/, 'must be URL-safe')
      .optional(),
    totpCode: totpCodeSchema.optional(),
  })
  .refine(
    (body) =>
      body.password !== undefined
        ? body.provider === undefined &&
          body.identityToken === undefined &&
          body.nonce === undefined
        : body.provider !== undefined && body.identityToken !== undefined,
    { message: 'send either password or provider with identityToken', path: ['password'] },
  )
  .refine((body) => body.provider !== 'apple' || body.nonce !== undefined, {
    message: 'nonce is required for Apple identity tokens',
    path: ['nonce'],
  });
export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;

/** `DELETE /api/v1/me` 202 response. Every session is revoked; the client signs out locally. */
export const deleteAccountResponseSchema = z.strictObject({
  graceUntil: isoDateTimeSchema,
});
export type DeleteAccountResponse = z.infer<typeof deleteAccountResponseSchema>;
