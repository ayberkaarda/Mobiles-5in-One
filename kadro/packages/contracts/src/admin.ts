import { z } from 'zod';

import { displayNameSchema, idSchema, isoDateTimeSchema, visibleTextSchema } from './common.js';
import { geoPointSchema, slugSchema } from './districts.js';
import { LIMITS } from './limits.js';
import { openCallStatusSchema } from './open-calls.js';
import { paginationQuerySchema } from './pagination.js';
import { platformRoleSchema } from './roles.js';
import {
  hasRequiredNonce,
  isSingleReauthProof,
  levelSchema,
  positionSchema,
  reauthProofShape,
  REQUIRED_NONCE_ISSUE,
  SINGLE_REAUTH_PROOF_ISSUE,
  totpCodeSchema,
} from './users.js';
import { venueFeaturesSchema, venuePhoneSchema, venueRatingSchema } from './venues.js';

/**
 * Admin API (`/api/v1/admin/**`, authorization matrix §3.8, security checklist item 18,
 * ADR-0064). Every route requires a `moderator` or `admin` session. All routes except step-up and
 * TOTP enrollment also require a valid step-up (401 `step_up_required`); role and deactivation
 * changes additionally carry a fresh `totpCode` in the body. Every mutation writes `audit_logs`.
 * Staff powers apply only here, never on the regular API (ADR-0007).
 */

// ---------------------------------------------------------------------------
// Step-up and TOTP enrollment
// ---------------------------------------------------------------------------

/** `POST /api/v1/admin/step-up`: verify a TOTP code and open the 15-minute step-up window. */
export const adminStepUpRequestSchema = z.strictObject({
  totpCode: totpCodeSchema,
});
export type AdminStepUpRequest = z.infer<typeof adminStepUpRequestSchema>;

/**
 * Step-up state. The window is bound to the current web session or mobile refresh-token family
 * (authorization matrix footnote 26).
 */
export const adminStepUpResponseSchema = z.strictObject({
  stepUpUntil: isoDateTimeSchema,
});
export type AdminStepUpResponse = z.infer<typeof adminStepUpResponseSchema>;

/**
 * `POST /api/v1/admin/totp/enroll`: starts enrollment for a staff account without an active
 * secret. Requires a single-use re-authentication proof (footnote 4). The new secret stays
 * pending until `POST admin/totp/confirm` proves a code from it; starting again replaces a pending
 * secret. An active secret answers 409 `totp_already_enrolled`.
 */
export const adminTotpEnrollRequestSchema = z
  .strictObject({ ...reauthProofShape })
  .refine(isSingleReauthProof, SINGLE_REAUTH_PROOF_ISSUE)
  .refine(hasRequiredNonce, REQUIRED_NONCE_ISSUE);
export type AdminTotpEnrollRequest = z.infer<typeof adminTotpEnrollRequestSchema>;

/** RFC 4648 base32 without padding, 160 bits (RFC 4226 recommendation). */
export const totpSecretSchema = z
  .string()
  .length(32)
  .regex(/^[A-Z2-7]+$/, 'must be base32');

/**
 * Enrollment response, sent once and never retrievable again: the secret for manual entry and the
 * `otpauth://` URI for a QR code. Parameters are fixed: SHA-1, 6 digits, 30-second period.
 */
export const adminTotpEnrollResponseSchema = z.strictObject({
  secret: totpSecretSchema,
  otpauthUri: z
    .string()
    .max(512)
    .regex(/^otpauth:\/\/totp\/[^\s]+$/, 'must be an otpauth://totp/ URI'),
  algorithm: z.literal('SHA1'),
  digits: z.literal(LIMITS.totpCode.length),
  periodSeconds: z.literal(30),
  confirmBy: isoDateTimeSchema,
});
export type AdminTotpEnrollResponse = z.infer<typeof adminTotpEnrollResponseSchema>;

/**
 * `POST /api/v1/admin/totp/confirm`: activates the pending secret with a code from it. No pending
 * secret (or past `confirmBy`) answers 409 `totp_not_enrolled`; a wrong code 401 `totp_invalid`;
 * an already active secret 409 `totp_already_enrolled`.
 */
