import { type ResourceContext, type TeamRole } from '@kadro/auth';
import {
  type ApplicationStatus,
  type Database,
  type LineupSide,
  type MatchStatus,
  matches,
  matchRsvps,
  openCallApplications,
  openCalls,
  type OpenCallStatus,
  type RsvpStatus,
  teamMembers,
  teams,
  type Transaction,
  type UploadKind,
  uploads,
  type UploadStatus,
  users,
  venueReviews,
  venues,
} from '@kadro/db';
import { type AnyColumn, and, count, eq, exists, isNull, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { proSubscriptionExists } from '../billing/entitlements';

/**
 * Relationship facts for `can()` (authorization matrix §1.3, §2 step 4, §5), loaded from the
 * database. Each loader is exactly one query that starts from the addressed resource and joins
 * the actor's relationship to it, so a client-supplied id is never trusted alone: the facts say
 * what the actor is to that resource (member role, match guest, applicant, creator, owner), and
 * `can()` turns "no relationship" into the same 404 as a missing row.
 *
 * - A loader returns `null` when the addressed resource does not exist (or the id is not a UUID);
 *   the handler answers 404 `not_found` without calling `can()`.
 * - The actor joins only while active: a deactivated or tombstone account (ADR-0012, ADR-0033)
 *   has no relationship to anything, so every fact is the "unrelated" value. `actorId = null`
 *   (anonymous) behaves the same.
 * - `facts` holds exactly the {@link ResourceContext} fields the loader is responsible for, typed
 *   from `@kadro/auth`, and is passed to `ctx.authorize(action, facts)` unchanged (or spread
 *   together with request-specific facts such as `newTeamRole`).
 * - Facts are an authorization snapshot. State preconditions (status, slots, expiry) are
 *   re-checked under row locks inside the domain transaction.
 */

/** A database handle or an open transaction. */
export type DbReader = Database | Transaction;

/** Required, non-undefined subset of `can()` resource facts. */
export type FactsOf<K extends keyof ResourceContext> = {
  readonly [P in K]-?: Exclude<ResourceContext[P], undefined>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string | null): value is string {
  return value !== null && UUID.test(value);
}

/** The acting user, joined only while active and not a tombstone. */
const actor = alias(users, 'actor');
/** Membership of the nested target user (`member.remove`, `member.updateRole`). */
const targetMember = alias(teamMembers, 'target_member');
const ownedTeam = alias(teams, 'owned_team');
const guestApplication = alias(openCallApplications, 'guest_application');
const guestCall = alias(openCalls, 'guest_call');
/** Nested payment target and lineup roster of a match. */
const targetRsvp = alias(matchRsvps, 'target_rsvp');
const targetUser = alias(users, 'target_user');
const lineupRsvp = alias(matchRsvps, 'lineup_rsvp');
const lineupUser = alias(users, 'lineup_user');
const lineupMember = alias(teamMembers, 'lineup_member');

function actorJoin(actorId: string | null): SQL {
  if (!isUuid(actorId)) {
    return sql`false`;
  }
  return (
    and(eq(actor.id, actorId), eq(actor.isTombstone, false), isNull(actor.deactivatedAt)) ??
    sql`false`
  );
}

/** Membership of the active actor in the team whose id is `teamId`. */
function actorMembershipJoin(teamId: AnyColumn): SQL {
  return and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, actor.id)) ?? sql`false`;
}

/** The active actor's RSVP on the match whose id is `matchId`. */
function actorRsvpJoin(matchId: AnyColumn): SQL {
  return and(eq(matchRsvps.matchId, matchId), eq(matchRsvps.userId, actor.id)) ?? sql`false`;
}

/** The active actor holds an accepted application on any open call of the match (ADR-0003). */
function acceptedApplicationOn(db: DbReader, matchId: AnyColumn): SQL<boolean> {
  const accepted = db
    .select({ one: sql`1` })
    .from(guestApplication)
    .innerJoin(guestCall, eq(guestCall.id, guestApplication.openCallId))
    .where(
      and(
        eq(guestCall.matchId, matchId),
        eq(guestApplication.userId, actor.id),
        eq(guestApplication.status, 'accepted'),
      ),
    );
  return sql<boolean>`${exists(accepted)}`;
}

