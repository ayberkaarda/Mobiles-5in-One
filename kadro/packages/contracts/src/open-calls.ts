import { z } from 'zod';

import { idSchema, isoDateTimeSchema, multilineTextSchema } from './common.js';
import { slugSchema } from './districts.js';
import { LIMITS } from './limits.js';
import { matchFormatSchema } from './matches.js';
import { paginationQuerySchema } from './pagination.js';
import { levelSchema, positionSchema, userPublicSchema } from './users.js';

/**
 * "Eksik Var" open calls and applications (spec §3 story 6, authorization matrix §3.5, §4.4,
 * footnotes 18–22, ADR-0003, ADR-0010). `open_calls.match_id` / `status` and
 * `open_call_applications.user_id` / `open_call_id` are server-only.
 */

/** `closed`: filled or closed by staff; `expired`: past `expires_at`; `removed`: moderator. */
export const OPEN_CALL_STATUSES = ['open', 'closed', 'expired', 'removed'] as const;
export const openCallStatusSchema = z.enum(OPEN_CALL_STATUSES);
export type OpenCallStatus = z.infer<typeof openCallStatusSchema>;

export const APPLICATION_STATUSES = ['pending', 'accepted', 'rejected', 'withdrawn'] as const;
export const applicationStatusSchema = z.enum(APPLICATION_STATUSES);
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

/**
 * Status targets of `PATCH open-calls/:id/applications/:appId`: `accepted` / `rejected` by the
 * call's team staff (`application.decide`), `withdrawn` by the applicant
 * (`application.withdraw`).
 */
export const APPLICATION_STATUS_TARGETS = ['accepted', 'rejected', 'withdrawn'] as const;
export const applicationStatusTargetSchema = z.enum(APPLICATION_STATUS_TARGETS);
export type ApplicationStatusTarget = z.infer<typeof applicationStatusTargetSchema>;

export const missingCountSchema = z.int().min(LIMITS.missingCount.min).max(LIMITS.missingCount.max);

/** Path parameters `open-calls/:id`. */
export const openCallParamsSchema = z.strictObject({ id: idSchema });
export type OpenCallParams = z.infer<typeof openCallParamsSchema>;

/** Path parameters `open-calls/:id/applications/:appId`. */
export const applicationParamsSchema = z.strictObject({ id: idSchema, appId: idSchema });
export type ApplicationParams = z.infer<typeof applicationParamsSchema>;

/**
 * `POST /api/v1/matches/:id/open-call` (captain and co-captain, footnote 19, ADR-0037).
 * `position: null` means any position. `districtId` defaults to the venue's or the team's
 * district. The server checks `now() + 15 min ≤ expiresAt ≤ starts_at` (409
 * `invalid_call_expiry`), `missingCount ≤ slots − confirmed` (409 `invalid_missing_count`) and
 * that the match has no other open call (409 `open_call_exists`).
 */
export const publishOpenCallRequestSchema = z.strictObject({
  missingCount: missingCountSchema,
  position: positionSchema.nullable(),
  level: levelSchema,
  districtId: idSchema.optional(),
  expiresAt: isoDateTimeSchema,
});

/** `PATCH /api/v1/matches/:id/open-call` (staff, footnote 30): closes the match's open call. */
export const closeOpenCallRequestSchema = z.strictObject({
  status: z.literal('closed'),
});
export type CloseOpenCallRequest = z.infer<typeof closeOpenCallRequestSchema>;
export type PublishOpenCallRequest = z.infer<typeof publishOpenCallRequestSchema>;

/** The call as seen by its team staff (publish response). */
export const openCallSchema = z.strictObject({
  id: idSchema,
  matchId: idSchema,
  missingCount: z.int().min(0).max(LIMITS.missingCount.max),
  position: positionSchema.nullable(),
  level: levelSchema,
  districtId: idSchema,
  status: openCallStatusSchema,
  expiresAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
});
export type OpenCall = z.infer<typeof openCallSchema>;

const MS_PER_DAY = 86_400_000;

/**
 * `GET /api/v1/open-calls` filters plus cursor pagination (ADR-0039): `district` (id) or
 * `province` (il slug), not both; `level`; `position`; a `from` .. `to` window on `starts_at` of
 * at most 31 days. Results are sorted by `starts_at`.
 */
export const listOpenCallsQuerySchema = z
  .strictObject({
    ...paginationQuerySchema.shape,
    district: idSchema.optional(),
    province: slugSchema.optional(),
    level: levelSchema.optional(),
    position: positionSchema.optional(),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
  })
  .refine((query) => query.district === undefined || query.province === undefined, {
    message: 'district and province are mutually exclusive',
    path: ['province'],
  })
  .refine(
    (query) => {
      if (query.from === undefined || query.to === undefined) {
        return true;
      }
      const span = Date.parse(query.to) - Date.parse(query.from);
      return span >= 0 && span <= LIMITS.openCallListRangeDays * MS_PER_DAY;
    },
    { message: 'to must follow from by at most 31 days', path: ['to'] },
  );
export type ListOpenCallsQuery = z.infer<typeof listOpenCallsQuerySchema>;

/**
 * Public projection (authorization matrix footnote 18), visible to everyone including anonymous
 * callers: no user names, no RSVP list, no fee breakdown. `venue` is set only for verified
 * directory venues; a free-text venue is represented by the district alone. Only open,
 * unexpired calls are listed.
 */
export const openCallPublicSchema = z.strictObject({
  id: idSchema,
  districtId: idSchema,
  startsAt: isoDateTimeSchema,
  format: matchFormatSchema,
  missingCount: missingCountSchema,
  position: positionSchema.nullable(),
  level: levelSchema,
  venue: z
    .strictObject({ name: z.string().min(1).max(LIMITS.venueName.max), slug: slugSchema })
    .nullable(),
  teamName: z.string().min(1).max(LIMITS.teamName.max),
  expiresAt: isoDateTimeSchema,
});
export type OpenCallPublic = z.infer<typeof openCallPublicSchema>;

/**
 * `POST /api/v1/open-calls/:id/applications` (footnote 20). One application per user per call,
 * whatever the status of an earlier one (409 `already_applied`, ADR-0010).
 */
export const createApplicationRequestSchema = z.strictObject({
  message: multilineTextSchema(LIMITS.applicationMessage.max).optional(),
});
export type CreateApplicationRequest = z.infer<typeof createApplicationRequestSchema>;

/**
 * `GET /api/v1/open-calls/:id/applications` (footnote 33, ADR-0041): call staff list every
 * application, an applicant only their own row. Sorted by `(created_at, id)` ascending, keyset
 * cursor; optional `status` filter.
 */
export const listApplicationsQuerySchema = z.strictObject({
  ...paginationQuerySchema.shape,
  status: applicationStatusSchema.optional(),
});
export type ListApplicationsQuery = z.infer<typeof listApplicationsQuerySchema>;

/** `PATCH /api/v1/open-calls/:id/applications/:appId` (footnotes 21, 22). */
export const decideApplicationRequestSchema = z.strictObject({
  status: applicationStatusTargetSchema,
});
export type DecideApplicationRequest = z.infer<typeof decideApplicationRequestSchema>;

/**
 * An application as seen by the applicant (own) and the call's team staff. The applicant's
 * public profile is what staff need to decide; email and district are never included.
 */
export const applicationSchema = z.strictObject({
  id: idSchema,
  openCallId: idSchema,
  applicant: userPublicSchema,
  message: z.string().max(LIMITS.applicationMessage.max).nullable(),
  status: applicationStatusSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Application = z.infer<typeof applicationSchema>;
