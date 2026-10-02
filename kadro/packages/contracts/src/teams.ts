import { z } from 'zod';

import { httpsUrlSchema, idSchema, isoDateTimeSchema, visibleTextSchema } from './common.js';
import { slugSchema } from './districts.js';
import { LIMITS } from './limits.js';
import { teamRoleSchema } from './roles.js';
import { userPublicSchema } from './users.js';

/**
 * Teams, members and invites (spec §3 story 2, authorization matrix §3.3 and §4.2). Server-only
 * columns (`slug`, `owner_id`, `is_pro_locked`, `team_members.user_id/joined_at`,
 * `team_invites.code_hash/uses`) never appear in a request schema; strict objects reject them.
 */

export const teamNameSchema = visibleTextSchema(LIMITS.teamName.min, LIMITS.teamName.max);

/** Path parameters `teams/:id`. */
export const teamParamsSchema = z.strictObject({ id: idSchema });
export type TeamParams = z.infer<typeof teamParamsSchema>;

/** Path parameters `teams/:id/members/:userId`. */
export const teamMemberParamsSchema = z.strictObject({ id: idSchema, userId: idSchema });
export type TeamMemberParams = z.infer<typeof teamMemberParamsSchema>;

/** `POST /api/v1/teams`. The actor becomes the captain; the badge is set later via `PATCH`. */
export const createTeamRequestSchema = z.strictObject({
  name: teamNameSchema,
  districtId: idSchema,
});
export type CreateTeamRequest = z.infer<typeof createTeamRequestSchema>;

/**
 * `PATCH /api/v1/teams/:id` (captain and co-captain). `badge: null` removes the badge; a new
 * badge is applied only by the upload worker (ADR-0030), never from a client-sent key.
 */
export const updateTeamRequestSchema = z
  .strictObject({
    name: teamNameSchema.optional(),
    districtId: idSchema.optional(),
    badge: z.null().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'must contain at least one field');
export type UpdateTeamRequest = z.infer<typeof updateTeamRequestSchema>;

/** A team as seen by one of its members, including the actor's own role. */
export const teamSummarySchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1).max(LIMITS.teamName.max),
  slug: slugSchema,
  badgeUrl: httpsUrlSchema.nullable(),
  districtId: idSchema,
  myRole: teamRoleSchema,
  memberCount: z.int().min(1),
  /** Read-only: set by entitlement processing when Pro lapses (authorization matrix §7). */
  isProLocked: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export type TeamSummary = z.infer<typeof teamSummarySchema>;

/** Roster entry: public profile only, never email or district (authorization matrix §6). */
export const teamMemberSchema = z.strictObject({
  user: userPublicSchema,
  role: teamRoleSchema,
  joinedAt: isoDateTimeSchema,
});
export type TeamMember = z.infer<typeof teamMemberSchema>;

/** `GET /api/v1/teams/:id` and the create / update responses: summary plus roster. */
export const teamDetailSchema = z.strictObject({
  ...teamSummarySchema.shape,
  members: z.array(teamMemberSchema).min(1),
});
export type TeamDetail = z.infer<typeof teamDetailSchema>;

/**
 * `PATCH /api/v1/teams/:id/members/:userId` (captain only). `captain` transfers captaincy: the
 * previous captain becomes `co_captain` in the same transaction (ADR-0008).
 */
export const updateMemberRoleRequestSchema = z.strictObject({
  role: teamRoleSchema,
});
export type UpdateMemberRoleRequest = z.infer<typeof updateMemberRoleRequestSchema>;

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

/** Plaintext invite code: 22 base64url characters (128 bits), shown once (ADR-0011). */
export const inviteCodeSchema = z
  .string()
  .length(LIMITS.inviteCode.length)
  .regex(/^[A-Za-z0-9_-]+$/, 'must be an invite code');

/** Path parameters `invites/:code` and `invites/:code/accept`. */
export const inviteCodeParamsSchema = z.strictObject({ code: inviteCodeSchema });
export type InviteCodeParams = z.infer<typeof inviteCodeParamsSchema>;

/** Path parameters `teams/:id/invites/:inviteId`. */
export const teamInviteParamsSchema = z.strictObject({ id: idSchema, inviteId: idSchema });
export type TeamInviteParams = z.infer<typeof teamInviteParamsSchema>;

/**
 * `POST /api/v1/teams/:id/invites` (ADR-0034): validity 1 hour .. 14 days (default 7 days),
 * 1 .. 50 uses (default 20). At most 10 live invites per team (409 `invite_limit`).
 */
export const createInviteRequestSchema = z.strictObject({
  expiresInSeconds: z
    .int()
    .min(LIMITS.inviteExpiresInSeconds.min)
    .max(LIMITS.inviteExpiresInSeconds.max)
    .default(LIMITS.inviteExpiresInSeconds.default),
  maxUses: z
    .int()
    .min(LIMITS.inviteMaxUses.min)
    .max(LIMITS.inviteMaxUses.max)
    .default(LIMITS.inviteMaxUses.default),
});
export type CreateInviteRequest = z.infer<typeof createInviteRequestSchema>;

/**
 * `POST /api/v1/teams/:id/invites` 201 response. The only place the plaintext code ever appears;
 * `url` is the invite landing page (`/mac/[code]`), also used as the QR payload.
 */
export const createInviteResponseSchema = z.strictObject({
  inviteId: idSchema,
  code: inviteCodeSchema,
  url: httpsUrlSchema,
  expiresAt: isoDateTimeSchema,
  maxUses: z.int().min(LIMITS.inviteMaxUses.min).max(LIMITS.inviteMaxUses.max),
});
export type CreateInviteResponse = z.infer<typeof createInviteResponseSchema>;

/** `POST /api/v1/invites/:code/accept` body: empty; the code in the path is the credential. */
export const acceptInviteRequestSchema = z.strictObject({});
export type AcceptInviteRequest = z.infer<typeof acceptInviteRequestSchema>;

/** `POST /api/v1/invites/:code/accept` 200 response: the joined team (actor is `player`). */
export const acceptInviteResponseSchema = z.strictObject({
  team: teamSummarySchema,
});
export type AcceptInviteResponse = z.infer<typeof acceptInviteResponseSchema>;

/** List item of `GET /api/v1/teams/:id/invites` (staff): never the code (footnote 29). */
export const teamInviteSchema = z.strictObject({
  id: idSchema,
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
  uses: z.int().min(0).max(LIMITS.inviteMaxUses.max),
  maxUses: z.int().min(LIMITS.inviteMaxUses.min).max(LIMITS.inviteMaxUses.max),
});
export type TeamInvite = z.infer<typeof teamInviteSchema>;

/**
 * `GET /api/v1/invites/:code` (anyone holding the code, footnote 28): what the invite landing
 * page shows, and nothing else. No member or captain names.
 */
export const invitePreviewSchema = z.strictObject({
  team: z.strictObject({
    name: z.string().min(1).max(LIMITS.teamName.max),
    badgeUrl: httpsUrlSchema.nullable(),
    districtId: idSchema,
    memberCount: z.int().min(1),
  }),
});
export type InvitePreview = z.infer<typeof invitePreviewSchema>;