/**
 * `guest(M)` (matrix §1.3): an RSVP on the match without team membership. The RSVP must come from
 * one of the two documented paths: an accepted open-call application (ADR-0003) or a kept row of a
 * `played` match after leaving the team (ADR-0005). A stray RSVP on any other match of a former
 * member grants nothing.
 */
function isMatchGuest(row: {
  teamRole: TeamRole | null;
  rsvpStatus: RsvpStatus | null;
  matchStatus: MatchStatus;
  acceptedApplication: boolean;
}): boolean {
  return (
    row.teamRole === null &&
    row.rsvpStatus !== null &&
    (row.matchStatus === 'played' || row.acceptedApplication)
  );
}

// ---------------------------------------------------------------------------
// Teams and members
// ---------------------------------------------------------------------------

export interface TeamRelation {
  readonly teamId: string;
  readonly ownerId: string;
  /** `teamRole`: `null` = not a member (`user` column), else `player` / `co_captain` / `captain`. */
  readonly facts: FactsOf<'teamRole' | 'teamProLocked'>;
}

/** Team-scoped actions (`team.*`, `invite.*`, `match.list`, `match.create`, badge presign). */
export async function loadTeamRelation(
  db: DbReader,
  actorId: string | null,
  teamId: string,
): Promise<TeamRelation | null> {
  if (!isUuid(teamId)) {
    return null;
  }
  const [row] = await db
    .select({
      teamId: teams.id,
      ownerId: teams.ownerId,
      teamProLocked: teams.isProLocked,
      teamRole: teamMembers.role,
    })
    .from(teams)
    .leftJoin(actor, actorJoin(actorId))
    .leftJoin(teamMembers, actorMembershipJoin(teams.id))
    .where(eq(teams.id, teamId))
    .limit(1);
  if (row === undefined) {
    return null;
  }
  return {
    teamId: row.teamId,
    ownerId: row.ownerId,
    facts: { teamRole: row.teamRole, teamProLocked: row.teamProLocked },
  };
}

export interface MemberTarget {
  readonly userId: string;
  readonly teamRole: TeamRole;
  /** `isSelf`, `targetTeamRole` and the captaincy-transfer facts of matrix footnote 8. */
  readonly facts: FactsOf<'isSelf' | 'targetTeamRole' | 'targetOwnedTeams' | 'targetIsPro'>;
}

export interface MemberTargetRelation extends TeamRelation {
  /** `null` when the target user is not a member of this team (404 after authorization). */
  readonly target: MemberTarget | null;
}

/**
 * `member.updateRole` / `member.remove`: the actor's membership and the target's membership of the
 * same team in one query (matrix §5, `team_members` target row). `targetIsPro` is the target's
 * entitlement at `now` (matrix §7, ADR-0065): a captaincy transfer to a free user who already owns
 * a team is refused.
 */
