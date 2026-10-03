import { z } from 'zod';

import {
  compactJwsSchema,
  currentPasswordSchema,
  displayNameSchema,
  idSchema,
  isoDateTimeSchema,
} from './common.js';
import { entitlementsSchema } from './billing.js';
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

/**
 * `GET /api/v1/me`: the caller's own profile. `entitlements` is the server-side Pro state
 * (ADR-0063, ADR-0065) and is part of every profile response, including the `user` of the
 * sign-in responses.
 */
export const meResponseSchema = z.strictObject({
  ...userPublicSchema.shape,
  email: z.email(),
  emailVerified: z.boolean(),
  role: platformRoleSchema,
  districtId: idSchema.nullable(),
  providers: linkedProvidersSchema,
  createdAt: isoDateTimeSchema,
  entitlements: entitlementsSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;

const countSchema = z.int().min(0);
const rateSchema = z.number().min(0).max(1).nullable();

/** Profile statistics every user gets (spec §3 item 9). */
export const basicStatsSchema = z.strictObject({
  /** Matches with status `played` on which the caller's RSVP is `in`. */
  matchesPlayed: countSchema,
  /** Played matches whose closed MVP result names the caller (ties count for every winner). */
  mvpCount: countSchema,
});
export type BasicStats = z.infer<typeof basicStatsSchema>;

/** Advanced statistics, Pro only (authorization matrix §7). */
export const advancedStatsSchema = z.strictObject({
  /** Played matches in the last 30 days. */
  matchesPlayedLast30Days: countSchema,
  /** `mvpCount / matchesPlayed`; `null` without played matches. */
  mvpRate: rateSchema,
  /**
   * Share of the caller's RSVP rows on matches that reached `played` whose status is `in`;
   * `null` without such rows.
   */
  attendanceRate: rateSchema,
  /** Distinct directory venues of the caller's played matches. */
  distinctVenues: countSchema,
  /** Distinct teams of the caller's played matches. */
  distinctTeams: countSchema,
});
export type AdvancedStats = z.infer<typeof advancedStatsSchema>;

/**
 * `GET /api/v1/me/stats`. `tier` follows the caller's server-side entitlement at request time:
 * `basic` for free users, `full` with the advanced block for Pro. Every value is computed on the
 * server from stored rows; the request has no parameters.
 */
export const meStatsResponseSchema = z.discriminatedUnion('tier', [
  z.strictObject({ tier: z.literal('basic'), ...basicStatsSchema.shape }),
  z.strictObject({
    tier: z.literal('full'),
    ...basicStatsSchema.shape,
    advanced: advancedStatsSchema,
  }),
]);
export type MeStatsResponse = z.infer<typeof meStatsResponseSchema>;

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

/** Six-digit TOTP code (RFC 6238 defaults). */
export const totpCodeSchema = z
  .string()
  .length(LIMITS.totpCode.length)
  .regex(/^[0-9]+$/, 'must be digits');

export const IDENTITY_PROVIDERS = ['apple', 'google'] as const;
export const identityProviderSchema = z.enum(IDENTITY_PROVIDERS);
export type IdentityProvider = z.infer<typeof identityProviderSchema>;

/**
 * Fields of a single-use re-authentication proof (authorization matrix footnote 4), shared by
 * `DELETE me` and `POST admin/totp/enroll`. Schemas built from it apply `isSingleReauthProof` and
 * `hasRequiredNonce` as refinements.
 */
export const reauthProofShape = {
  password: currentPasswordSchema.optional(),
  provider: identityProviderSchema.optional(),
  identityToken: compactJwsSchema.optional(),
  nonce: z
    .string()
    .min(LIMITS.nonce.min)
    .max(LIMITS.nonce.max)
    .regex(/^[A-Za-z0-9._~-]+$/, 'must be URL-safe')
    .optional(),
};

export interface ReauthProofFields {
  password?: string | undefined;
  provider?: IdentityProvider | undefined;
  identityToken?: string | undefined;
  nonce?: string | undefined;
}

/** Exactly one proof kind: a password, or a provider with its identity token. */
export function isSingleReauthProof(body: ReauthProofFields): boolean {
  return body.password !== undefined
    ? body.provider === undefined && body.identityToken === undefined && body.nonce === undefined
    : body.provider !== undefined && body.identityToken !== undefined;
}

/** Apple identity tokens are nonce-bound, so a nonce must accompany them. */
export function hasRequiredNonce(body: ReauthProofFields): boolean {
  return body.provider !== 'apple' || body.nonce !== undefined;
}

export const SINGLE_REAUTH_PROOF_ISSUE = {
  message: 'send either password or provider with identityToken',
  path: ['password'],
};
export const REQUIRED_NONCE_ISSUE = {
  message: 'nonce is required for Apple identity tokens',
  path: ['nonce'],
};

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
    ...reauthProofShape,
    totpCode: totpCodeSchema.optional(),
  })
  .refine(isSingleReauthProof, SINGLE_REAUTH_PROOF_ISSUE)
  .refine(hasRequiredNonce, REQUIRED_NONCE_ISSUE);
export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;

/** `DELETE /api/v1/me` 202 response. Every session is revoked; the client signs out locally. */
export const deleteAccountResponseSchema = z.strictObject({
  graceUntil: isoDateTimeSchema,
});
export type DeleteAccountResponse = z.infer<typeof deleteAccountResponseSchema>;