export const adminTotpConfirmRequestSchema = z.strictObject({
  totpCode: totpCodeSchema,
});
export type AdminTotpConfirmRequest = z.infer<typeof adminTotpConfirmRequestSchema>;

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** Path parameter `:id` of admin resources. */
export const adminIdParamsSchema = z.strictObject({ id: idSchema });
export type AdminIdParams = z.infer<typeof adminIdParamsSchema>;

const adminSearchSchema = visibleTextSchema(
  LIMITS.adminSearchQuery.min,
  LIMITS.adminSearchQuery.max,
);

/** `true` / `false` in a query string. */
const queryBooleanSchema = z.enum(['true', 'false']).transform((value) => value === 'true');

const actorCardSchema = z.strictObject({
  id: idSchema,
  displayName: displayNameSchema,
});

// ---------------------------------------------------------------------------
// Venues
// ---------------------------------------------------------------------------

/** `GET /api/v1/admin/venues`: newest first; `verified` and `q` (folded name) filters. */
export const listAdminVenuesQuerySchema = z.strictObject({
  ...paginationQuerySchema.shape,
  verified: queryBooleanSchema.optional(),
  district: idSchema.optional(),
  q: adminSearchSchema.optional(),
});
export type ListAdminVenuesQuery = z.infer<typeof listAdminVenuesQuerySchema>;

const priceMinorSchema = z.int().min(0).max(LIMITS.feeTotalMinor.max);

/** A venue as staff see it: every stored field, including unverified contact data. */
export const adminVenueSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1).max(LIMITS.venueName.max),
  slug: slugSchema,
  districtId: idSchema,
  location: geoPointSchema,
  address: z.string().max(LIMITS.venueAddress.max).nullable(),
  phone: z.string().max(LIMITS.venuePhone.max).nullable(),
  indoor: z.boolean(),
  features: venueFeaturesSchema,
  priceMinMinor: priceMinorSchema.nullable(),
  priceMaxMinor: priceMinorSchema.nullable(),
  verified: z.boolean(),
  isSample: z.boolean(),
  /** `null` for seeded and imported venues and after the creator's account was deleted. */
  creatorId: idSchema.nullable(),
  rating: venueRatingSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type AdminVenue = z.infer<typeof adminVenueSchema>;

/**
 * `PATCH /api/v1/admin/venues/:id` (`venue.verify`): verification and corrections. `null` clears
 * an optional field. `slug`, `isSample` and the creator are never writable. A rename that collides
 * with another venue of the district answers 409 `venue_exists`.
 */