export async function loadMemberTargetRelation(
  db: DbReader,
  actorId: string | null,
  teamId: string,
  targetUserId: string,
  now: Date,
): Promise<MemberTargetRelation | null> {
  if (!isUuid(teamId)) {
    return null;
  }
  const validTarget = isUuid(targetUserId);
  const [row] = await db
    .select({
      teamId: teams.id,
      ownerId: teams.ownerId,
      teamProLocked: teams.isProLocked,
      actorId: actor.id,
      teamRole: teamMembers.role,
      targetUserId: targetMember.userId,
      targetTeamRole: targetMember.role,
      targetOwnedTeams: validTarget
        ? sql<number>`(${db
            .select({ owned: count() })
            .from(ownedTeam)
            .where(eq(ownedTeam.ownerId, targetUserId))})`.mapWith(Number)
        : sql<number>`0`.mapWith(Number),
      targetIsPro: validTarget
        ? proSubscriptionExists(db, targetUserId, now)
        : sql<boolean>`false`.mapWith(Boolean),
    })
    .from(teams)
    .leftJoin(actor, actorJoin(actorId))
    .leftJoin(teamMembers, actorMembershipJoin(teams.id))
    .leftJoin(
      targetMember,
      validTarget
        ? (and(eq(targetMember.teamId, teams.id), eq(targetMember.userId, targetUserId)) ??
            sql`false`)
        : sql`false`,
    )
    .where(eq(teams.id, teamId))
    .limit(1);
  if (row === undefined) {
    return null;
  }
  const target: MemberTarget | null =
    row.targetUserId === null || row.targetTeamRole === null
      ? null
      : {
          userId: row.targetUserId,
          teamRole: row.targetTeamRole,
          facts: {
            isSelf: row.actorId !== null && row.targetUserId === row.actorId,
            targetTeamRole: row.targetTeamRole,
            targetOwnedTeams: row.targetOwnedTeams,
            targetIsPro: row.targetIsPro,
          },
        };
  return {
    teamId: row.teamId,
    ownerId: row.ownerId,
    facts: { teamRole: row.teamRole, teamProLocked: row.teamProLocked },
    target,
  };
}

/** `team.create` (footnote 6): number of teams the active actor owns as captain. */
export async function loadTeamCreateFacts(
  db: DbReader,
  actorId: string | null,
): Promise<FactsOf<'actorOwnedTeams'>> {
  if (!isUuid(actorId)) {
    return { actorOwnedTeams: 0 };
  }
  const [row] = await db
    .select({ owned: sql<number>`count(*)`.mapWith(Number) })
    .from(teams)
    .where(eq(teams.ownerId, actorId));
  return { actorOwnedTeams: row?.owned ?? 0 };
}

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

export interface MatchRelation {
  readonly matchId: string;
  readonly teamId: string;
  readonly status: MatchStatus;
  /** The actor's own RSVP status; `in` is `played(M)` for MVP votes and payment targets. */
  readonly rsvpStatus: RsvpStatus | null;
  readonly facts: FactsOf<'teamRole' | 'isMatchGuest' | 'teamProLocked'>;
}

/** Match-scoped actions (`match.read/update/delete`, RSVP, lineup, payments, MVP, open-call publish/close). */
export async function loadMatchRelation(
  db: DbReader,
  actorId: string | null,
  matchId: string,
): Promise<MatchRelation | null> {
  if (!isUuid(matchId)) {
    return null;
  }
  const [row] = await db
    .select({
      matchId: matches.id,
      teamId: matches.teamId,
      matchStatus: matches.status,
      teamProLocked: teams.isProLocked,
      teamRole: teamMembers.role,
      rsvpStatus: matchRsvps.status,
      acceptedApplication: acceptedApplicationOn(db, matches.id),
    })
    .from(matches)
    .innerJoin(teams, eq(teams.id, matches.teamId))
    .leftJoin(actor, actorJoin(actorId))
    .leftJoin(teamMembers, actorMembershipJoin(matches.teamId))
    .leftJoin(matchRsvps, actorRsvpJoin(matches.id))
    .where(eq(matches.id, matchId))
    .limit(1);
  if (row === undefined) {
    return null;
  }
  return {
    matchId: row.matchId,
    teamId: row.teamId,
    status: row.matchStatus,
    rsvpStatus: row.rsvpStatus,
    facts: {
      teamRole: row.teamRole,
      isMatchGuest: isMatchGuest(row),
      teamProLocked: row.teamProLocked,
    },
  };
}

/** A user's RSVP row on the addressed match, loaded inside that match (matrix §2 step 6). */
export interface MatchParticipant {
  readonly userId: string;
  readonly rsvpStatus: RsvpStatus;
  /** `rsvpStatus === 'in'` (`played(M)`); payments and lineups accept confirmed players only. */
  readonly confirmed: boolean;
  readonly paid: boolean;
  readonly side: LineupSide | null;
  /** Role in the match's team; `captain` / `co_captain` = team staff, `null` = guest. */
  readonly teamRole: TeamRole | null;
  /** History row of a deleted account (ADR-0033). */
  readonly isTombstone: boolean;
}

