import { z } from 'zod';

import { idSchema, isoDateTimeSchema, visibleTextSchema } from './common.js';
import { slugSchema } from './districts.js';
import { LIMITS } from './limits.js';
import { paginationQuerySchema } from './pagination.js';
import { userCardSchema, userPublicSchema } from './users.js';

/**
 * Matches, RSVP, lineup, payments and MVP votes (spec §3 stories 3–5 and 9, authorization matrix
 * §3.4, §4.3, §4.4). Server-only fields (`team_id`, `locked_at`, `mvp_vote_closes_at`, RSVP
 * `user_id`, `waitlist`, `side` and `paid` outside their own endpoints) are absent from every
 * request schema and appear read-only in responses.
 */

export const MATCH_FORMATS = ['5v5', '6v6', '7v7', '8v8'] as const;
export const matchFormatSchema = z.enum(MATCH_FORMATS);
export type MatchFormat = z.infer<typeof matchFormatSchema>;

export const MATCH_STATUSES = ['draft', 'open', 'locked', 'played', 'cancelled'] as const;
export const matchStatusSchema = z.enum(MATCH_STATUSES);
export type MatchStatus = z.infer<typeof matchStatusSchema>;

/** `waitlist` is assigned by the server only, when `in` exceeds the slots. */
export const RSVP_STATUSES = ['in', 'out', 'maybe', 'waitlist'] as const;
export const rsvpStatusSchema = z.enum(RSVP_STATUSES);
export type RsvpStatus = z.infer<typeof rsvpStatusSchema>;

/** RSVP values a participant may choose (authorization matrix footnote 14). */
export const RSVP_CHOICES = ['in', 'out', 'maybe'] as const;
export const rsvpChoiceSchema = z.enum(RSVP_CHOICES);
export type RsvpChoice = z.infer<typeof rsvpChoiceSchema>;

export const LINEUP_SIDES = ['A', 'B'] as const;
export const lineupSideSchema = z.enum(LINEUP_SIDES);
export type LineupSide = z.infer<typeof lineupSideSchema>;

/**
 * Status targets of `PATCH matches/:id`. `draft` is only the initial state; the transition rules
 * (`draft→open`, `open→locked`, `locked→open`, `open|locked→played` after `starts_at`,
 * `draft|open|locked→cancelled`) are enforced by the server (409 `invalid_status_transition`).
 */
export const MATCH_STATUS_TARGETS = ['open', 'locked', 'played', 'cancelled'] as const;
export const matchStatusTargetSchema = z.enum(MATCH_STATUS_TARGETS);
export type MatchStatusTarget = z.infer<typeof matchStatusTargetSchema>;

export const feeTotalMinorSchema = z
  .int()
  .min(LIMITS.feeTotalMinor.min)
  .max(LIMITS.feeTotalMinor.max);
export const slotsSchema = z.int().min(LIMITS.slots.min).max(LIMITS.slots.max);
export const venueTextSchema = visibleTextSchema(LIMITS.venueText.min, LIMITS.venueText.max);

/** Path parameters `matches/:id`. */
export const matchParamsSchema = z.strictObject({ id: idSchema });
export type MatchParams = z.infer<typeof matchParamsSchema>;

/** Path parameters `matches/:id/payments/:userId`. */
export const matchPaymentParamsSchema = z.strictObject({ id: idSchema, userId: idSchema });
export type MatchPaymentParams = z.infer<typeof matchPaymentParamsSchema>;

/**
 * `POST /api/v1/teams/:id/matches`. Exactly one of `venueId` (a venue readable by the actor) and
 * `venueText` (free text). The match starts as `draft` unless `status: 'open'` is sent;
 * `startsAt` must lie in the future (checked by the server).
 */
export const createMatchRequestSchema = z
  .strictObject({
    venueId: idSchema.optional(),
    venueText: venueTextSchema.optional(),
    startsAt: isoDateTimeSchema,
    format: matchFormatSchema,
    feeTotalMinor: feeTotalMinorSchema,
    slots: slotsSchema,
    status: z.enum(['draft', 'open']).optional(),
  })
  .refine((body) => (body.venueId === undefined) !== (body.venueText === undefined), {
    message: 'exactly one of venueId and venueText is required',
    path: ['venueId'],
  });
export type CreateMatchRequest = z.infer<typeof createMatchRequestSchema>;

/**
 * `PATCH /api/v1/matches/:id` (captain and co-captain, authorization matrix footnote 12).
 * `feeTotalMinor`, `slots` and `format` are refused with 409 `match_terms_frozen` once the match
 * was locked (ADR-0004). Setting one venue field to a value clears the other on the server;
 * a match always keeps exactly one of them.
 */