export const updateAdminVenueRequestSchema = z
  .strictObject({
    verified: z.boolean().optional(),
    name: visibleTextSchema(LIMITS.venueName.min, LIMITS.venueName.max).optional(),
    districtId: idSchema.optional(),
    location: geoPointSchema.optional(),
    address: visibleTextSchema(1, LIMITS.venueAddress.max).nullable().optional(),
    phone: venuePhoneSchema.nullable().optional(),
    indoor: z.boolean().optional(),
    features: venueFeaturesSchema.optional(),
    priceMinMinor: priceMinorSchema.nullable().optional(),
    priceMaxMinor: priceMinorSchema.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'must contain at least one field')
  .refine(
    (body) =>
      typeof body.priceMinMinor !== 'number' ||
      typeof body.priceMaxMinor !== 'number' ||
      body.priceMinMinor <= body.priceMaxMinor,
    { message: 'priceMinMinor must not exceed priceMaxMinor', path: ['priceMinMinor'] },
  );
export type UpdateAdminVenueRequest = z.infer<typeof updateAdminVenueRequestSchema>;

/**
 * Columns of a venue import CSV (UTF-8, comma separated, header row required, in any order).
 * `il` and `ilce` are district slugs; booleans are `true` / `false`; prices are per-hour kuruş.
 */
export const VENUE_IMPORT_COLUMNS = [
  'name',
  'il',
  'ilce',
  'latitude',
  'longitude',
  'address',
  'phone',
  'indoor',
  'lighting',
  'changing_room',
  'shower',
  'parking',
  'price_min_minor',
  'price_max_minor',
] as const;
export type VenueImportColumn = (typeof VENUE_IMPORT_COLUMNS)[number];

/** Columns a CSV must contain; the others may be absent or empty. */
export const VENUE_IMPORT_REQUIRED_COLUMNS = [
  'name',
  'il',
  'ilce',
  'latitude',
  'longitude',
  'indoor',
] as const satisfies readonly VenueImportColumn[];

/**
 * `POST /api/v1/admin/venues/import` (`venue.import`, admin only). The CSV travels inline in the
 * JSON body (the 1 MiB body limit applies); the handler stores it, answers 202 and enqueues
 * `venue.import`. Imported rows are created verified, never as samples; a row whose normalized
 * name already exists in its district is skipped. `dryRun` validates every row without writing.
 */
export const venueImportRequestSchema = z.strictObject({
  csv: z.string().min(1).max(LIMITS.venueImportCsv.maxChars),
  dryRun: z.boolean().default(false),
});
export type VenueImportRequest = z.infer<typeof venueImportRequestSchema>;

export const VENUE_IMPORT_STATUSES = ['queued', 'processing', 'completed', 'failed'] as const;
export const venueImportStatusSchema = z.enum(VENUE_IMPORT_STATUSES);
export type VenueImportStatus = z.infer<typeof venueImportStatusSchema>;

/** One rejected row: 1-based CSV line (the header is line 1), the column and a zod-style code. */
export const venueImportIssueSchema = z.strictObject({
  line: z.int().min(1),
  column: z.enum(VENUE_IMPORT_COLUMNS).nullable(),
  issue: z.string().regex(/^[a-z][a-z_]{0,63}$/),
});
export type VenueImportIssue = z.infer<typeof venueImportIssueSchema>;

/** Import state, returned by `POST admin/venues/import` and `GET admin/venues/import/:importId`. */
export const venueImportSchema = z.strictObject({
  id: idSchema,
  status: venueImportStatusSchema,
  dryRun: z.boolean(),
  /** Data rows, known once parsing finished. */
  totalRows: z.int().min(0).max(LIMITS.venueImportCsv.maxRows).nullable(),
  createdRows: z.int().min(0),
  skippedRows: z.int().min(0),
  rejectedRows: z.int().min(0),
  issues: z.array(venueImportIssueSchema).max(LIMITS.venueImportIssues.max),
  createdAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
});
export type VenueImport = z.infer<typeof venueImportSchema>;

export const venueImportParamsSchema = z.strictObject({ importId: idSchema });
export type VenueImportParams = z.infer<typeof venueImportParamsSchema>;

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

/** `GET /api/v1/admin/reviews`: newest first, optionally one venue. */
export const listAdminReviewsQuerySchema = z.strictObject({
  ...paginationQuerySchema.shape,
  venue: idSchema.optional(),
});
export type ListAdminReviewsQuery = z.infer<typeof listAdminReviewsQuerySchema>;

export const adminReviewSchema = z.strictObject({
  id: idSchema,
  venue: z.strictObject({
    id: idSchema,
    name: z.string().min(1).max(LIMITS.venueName.max),
    slug: slugSchema,
  }),
  author: actorCardSchema,
  rating: z.int().min(LIMITS.reviewRating.min).max(LIMITS.reviewRating.max),
  text: z.string().max(LIMITS.reviewText.max).nullable(),
  createdAt: isoDateTimeSchema,
});
export type AdminReview = z.infer<typeof adminReviewSchema>;

// ---------------------------------------------------------------------------
// Open calls
// ---------------------------------------------------------------------------

/** `GET /api/v1/admin/open-calls`: newest first, optionally one status. */
export const listAdminOpenCallsQuerySchema = z.strictObject({
  ...paginationQuerySchema.shape,
  status: openCallStatusSchema.optional(),
});
export type ListAdminOpenCallsQuery = z.infer<typeof listAdminOpenCallsQuerySchema>;

export const adminOpenCallSchema = z.strictObject({
  id: idSchema,
  matchId: idSchema,
  team: z.strictObject({
    id: idSchema,
    name: z.string().min(1).max(LIMITS.teamName.max),
  }),
  districtId: idSchema,
  startsAt: isoDateTimeSchema,
  missingCount: z.int().min(0).max(LIMITS.missingCount.max),
  position: positionSchema.nullable(),
  level: levelSchema,
  status: openCallStatusSchema,
  expiresAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
});
export type AdminOpenCall = z.infer<typeof adminOpenCallSchema>;

// ---------------------------------------------------------------------------
// Users and roles
// ---------------------------------------------------------------------------

/** `GET /api/v1/admin/users`: newest first; `role` filter and `q` over display names. */
export const listAdminUsersQuerySchema = z.strictObject({
  ...paginationQuerySchema.shape,
  role: platformRoleSchema.optional(),
  q: adminSearchSchema.optional(),
});
export type ListAdminUsersQuery = z.infer<typeof listAdminUsersQuerySchema>;

/**
 * Masked email as shown in admin lists (authorization matrix §6): first character of the local
 * part and of the domain, each followed by `***`.
 */
export const maskedEmailSchema = z
  .string()
  .max(16)
  .regex(/^[^\s@*]\*\*\*@[^\s@*]\*\*\*$/, 'must be a masked email such as a***@d***');

/** Display a masked email (`ayse@kadro.app` → `a***@k***`). */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  const local = at > 0 ? email.slice(0, 1) : '?';
  const domain = at >= 0 && at < email.length - 1 ? email.slice(at + 1, at + 2) : '?';
  return `${local}***@${domain}***`;
}

