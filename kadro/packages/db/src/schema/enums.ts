import { pgEnum } from 'drizzle-orm/pg-core';

/** Platform role on `users.role`. Staff powers apply only under `/api/v1/admin/**`. */
export const USER_ROLES = ['user', 'moderator', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const userRoleEnum = pgEnum('user_role', USER_ROLES);

/** Declared playing position, used by lineup auto-balance and open-call filters. */
export const PLAYER_POSITIONS = ['GK', 'DEF', 'MID', 'FWD'] as const;
export type PlayerPosition = (typeof PLAYER_POSITIONS)[number];
export const playerPositionEnum = pgEnum('player_position', PLAYER_POSITIONS);

/** Self-declared playing level, shared by user profiles and open calls. */
export const PLAYER_LEVELS = ['casual', 'regular', 'competitive'] as const;
export type PlayerLevel = (typeof PLAYER_LEVELS)[number];
export const playerLevelEnum = pgEnum('player_level', PLAYER_LEVELS);

export const EMAIL_TOKEN_PURPOSES = ['verify', 'reset'] as const;
export type EmailTokenPurpose = (typeof EMAIL_TOKEN_PURPOSES)[number];
export const emailTokenPurposeEnum = pgEnum('email_token_purpose', EMAIL_TOKEN_PURPOSES);

/** Relationship of a user to a team (`team_members.role`). */
/** Client kind of a refresh-token row: mobile refresh token or web `__Host-kadro_session` cookie. */
export const SESSION_CLIENTS = ['mobile', 'web'] as const;
export type SessionClient = (typeof SESSION_CLIENTS)[number];
export const sessionClientEnum = pgEnum('session_client', SESSION_CLIENTS);

export const TEAM_ROLES = ['captain', 'co_captain', 'player'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];
export const teamRoleEnum = pgEnum('team_role', TEAM_ROLES);

export const MATCH_FORMATS = ['5v5', '6v6', '7v7', '8v8'] as const;
export type MatchFormat = (typeof MATCH_FORMATS)[number];
export const matchFormatEnum = pgEnum('match_format', MATCH_FORMATS);

export const MATCH_STATUSES = ['draft', 'open', 'locked', 'played', 'cancelled'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];
export const matchStatusEnum = pgEnum('match_status', MATCH_STATUSES);

/** `waitlist` is assigned by the server only, when `in` exceeds the match slots. */
export const RSVP_STATUSES = ['in', 'out', 'maybe', 'waitlist'] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];
export const rsvpStatusEnum = pgEnum('rsvp_status', RSVP_STATUSES);

export const LINEUP_SIDES = ['A', 'B'] as const;
export type LineupSide = (typeof LINEUP_SIDES)[number];
export const lineupSideEnum = pgEnum('lineup_side', LINEUP_SIDES);

/**
 * `closed`: filled or closed by the team staff; `expired`: passed `expires_at`;
 * `removed`: taken down by a moderator.
 */
export const OPEN_CALL_STATUSES = ['open', 'closed', 'expired', 'removed'] as const;
export type OpenCallStatus = (typeof OPEN_CALL_STATUSES)[number];
export const openCallStatusEnum = pgEnum('open_call_status', OPEN_CALL_STATUSES);

export const APPLICATION_STATUSES = ['pending', 'accepted', 'rejected', 'withdrawn'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export const applicationStatusEnum = pgEnum('application_status', APPLICATION_STATUSES);

export const PUSH_PLATFORMS = ['ios', 'android'] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];
export const pushPlatformEnum = pgEnum('push_platform', PUSH_PLATFORMS);

/** Normalized RevenueCat subscription state; entitlement checks treat only `active` and `grace_period` as Pro. */
export const SUBSCRIPTION_STATUSES = [
  'active',
  'grace_period',
  'billing_issue',
  'paused',
  'cancelled',
  'expired',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export const subscriptionStatusEnum = pgEnum('subscription_status', SUBSCRIPTION_STATUSES);

export const SUBSCRIPTION_ENVIRONMENTS = ['sandbox', 'production'] as const;
export type SubscriptionEnvironment = (typeof SUBSCRIPTION_ENVIRONMENTS)[number];
export const subscriptionEnvironmentEnum = pgEnum(
  'subscription_environment',
  SUBSCRIPTION_ENVIRONMENTS,
);

export const WEBHOOK_PROVIDERS = ['revenuecat'] as const;
export type WebhookProvider = (typeof WEBHOOK_PROVIDERS)[number];
export const webhookProviderEnum = pgEnum('webhook_provider', WEBHOOK_PROVIDERS);

/** Image upload kinds (ADR-0030). */
export const UPLOAD_KINDS = ['avatar', 'badge'] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];
export const uploadKindEnum = pgEnum('upload_kind', UPLOAD_KINDS);

export const UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type UploadContentType = (typeof UPLOAD_CONTENT_TYPES)[number];
export const uploadContentTypeEnum = pgEnum('upload_content_type', UPLOAD_CONTENT_TYPES);

export const UPLOAD_STATUSES = ['pending', 'processing', 'ready', 'rejected', 'deleted'] as const;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];
export const uploadStatusEnum = pgEnum('upload_status', UPLOAD_STATUSES);

export const UPLOAD_REJECT_REASONS = [
  'missing',
  'size_mismatch',
  'not_an_image',
  'type_mismatch',
  'too_many_pixels',
  'decode_failed',
  'expired',
  'not_allowed',
] as const;
export type UploadRejectReason = (typeof UPLOAD_REJECT_REASONS)[number];
export const uploadRejectReasonEnum = pgEnum('upload_reject_reason', UPLOAD_REJECT_REASONS);

/** External systems an account hard delete may still owe a cleanup to (ADR-0032). */
export const EXTERNAL_CLEANUP_TARGETS = ['revenuecat'] as const;
export type ExternalCleanupTarget = (typeof EXTERNAL_CLEANUP_TARGETS)[number];