export interface PaymentTargetRelation extends MatchRelation {
  /** `isSelf`: the target user is the active actor (footnote 16, co-captain self-marking). */
  readonly facts: FactsOf<'teamRole' | 'isMatchGuest' | 'teamProLocked' | 'isSelf'>;
  /** `null` when the target has no RSVP on this match (404 after authorization). */
  readonly target: MatchParticipant | null;
}

/**
 * `payment.mark` (`PATCH matches/:id/payments/:userId`): the match through the participant scope
 * plus the target's RSVP inside that match, in one query. Handler order (matrix §2): `null` → 404;
 * `authorize('payment.mark', facts)`; `target === null` → 404; `!target.confirmed` → 409.
 */
export async function loadPaymentTargetRelation(
  db: DbReader,
  actorId: string | null,
  matchId: string,
  targetUserId: string,
): Promise<PaymentTargetRelation | null> {
  if (!isUuid(matchId)) {
    return null;
  }
  const validTarget = isUuid(targetUserId);
  const [row] = await db
    .select({
      matchId: matches.id,
      teamId: matches.teamId,
      matchStatus: matches.status,
      teamProLocked: teams.isProLocked,
      actorId: actor.id,
      teamRole: teamMembers.role,
      rsvpStatus: matchRsvps.status,
      acceptedApplication: acceptedApplicationOn(db, matches.id),
      targetUserId: targetRsvp.userId,
      targetRsvpStatus: targetRsvp.status,
      targetPaid: targetRsvp.paid,
      targetSide: targetRsvp.side,
      targetTeamRole: targetMember.role,
      targetIsTombstone: targetUser.isTombstone,
    })
    .from(matches)
    .innerJoin(teams, eq(teams.id, matches.teamId))
    .leftJoin(actor, actorJoin(actorId))
    .leftJoin(teamMembers, actorMembershipJoin(matches.teamId))
    .leftJoin(matchRsvps, actorRsvpJoin(matches.id))
    .leftJoin(
      targetRsvp,
      validTarget
        ? (and(eq(targetRsvp.matchId, matches.id), eq(targetRsvp.userId, targetUserId)) ??
            sql`false`)
        : sql`false`,
    )
    .leftJoin(targetUser, eq(targetUser.id, targetRsvp.userId))
    .leftJoin(
      targetMember,
      and(eq(targetMember.teamId, matches.teamId), eq(targetMember.userId, targetRsvp.userId)),
    )
    .where(eq(matches.id, matchId))
    .limit(1);
  if (row === undefined) {
    return null;
  }
  const target: MatchParticipant | null =
    row.targetUserId === null || row.targetRsvpStatus === null
      ? null
      : {
          userId: row.targetUserId,
          rsvpStatus: row.targetRsvpStatus,
          confirmed: row.targetRsvpStatus === 'in',
          paid: row.targetPaid ?? false,
          side: row.targetSide,
          teamRole: row.targetTeamRole,
          isTombstone: row.targetIsTombstone ?? false,
        };
  return {
    matchId: row.matchId,
    teamId: row.teamId,
    status: row.matchStatus,
    rsvpStatus: row.rsvpStatus,
    facts: {
      teamRole: row.teamRole,
      isMatchGuest: isMatchGuest(row),
      teamProLocked: row.teamProLocked,
      isSelf: validTarget && row.actorId !== null && row.actorId === targetUserId.toLowerCase(),
    },
    target,
  };
}

export interface LineupRelation extends MatchRelation {
  readonly slots: number;
  /** `ceil(slots / 2)` (ADR-0035, 409 `lineup_side_full`). */
  readonly maxPerSide: number;
  /** Every `in` RSVP of the match, oldest first; lineup user ids must be among them. */
  readonly confirmed: readonly MatchParticipant[];
}