/** A user as staff see it. Tombstones of deleted accounts are never listed (ADR-0033). */
export const adminUserSchema = z.strictObject({
  id: idSchema,
  displayName: displayNameSchema,
  maskedEmail: maskedEmailSchema,
  role: platformRoleSchema,
  emailVerified: z.boolean(),
  deactivatedAt: isoDateTimeSchema.nullable(),
  totpEnrolled: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export type AdminUser = z.infer<typeof adminUserSchema>;

/**
 * `PATCH /api/v1/admin/users/:id/role` (`admin.role.manage`, admin only, footnote 27): fresh
 * `totpCode` in the request. Own account → 403; demoting the last active admin → 409
 * `last_admin`.
 */
export const setUserRoleRequestSchema = z.strictObject({
  role: platformRoleSchema,
  totpCode: totpCodeSchema,
});
export type SetUserRoleRequest = z.infer<typeof setUserRoleRequestSchema>;

/**
 * `PATCH /api/v1/admin/users/:id/deactivate` (`admin.user.deactivate`, admin only, footnote 27):
 * `deactivated: true` sets `deactivated_at` and revokes every session; `false` lifts an admin
 * deactivation. An account in its self-initiated deletion grace period answers 409
 * `deletion_pending` to `false` (only the user can cancel it by signing in).
 */
export const setUserDeactivatedRequestSchema = z.strictObject({
  deactivated: z.boolean(),
  totpCode: totpCodeSchema,
});
export type SetUserDeactivatedRequest = z.infer<typeof setUserDeactivatedRequestSchema>;

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

/** `audit_logs.action` values follow `area.verb` (`venue.verified`, `admin.stepUp`). */
export const auditActionSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z][A-Za-z.]*[A-Za-z]$/, 'must be an audit action such as venue.verified')
  .refine(
    (value) =>
      value.split('.').every((part) => /^[a-z][A-Za-z]*$/.test(part)) && value.includes('.'),
    'must be an audit action such as venue.verified',
  );

export const auditTargetTypeSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z][a-z_]*$/, 'must be a snake_case target type');

/** `GET /api/v1/admin/audit-logs` (admin only): newest first with optional filters. */
export const listAuditLogsQuerySchema = z.strictObject({
  ...paginationQuerySchema.shape,
  action: auditActionSchema.optional(),
  actor: idSchema.optional(),
  targetType: auditTargetTypeSchema.optional(),
  target: idSchema.optional(),
});
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;

/** Audit metadata never holds personal data; values are short scalars. */
export const auditMetadataSchema = z.record(
  z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/),
  z.union([z.string().max(200), z.number(), z.boolean(), z.null()]),
);

/** One audit row. `ip_hash` is never returned. */
export const auditLogEntrySchema = z.strictObject({
  id: idSchema,
  /** `null` for system actions and after the actor's account was deleted. */
  actor: actorCardSchema.nullable(),
  action: auditActionSchema,
  targetType: auditTargetTypeSchema,
  targetId: idSchema.nullable(),
  metadata: auditMetadataSchema,
  createdAt: isoDateTimeSchema,
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;