export const updateMatchRequestSchema = z
  .strictObject({
    venueId: idSchema.optional(),
    venueText: venueTextSchema.optional(),
    startsAt: isoDateTimeSchema.optional(),
    format: matchFormatSchema.optional(),
    feeTotalMinor: feeTotalMinorSchema.optional(),
    slots: slotsSchema.optional(),
    status: matchStatusTargetSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'must contain at least one field')
  .refine((body) => body.venueId === undefined || body.venueText === undefined, {
    message: 'venueId and venueText are mutually exclusive',
    path: ['venueId'],
  });
export type UpdateMatchRequest = z.infer<typeof updateMatchRequestSchema>;

/** `GET /api/v1/teams/:id/matches` query: cursor pagination, optional status filter. */
export const listMatchesQuerySchema = z.strictObject({
  ...paginationQuerySchema.shape,
  status: matchStatusSchema.optional(),
});
export type ListMatchesQuery = z.infer<typeof listMatchesQuerySchema>;

/** Directory venue referenced by a match (name and slug only). */
export const matchVenueSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1).max(LIMITS.venueName.max),
  slug: slugSchema,
});
export type MatchVenue = z.infer<typeof matchVenueSchema>;

export const rsvpCountsSchema = z.strictObject({
  in: z.int().min(0),
  maybe: z.int().min(0),
  out: z.int().min(0),
  waitlist: z.int().min(0),
});
export type RsvpCounts = z.infer<typeof rsvpCountsSchema>;