/**
 * `lineup.set` (`PUT matches/:id/lineup`, footnote 15): the match through the participant scope
 * plus its confirmed players, aggregated in one query. Handler order: `null` → 404;
 * `authorize('lineup.set', facts)`; then validate the body against `confirmed` (409
 * `lineup_invalid_player` / `lineup_side_full`) and status, re-checked under the match lock.
 */
export async function loadLineupRelation(
  db: DbReader,
  actorId: string | null,
  matchId: string,
): Promise<LineupRelation | null> {
  if (!isUuid(matchId)) {
    return null;
  }
  const roster = db
    .select({
      players: sql`coalesce(json_agg(json_build_object('userId', ${lineupRsvp.userId}, 'side', ${lineupRsvp.side}, 'paid', ${lineupRsvp.paid}, 'teamRole', ${lineupMember.role}, 'isTombstone', ${lineupUser.isTombstone}) order by ${lineupRsvp.createdAt}, ${lineupRsvp.id}), '[]'::json)`,
    })
    .from(lineupRsvp)
    .innerJoin(lineupUser, eq(lineupUser.id, lineupRsvp.userId))
    .leftJoin(
      lineupMember,
      and(eq(lineupMember.teamId, matches.teamId), eq(lineupMember.userId, lineupRsvp.userId)),
    )
    .where(and(eq(lineupRsvp.matchId, matches.id), eq(lineupRsvp.status, 'in')));
  const [row] = await db
    .select({
      matchId: matches.id,
      teamId: matches.teamId,
      matchStatus: matches.status,
      slots: matches.slots,
      teamProLocked: teams.isProLocked,
      teamRole: teamMembers.role,
      rsvpStatus: matchRsvps.status,
      acceptedApplication: acceptedApplicationOn(db, matches.id),
      confirmed: sql<unknown>`(${roster})`,
    })
    .from(matches)
    .innerJoin(teams, eq(teams.id, matches.teamId))
    .leftJoin(actor, actorJoin(actorId))
    .leftJoin(teamMembers, actorMembershipJoin(matches.teamId))
    .leftJoin(matchRsvps, actorRsvpJoin(matches.id))
    .where(eq(matches.id, matchId))
    .limit(1);
  if (row === undefined) {
    return null;
  }
  return {
    matchId: row.matchId,
    teamId: row.teamId,
    status: row.matchStatus,
    rsvpStatus: row.rsvpStatus,
    slots: row.slots,
    maxPerSide: Math.ceil(row.slots / 2),
    confirmed: confirmedPlayers(row.confirmed),
    facts: {
      teamRole: row.teamRole,
      isMatchGuest: isMatchGuest(row),
      teamProLocked: row.teamProLocked,
    },
  };
}

const TEAM_ROLE_VALUES: readonly (TeamRole | null)[] = ['captain', 'co_captain', 'player', null];
const SIDE_VALUES: readonly (LineupSide | null)[] = ['A', 'B', null];

/** Validates the aggregated roster; a shape mismatch is a server bug, never client input. */
function confirmedPlayers(value: unknown): MatchParticipant[] {
  if (!Array.isArray(value)) {
    throw new TypeError('lineup roster is not an array');
  }
  return value.map((entry: unknown) => {
    const item = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<
      string,
      unknown
    >;
    const { userId, side, paid, teamRole, isTombstone } = item;
    if (
      typeof userId !== 'string' ||
      typeof paid !== 'boolean' ||
      typeof isTombstone !== 'boolean' ||
      !SIDE_VALUES.includes(side as LineupSide | null) ||
      !TEAM_ROLE_VALUES.includes(teamRole as TeamRole | null)
    ) {
      throw new TypeError('lineup roster entry has an unexpected shape');
    }
    return {
      userId,
      rsvpStatus: 'in',
      confirmed: true,
      paid,
      side: side as LineupSide | null,
      teamRole: teamRole as TeamRole | null,
      isTombstone,
    };
  });
}

// ---------------------------------------------------------------------------
// Open calls and applications
// ---------------------------------------------------------------------------

export interface OwnApplication {
  readonly id: string;
  readonly status: ApplicationStatus;
}

export interface OpenCallRelation {
  readonly openCallId: string;
  readonly matchId: string;
  readonly teamId: string;
  readonly callStatus: OpenCallStatus;
  readonly matchStatus: MatchStatus;
  /** The actor's own application on this call, if any (ADR-0010: at most one). */
  readonly application: OwnApplication | null;
  /**
   * Staff = `teamRole` captain / co-captain of the call's team; applicant = `isApplicant`;
   * everything else is unrelated (or a member / guest of the match, which `can()` decides).
   */
  readonly facts: FactsOf<'teamRole' | 'isMatchGuest' | 'isApplicant' | 'teamProLocked'>;
}

/** `application.create` (match scope of the call) and `application.list` (footnote 33). */
export async function loadOpenCallRelation(
  db: DbReader,
  actorId: string | null,
  openCallId: string,
): Promise<OpenCallRelation | null> {
  if (!isUuid(openCallId)) {
    return null;
  }
  const [row] = await db
    .select({
      openCallId: openCalls.id,
      callStatus: openCalls.status,
      matchId: matches.id,
      teamId: matches.teamId,
      matchStatus: matches.status,
      teamProLocked: teams.isProLocked,
      teamRole: teamMembers.role,
      rsvpStatus: matchRsvps.status,
      acceptedApplication: acceptedApplicationOn(db, matches.id),
      applicationId: openCallApplications.id,
      applicationStatus: openCallApplications.status,
    })
    .from(openCalls)
    .innerJoin(matches, eq(matches.id, openCalls.matchId))
    .innerJoin(teams, eq(teams.id, matches.teamId))
    .leftJoin(actor, actorJoin(actorId))
    .leftJoin(teamMembers, actorMembershipJoin(matches.teamId))
    .leftJoin(matchRsvps, actorRsvpJoin(matches.id))
    .leftJoin(
      openCallApplications,
      and(
        eq(openCallApplications.openCallId, openCalls.id),
        eq(openCallApplications.userId, actor.id),
      ),
    )
    .where(eq(openCalls.id, openCallId))
    .limit(1);
  if (row === undefined) {
    return null;
  }
  const application =
    row.applicationId === null || row.applicationStatus === null
      ? null
      : { id: row.applicationId, status: row.applicationStatus };
  return {
    openCallId: row.openCallId,
    matchId: row.matchId,
    teamId: row.teamId,
    callStatus: row.callStatus,
    matchStatus: row.matchStatus,
    application,
    facts: {
      teamRole: row.teamRole,
      isMatchGuest: isMatchGuest(row),
      isApplicant: application !== null,
      teamProLocked: row.teamProLocked,
    },
  };
}

export interface ApplicationRelation {
  readonly applicationId: string;
  readonly openCallId: string;
  readonly matchId: string;
  readonly teamId: string;
  readonly applicantId: string;
  readonly status: ApplicationStatus;
  readonly callStatus: OpenCallStatus;
  readonly matchStatus: MatchStatus;
  readonly facts: FactsOf<'teamRole' | 'isMatchGuest' | 'isApplicant' | 'teamProLocked'>;
}

/**
 * `application.decide` / `application.withdraw` (footnote 21): the application is addressed by
 * `app.id = :appId AND app.open_call_id = :id` joined to the call's match and team in one query,
 * so an application id under another call is `null` (404), never a lookup by bare id.
 */