/** List item of `GET teams/:id/matches` (team members only). */
export const matchSummarySchema = z.strictObject({
  id: idSchema,
  teamId: idSchema,
  venue: matchVenueSchema.nullable(),
  venueText: z.string().max(LIMITS.venueText.max).nullable(),
  startsAt: isoDateTimeSchema,
  format: matchFormatSchema,
  feeTotalMinor: feeTotalMinorSchema,
  slots: slotsSchema,
  status: matchStatusSchema,
  /** Read-only: first lock time; once set the commercial terms are frozen (ADR-0004). */
  lockedAt: isoDateTimeSchema.nullable(),
  /** Read-only: end of the 24-hour MVP window, set when the match is marked played. */
  mvpVoteClosesAt: isoDateTimeSchema.nullable(),
  counts: rsvpCountsSchema,
  myRsvp: rsvpStatusSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type MatchSummary = z.infer<typeof matchSummarySchema>;

/** Participant row of the member projection; `paid` is visible to team members only. */
export const matchParticipantSchema = z.strictObject({
  user: userPublicSchema,
  status: rsvpStatusSchema,
  side: lineupSideSchema.nullable(),
  paid: z.boolean(),
});
export type MatchParticipant = z.infer<typeof matchParticipantSchema>;

/** Participant row of the guest projection: card fields only, no `paid` (footnote 11). */
export const matchGuestParticipantSchema = z.strictObject({
  user: userCardSchema,
  status: rsvpStatusSchema,
  side: lineupSideSchema.nullable(),
});
export type MatchGuestParticipant = z.infer<typeof matchGuestParticipantSchema>;

/** The actor's own RSVP; `paid` and `side` are read-only here. */
export const ownRsvpSchema = z.strictObject({
  matchId: idSchema,
  status: rsvpStatusSchema,
  side: lineupSideSchema.nullable(),
  updatedAt: isoDateTimeSchema,
});
export type OwnRsvp = z.infer<typeof ownRsvpSchema>;

/**
 * MVP state of a match for the actor (ADR-0036): own vote while the window is open, the winners
 * (several on a tie, empty without votes) only after `mvpVoteClosesAt`. `null` before `played`.
 */
export const matchMvpSchema = z.strictObject({
  myVoteeId: idSchema.nullable(),
  winnerIds: z.array(idSchema).nullable(),
});
export type MatchMvp = z.infer<typeof matchMvpSchema>;

/**
 * Base per-player share in kuruş, `floor(fee_total_minor / confirmed)`; the first
 * `fee_total_minor mod confirmed` players by RSVP time pay 1 kuruş more (ADR-0036). `null` while
 * nobody is confirmed.
 */
const shareSchema = z.int().min(0).max(LIMITS.feeTotalMinor.max).nullable();

/**
 * The actor's own exact share in kuruş (ADR-0036): `floor(fee_total_minor / confirmed)` plus 1
 * kuruş when the actor is among the first `fee_total_minor mod confirmed` confirmed players by
 * RSVP creation time (ties by id). `null` unless the actor's RSVP is `in`. Never another player's
 * share; the guest view still carries no fee total and no `paid` flags.
 */
const myShareSchema = z.int().min(0).max(LIMITS.feeTotalMinor.max).nullable();

/** `GET /api/v1/matches/:id` for team members. */
export const matchMemberViewSchema = z.strictObject({
  projection: z.literal('member'),
  ...matchSummarySchema.shape,
  team: z.strictObject({ id: idSchema, name: z.string().min(1).max(LIMITS.teamName.max) }),
  sharePerPlayerMinor: shareSchema,
  myShareMinor: myShareSchema,
  mvp: matchMvpSchema.nullable(),
  participants: z.array(matchParticipantSchema),
});
export type MatchMemberView = z.infer<typeof matchMemberViewSchema>;

/**
 * `GET /api/v1/matches/:id` for match guests (authorization matrix footnote 11): no fee total,
 * no `paid` flags, no roster, no other matches.
 */
export const matchGuestViewSchema = z.strictObject({
  projection: z.literal('guest'),
  id: idSchema,
  team: z.strictObject({ id: idSchema, name: z.string().min(1).max(LIMITS.teamName.max) }),
  venue: matchVenueSchema.nullable(),
  venueText: z.string().max(LIMITS.venueText.max).nullable(),
  startsAt: isoDateTimeSchema,
  format: matchFormatSchema,
  status: matchStatusSchema,
  mvpVoteClosesAt: isoDateTimeSchema.nullable(),
  sharePerPlayerMinor: shareSchema,
  myShareMinor: myShareSchema,
  myRsvp: ownRsvpSchema,
  mvp: matchMvpSchema.nullable(),
  participants: z.array(matchGuestParticipantSchema),
});
export type MatchGuestView = z.infer<typeof matchGuestViewSchema>;

export const matchDetailSchema = z.discriminatedUnion('projection', [
  matchMemberViewSchema,
  matchGuestViewSchema,
]);
export type MatchDetail = z.infer<typeof matchDetailSchema>;

/**
 * `DELETE /api/v1/matches/:id` 200 response: a `draft` is removed, an `open` or `locked` match is
 * cancelled and its participants notified (authorization matrix footnote 13).
 */
export const deleteMatchResponseSchema = z.strictObject({
  outcome: z.enum(['deleted', 'cancelled']),
});
export type DeleteMatchResponse = z.infer<typeof deleteMatchResponseSchema>;

/** `PUT /api/v1/matches/:id/rsvp`. The user always comes from the session. */
export const setRsvpRequestSchema = z.strictObject({
  status: rsvpChoiceSchema,
});
export type SetRsvpRequest = z.infer<typeof setRsvpRequestSchema>;

export const lineupAssignmentSchema = z.strictObject({ userId: idSchema, side: lineupSideSchema });
export type LineupAssignment = z.infer<typeof lineupAssignmentSchema>;

/**
 * `PUT /api/v1/matches/:id/lineup` (captain and co-captain, footnote 15, ADR-0035). Replaces the
 * whole lineup: listed players get their side, every other confirmed player's side is cleared.
 * Each user at most once; every user must have an `in` RSVP (409 `lineup_invalid_player`); each
 * side holds at most `ceil(slots / 2)` players (409 `lineup_side_full`).
 */
export const setLineupRequestSchema = z.strictObject({
  sides: z
    .array(lineupAssignmentSchema)
    .max(LIMITS.slots.max)
    .refine(
      (items) => new Set(items.map((item) => item.userId)).size === items.length,
      'each user may appear only once',
    ),
});
export type SetLineupRequest = z.infer<typeof setLineupRequestSchema>;

/** `PUT /api/v1/matches/:id/lineup` 200 response: the stored lineup. */
export const lineupResponseSchema = z.strictObject({
  matchId: idSchema,
  sides: z.array(lineupAssignmentSchema).max(LIMITS.slots.max),
});
export type LineupResponse = z.infer<typeof lineupResponseSchema>;

/** `PATCH /api/v1/matches/:id/payments/:userId` (footnote 16): only `paid` is writable. */
export const markPaymentRequestSchema = z.strictObject({
  paid: z.boolean(),
});
export type MarkPaymentRequest = z.infer<typeof markPaymentRequestSchema>;

export const paymentResponseSchema = z.strictObject({
  matchId: idSchema,
  userId: idSchema,
  paid: z.boolean(),
  updatedAt: isoDateTimeSchema,
});
export type PaymentResponse = z.infer<typeof paymentResponseSchema>;

/** `POST /api/v1/matches/:id/mvp-vote` (footnote 17). The voter always comes from the session. */
export const mvpVoteRequestSchema = z.strictObject({
  voteeId: idSchema,
});
export type MvpVoteRequest = z.infer<typeof mvpVoteRequestSchema>;

/**
 * `POST /api/v1/matches/:id/mvp-vote` 201 response: confirms the actor's own, final vote only;
 * tallies stay hidden until the window closes (ADR-0036).
 */
export const mvpVoteResponseSchema = z.strictObject({
  matchId: idSchema,
  voteeId: idSchema,
});
export type MvpVoteResponse = z.infer<typeof mvpVoteResponseSchema>;