export async function loadApplicationRelation(
  db: DbReader,
  actorId: string | null,
  openCallId: string,
  applicationId: string,
): Promise<ApplicationRelation | null> {
  if (!isUuid(openCallId) || !isUuid(applicationId)) {
    return null;
  }
  const [row] = await db
    .select({
      applicationId: openCallApplications.id,
      applicantId: openCallApplications.userId,
      status: openCallApplications.status,
      openCallId: openCalls.id,
      callStatus: openCalls.status,
      matchId: matches.id,
      teamId: matches.teamId,
      matchStatus: matches.status,
      teamProLocked: teams.isProLocked,
      actorId: actor.id,
      teamRole: teamMembers.role,
      rsvpStatus: matchRsvps.status,
      acceptedApplication: acceptedApplicationOn(db, matches.id),
    })
    .from(openCallApplications)
    .innerJoin(openCalls, eq(openCalls.id, openCallApplications.openCallId))
    .innerJoin(matches, eq(matches.id, openCalls.matchId))
    .innerJoin(teams, eq(teams.id, matches.teamId))
    .leftJoin(actor, actorJoin(actorId))
    .leftJoin(teamMembers, actorMembershipJoin(matches.teamId))
    .leftJoin(matchRsvps, actorRsvpJoin(matches.id))
    .where(
      and(
        eq(openCallApplications.id, applicationId),
        eq(openCallApplications.openCallId, openCallId),
      ),
    )
    .limit(1);
  if (row === undefined) {
    return null;
  }
  return {
    applicationId: row.applicationId,
    openCallId: row.openCallId,
    matchId: row.matchId,
    teamId: row.teamId,
    applicantId: row.applicantId,
    status: row.status,
    callStatus: row.callStatus,
    matchStatus: row.matchStatus,
    facts: {
      teamRole: row.teamRole,
      isMatchGuest: isMatchGuest(row),
      isApplicant: row.actorId !== null && row.actorId === row.applicantId,
      teamProLocked: row.teamProLocked,
    },
  };
}

// ---------------------------------------------------------------------------
// Venues and reviews
// ---------------------------------------------------------------------------

export type VenueRef = { readonly slug: string } | { readonly id: string };

export interface VenueRelation {
  readonly venueId: string;
  readonly slug: string;
  /** The actor's own review at this venue (`review.deleteOwn`, footnote 32). */
  readonly ownReviewId: string | null;
  /**
   * `venuePublic` (verified or sample), `isCreator`, `playedAtVenue` (an `in` RSVP on a `played`
   * match at this venue, footnote 24) and `ownsResource` (an own review exists, footnote 32).
   */
  readonly facts: FactsOf<'venuePublic' | 'isCreator' | 'playedAtVenue' | 'ownsResource'>;
}

/** `venue.read`, `review.create`, `review.deleteOwn`, and venue references of match writes. */
export async function loadVenueRelation(
  db: DbReader,
  actorId: string | null,
  ref: VenueRef,
): Promise<VenueRelation | null> {
  if ('id' in ref && !isUuid(ref.id)) {
    return null;
  }
  const playedHere = db
    .select({ one: sql`1` })
    .from(matchRsvps)
    .innerJoin(matches, eq(matches.id, matchRsvps.matchId))
    .where(
      and(
        eq(matches.venueId, venues.id),
        eq(matches.status, 'played'),
        eq(matchRsvps.userId, actor.id),
        eq(matchRsvps.status, 'in'),
      ),
    );
  const [row] = await db
    .select({
      venueId: venues.id,
      slug: venues.slug,
      verified: venues.verified,
      isSample: venues.isSample,
      createdBy: venues.createdBy,
      actorId: actor.id,
      ownReviewId: venueReviews.id,
      playedAtVenue: sql<boolean>`${exists(playedHere)}`,
    })
    .from(venues)
    .leftJoin(actor, actorJoin(actorId))
    .leftJoin(
      venueReviews,
      and(eq(venueReviews.venueId, venues.id), eq(venueReviews.userId, actor.id)),
    )
    .where('id' in ref ? eq(venues.id, ref.id) : eq(venues.slug, ref.slug))
    .limit(1);
  if (row === undefined) {
    return null;
  }
  return {
    venueId: row.venueId,
    slug: row.slug,
    ownReviewId: row.ownReviewId,
    facts: {
      venuePublic: row.verified || row.isSample,
      isCreator: row.actorId !== null && row.createdBy === row.actorId,
      playedAtVenue: row.playedAtVenue,
      ownsResource: row.ownReviewId !== null,
    },
  };
}

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

export interface OwnedUpload {
  readonly id: string;
  readonly kind: UploadKind;
  readonly teamId: string | null;
  readonly status: UploadStatus;
  readonly key: string;
  readonly createdAt: Date;
}

export interface UploadOwnership {
  /** The upload, loaded by `uploads.id = :id AND uploads.user_id = :actor` (footnote 31). */
  readonly upload: OwnedUpload | null;
  readonly facts: FactsOf<'ownsResource'>;
}

/**
 * `upload.complete` / `upload.read`: another user's upload and a missing one are the same
 * `ownsResource: false`, which `can()` answers with 404.
 */
export async function loadUploadOwnership(
  db: DbReader,
  actorId: string | null,
  uploadId: string,
): Promise<UploadOwnership> {
  if (!isUuid(uploadId) || !isUuid(actorId)) {
    return { upload: null, facts: { ownsResource: false } };
  }
  const [row] = await db
    .select({
      id: uploads.id,
      kind: uploads.kind,
      teamId: uploads.teamId,
      status: uploads.status,
      key: uploads.key,
      createdAt: uploads.createdAt,
    })
    .from(uploads)
    .innerJoin(actor, and(actorJoin(actorId), eq(actor.id, uploads.userId)))
    .where(eq(uploads.id, uploadId))
    .limit(1);
  return { upload: row ?? null, facts: { ownsResource: row !== undefined } };
}

// ---------------------------------------------------------------------------
// Per-request memo
// ---------------------------------------------------------------------------

/**
 * Loaders bound to one request's actor. Each distinct resource is read at most once per request,
 * however many steps of the handler ask for it.
 */
export interface RelationLoader {
  team(teamId: string): Promise<TeamRelation | null>;
  memberTarget(teamId: string, targetUserId: string): Promise<MemberTargetRelation | null>;
  teamCreate(): Promise<FactsOf<'actorOwnedTeams'>>;
  match(matchId: string): Promise<MatchRelation | null>;
  paymentTarget(matchId: string, targetUserId: string): Promise<PaymentTargetRelation | null>;
  lineup(matchId: string): Promise<LineupRelation | null>;
  openCall(openCallId: string): Promise<OpenCallRelation | null>;
  application(openCallId: string, applicationId: string): Promise<ApplicationRelation | null>;
  venue(ref: VenueRef): Promise<VenueRelation | null>;
  upload(uploadId: string): Promise<UploadOwnership>;
}

export function createRelationLoader(
  db: DbReader,
  actorId: string | null,
  now: Date,
): RelationLoader {
  const cache = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached as Promise<T>;
    }
    const pending = load();
    cache.set(key, pending);
    pending.catch(() => cache.delete(key));
    return pending;
  };
  return {
    team: (teamId) => once(`team:${teamId}`, () => loadTeamRelation(db, actorId, teamId)),
    memberTarget: (teamId, targetUserId) =>
      once(`member:${teamId}:${targetUserId}`, () =>
        loadMemberTargetRelation(db, actorId, teamId, targetUserId, now),
      ),
    teamCreate: () => once('team-create', () => loadTeamCreateFacts(db, actorId)),
    match: (matchId) => once(`match:${matchId}`, () => loadMatchRelation(db, actorId, matchId)),
    paymentTarget: (matchId, targetUserId) =>
      once(`payment:${matchId}:${targetUserId}`, () =>
        loadPaymentTargetRelation(db, actorId, matchId, targetUserId),
      ),
    lineup: (matchId) => once(`lineup:${matchId}`, () => loadLineupRelation(db, actorId, matchId)),
    openCall: (openCallId) =>
      once(`open-call:${openCallId}`, () => loadOpenCallRelation(db, actorId, openCallId)),
    application: (openCallId, applicationId) =>
      once(`application:${openCallId}:${applicationId}`, () =>
        loadApplicationRelation(db, actorId, openCallId, applicationId),
      ),
    venue: (ref) =>
      once('id' in ref ? `venue-id:${ref.id}` : `venue-slug:${ref.slug}`, () =>
        loadVenueRelation(db, actorId, ref),
      ),
    upload: (uploadId) =>
      once(`upload:${uploadId}`, () => loadUploadOwnership(db, actorId, uploadId)),
  };
}
