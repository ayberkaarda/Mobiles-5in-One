import {
  type CreateMatchRequest,
  type DeleteMatchResponse,
  LIMITS,
  type ListMatchesQuery,
  type MatchDetail,
  type MatchStatusTarget,
  type MatchSummary,
  type Paginated,
  type UpdateMatchRequest,
} from '@kadro/contracts';
import {
  type MatchStatus,
  matches,
  matchRsvps,
  type NewMatch,
  type Transaction,
  venues,
} from '@kadro/db';
import { and, count, eq, inArray, isNotNull, ne } from 'drizzle-orm';

import { closeOpenCallOfMatch } from '../calls/lifecycle';

import { defineKeyset, openPage } from '../domain/pagination';
import { loadMatchRelation, loadTeamRelation, loadVenueRelation } from '../domain/relations';
import { ApiError } from '../errors';
import { notifyMatchUpdated, scheduleMatchReminders } from '../jobs/notify';
import { type ServerRuntime } from '../runtime';
import { actorIdOf, lockTeam } from '../teams/context';
import { mediaUrlBuilder } from '../uploads/urls';
import { validationError } from '../validate';
import { lockMatch, type MatchRequest } from './context';
import {
  loadMatchDetail,
  matchSummaryColumns,
  ownRsvpJoin,
  ownRsvpTable,
  toMatchSummary,
} from './projections';
import { confirmedCount, promoteWaitlist } from './rsvp';

/**
 * Matches (product spec §3 story 3; authorization matrix §3.4 footnotes 10–13, §4.4; ADR-0004,
 * ADR-0031, ADR-0037). Every write follows matrix §2: the team and match rows are locked, the
 * actor's relationship is loaded inside the transaction, `ctx.authorize()` decides, then state
 * checks, the write and the jobs it causes commit together.
 */

/** `GET teams/:id/matches`: latest start first, ties by id (ADR-0039 keyset). */
const TEAM_MATCHES = defineKeyset('matches.team', [
  { column: matches.startsAt, type: 'timestamp', direction: 'desc' },
  { column: matches.id, type: 'uuid', direction: 'desc' },
]);

/** Status transitions of footnote 12 / ADR-0004; `played` and `cancelled` are terminal. */
const TRANSITIONS: Readonly<Record<MatchStatus, readonly MatchStatusTarget[]>> = {
  draft: ['open', 'cancelled'],
  open: ['locked', 'played', 'cancelled'],
  locked: ['open', 'played', 'cancelled'],
  played: [],
  cancelled: [],
};

const TERMS_WRITABLE: ReadonlySet<MatchStatus> = new Set(['draft', 'open']);
const SCHEDULED: ReadonlySet<MatchStatus> = new Set(['open', 'locked']);
const MVP_WINDOW_MS = LIMITS.mvpVoteWindowSeconds * 1_000;

function allowedTransition(from: MatchStatus, to: MatchStatusTarget): boolean {
  switch (from) {
    case 'draft':
      return TRANSITIONS.draft.includes(to);
    case 'open':
      return TRANSITIONS.open.includes(to);
    case 'locked':
      return TRANSITIONS.locked.includes(to);
    case 'played':
    case 'cancelled':
      return false;
  }
}

/** `startsAt` of a write must lie in the future (security checklist item 6). */
function futureStart(value: string, now: Date): Date {
  const startsAt = new Date(value);
  if (startsAt.getTime() <= now.getTime()) {
    throw validationError('body', 'not_in_future', 'startsAt');
  }
  return startsAt;
}

/** Footnote 10: a directory venue must be readable by the actor (public, or its own unverified). */
async function assertVenueReadable(
  tx: Transaction,
  actorId: string,
  venueId: string,
): Promise<void> {
  const venue = await loadVenueRelation(tx, actorId, { id: venueId });
  if (venue === null || !(venue.facts.venuePublic || venue.facts.isCreator)) {
    throw validationError('body', 'not_found', 'venueId');
  }
}

/** Participants told about a reschedule, venue change or cancellation (ADR-0031 `match.updated`). */
async function updateRecipients(
  tx: Transaction,
  matchId: string,
  actorId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ userId: matchRsvps.userId })
    .from(matchRsvps)
    .where(
      and(
        eq(matchRsvps.matchId, matchId),
        inArray(matchRsvps.status, ['in', 'maybe', 'waitlist']),
        ne(matchRsvps.userId, actorId),
      ),
    );
  return rows.map((row) => row.userId);
}

/**
 * ADR-0035: slots never drop below the confirmed players (409 `slots_below_confirmed`) or below
 * what one side of the stored lineup already holds, `ceil(slots / 2)` (409 `slots_below_lineup`).
 */
async function assertSlotsFit(tx: Transaction, matchId: string, slots: number): Promise<void> {
  if (slots < (await confirmedCount(tx, matchId))) {
    throw new ApiError('slots_below_confirmed');
  }
  const sides = await tx
    .select({ side: matchRsvps.side, players: count() })
    .from(matchRsvps)
    .where(
      and(eq(matchRsvps.matchId, matchId), eq(matchRsvps.status, 'in'), isNotNull(matchRsvps.side)),
    )
    .groupBy(matchRsvps.side);
  if (sides.some((row) => row.players > Math.ceil(slots / 2))) {
    throw new ApiError('slots_below_lineup');
  }
}

/** Cancels an `open` or `locked` match: status, open call, `match.updated` to its participants. */
async function cancelMatch(
  tx: Transaction,
  runtime: Pick<ServerRuntime, 'jobs'>,
  matchId: string,
  actorId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(matches)
    .set({ status: 'cancelled', updatedAt: now })
    .where(eq(matches.id, matchId));
  await closeOpenCallOfMatch(tx, runtime.jobs, matchId);
  await notifyMatchUpdated(runtime.jobs, tx, {
    matchId,
    recipientIds: await updateRecipients(tx, matchId, actorId),
    changedAt: now,
  });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** `GET teams/:id/matches` (team members only; guests and outsiders get 404). */
export async function listMatches(
  { ctx, runtime }: MatchRequest,
  teamId: string,
  query: ListMatchesQuery,
): Promise<Paginated<MatchSummary>> {
  const actorId = actorIdOf(ctx);
  const relation = await loadTeamRelation(runtime.db, actorId, teamId);
  if (relation === null) {
    throw new ApiError('not_found');
  }
  await ctx.authorize('match.list', relation.facts);
  const page = openPage(
    TEAM_MATCHES,
    {
      cursor: query.cursor,
      limit: query.limit,
      filters: { teamId: relation.teamId, status: query.status },
    },
    runtime.keyedHash,
  );
  const db = runtime.db;
  const rows = await db
    .select({ ...matchSummaryColumns(db), pageKey: page.key })
    .from(matches)
    .leftJoin(venues, eq(venues.id, matches.venueId))
    .leftJoin(ownRsvpTable, ownRsvpJoin(actorId))
    .where(
      and(
        eq(matches.teamId, relation.teamId),
        query.status === undefined ? undefined : eq(matches.status, query.status),
        page.where,
      ),
    )
    .orderBy(...page.orderBy)
    .limit(page.fetchSize);
  return page.finish(rows, toMatchSummary);
}

/**
 * `POST teams/:id/matches` (captain, co-captain; not on a Pro-locked team, footnote 10). The
 * match starts as `draft`, or `open` with its T-24 h / T-2 h reminders planned in the same
 * transaction.
 */
export async function createMatch(
  { ctx, runtime }: MatchRequest,
  teamId: string,
  body: CreateMatchRequest,
): Promise<MatchDetail> {
  const actorId = actorIdOf(ctx);
  return runtime.db.transaction(async (tx) => {
    await lockTeam(tx, teamId);
    const relation = await loadTeamRelation(tx, actorId, teamId);
    if (relation === null) {
      throw new ApiError('not_found');
    }
    await ctx.authorize('match.create', relation.facts);
    const now = runtime.now();
    const startsAt = futureStart(body.startsAt, now);
    if (body.venueId !== undefined) {
      await assertVenueReadable(tx, actorId, body.venueId);
    }
    const status = body.status ?? 'draft';
    const values: NewMatch = {
      teamId: relation.teamId,
      venueId: body.venueId ?? null,
      venueText: body.venueId === undefined ? (body.venueText ?? null) : null,
      startsAt,
      format: body.format,
      feeTotalMinor: body.feeTotalMinor,
      slots: body.slots,
      status,
    };
    const [match] = await tx.insert(matches).values(values).returning({ id: matches.id });
    if (match === undefined) {
      throw new Error('match insert returned no row');
    }
    if (status === 'open') {
      await scheduleMatchReminders(runtime.jobs, tx, { id: match.id, startsAt }, now);
    }
    return loadMatchDetail(tx, match.id, actorId, 'member', now, mediaUrlBuilder(runtime.env));
  });
}

/** `GET matches/:id`: member view for team members, guest view for match guests (footnote 11). */
export async function getMatch(
  { ctx, runtime }: MatchRequest,
  matchId: string,
): Promise<MatchDetail> {
  const actorId = actorIdOf(ctx);
  // One read-only REPEATABLE READ snapshot: the relationship that authorized the read and every
  // row the projection shows (counts, participants, paid flags) belong to the same moment, so a
  // removal or RSVP change committed meanwhile can neither leak member data nor skew the share.
  return runtime.db.transaction(
    async (tx) => {
      const relation = await loadMatchRelation(tx, actorId, matchId);
      if (relation === null) {
        throw new ApiError('not_found');
      }
      const decision = await ctx.authorize('match.read', relation.facts);
      return loadMatchDetail(
        tx,
        relation.matchId,
        actorId,
        decision.projection ?? 'member',
        runtime.now(),
        mediaUrlBuilder(runtime.env),
      );
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

/**
 * `PATCH matches/:id` (captain, co-captain; footnote 12, ADR-0004). Fee, slots and format change
 * only while the match was never locked and is `draft` or `open` (else 409 `match_terms_frozen`,
 * backed by the `matches_terms_frozen` trigger). Status follows the transition table; the first
 * lock sets `locked_at` for good, `played` (only after the start) opens the 24-hour MVP window.
 * A reschedule replans the reminders, a reschedule or venue change notifies the participants,
 * more slots promote the waitlist, and leaving `open` closes the open call.
 */
export async function updateMatch(
  { ctx, runtime }: MatchRequest,
  matchId: string,
  body: UpdateMatchRequest,
): Promise<MatchDetail> {
  const actorId = actorIdOf(ctx);
  return runtime.db.transaction(async (tx) => {
    await lockMatch(tx, matchId);
    const relation = await loadMatchRelation(tx, actorId, matchId);
    if (relation === null) {
      throw new ApiError('not_found');
    }
    const decision = await ctx.authorize('match.update', relation.facts);
    const [match] = await tx.select().from(matches).where(eq(matches.id, relation.matchId));
    if (match === undefined) {
      throw new ApiError('not_found');
    }
    const now = runtime.now();

    const termsChanged =
      (body.feeTotalMinor !== undefined && body.feeTotalMinor !== match.feeTotalMinor) ||
      (body.slots !== undefined && body.slots !== match.slots) ||
      (body.format !== undefined && body.format !== match.format);
    if (termsChanged && (match.lockedAt !== null || !TERMS_WRITABLE.has(match.status))) {
      throw new ApiError('match_terms_frozen');
    }
    const target = body.status;
    const transition = target !== undefined && target !== match.status;
    if (transition && !allowedTransition(match.status, target)) {
      throw new ApiError('invalid_status_transition');
    }
    if (!SCHEDULED.has(match.status) && match.status !== 'draft' && !transition) {
      // Played and cancelled matches are terminal: nothing about them changes any more.
      if (Object.keys(body).some((key) => key !== 'status')) {
        throw new ApiError('invalid_status_transition');
      }
    }

    const startsAt = body.startsAt === undefined ? match.startsAt : futureStart(body.startsAt, now);
    const startsChanged = startsAt.getTime() !== match.startsAt.getTime();
    if (target === 'played' && transition && startsAt.getTime() > now.getTime()) {
      throw new ApiError('invalid_status_transition');
    }
    if (target === 'open' && match.status === 'draft' && startsAt.getTime() <= now.getTime()) {
      throw new ApiError('invalid_status_transition');
    }
    if (body.slots !== undefined && body.slots !== match.slots) {
      await assertSlotsFit(tx, match.id, body.slots);
    }

    const changes: Partial<NewMatch> = {};
    let venueChanged = false;
    if (body.venueId !== undefined) {
      await assertVenueReadable(tx, actorId, body.venueId);
      venueChanged = body.venueId !== match.venueId;
      changes.venueId = body.venueId;
      changes.venueText = null;
    } else if (body.venueText !== undefined) {
      venueChanged = match.venueId !== null || body.venueText !== match.venueText;
      changes.venueId = null;
      changes.venueText = body.venueText;
    }
    if (startsChanged) {
      changes.startsAt = startsAt;
    }
    if (body.feeTotalMinor !== undefined && body.feeTotalMinor !== match.feeTotalMinor) {
      changes.feeTotalMinor = body.feeTotalMinor;
    }
    if (body.slots !== undefined && body.slots !== match.slots) {
      changes.slots = body.slots;
    }
    if (body.format !== undefined && body.format !== match.format) {
      changes.format = body.format;
    }
    const status: MatchStatus = transition ? target : match.status;
    if (transition) {
      changes.status = target;
      if (target === 'locked' && match.lockedAt === null) {
        changes.lockedAt = now;
      }
      if (target === 'played') {
        changes.mvpVoteClosesAt = new Date(now.getTime() + MVP_WINDOW_MS);
      }
    }
    if (Object.keys(changes).length > 0) {
      await tx
        .update(matches)
        .set({ ...changes, updatedAt: now })
        .where(eq(matches.id, match.id));
    }

    if (transition && match.status === 'open') {
      await closeOpenCallOfMatch(tx, runtime.jobs, match.id);
    }
    // ADR-0035: free slots go to the waitlist whenever the match is open after this request, and
    // when more slots arrive together with the lock (promotion first, so the lock freezes a full
    // roster). A locked match without new slots gains no confirmed player here.
    const slotsAdded = changes.slots !== undefined && changes.slots > match.slots;
    if (status === 'open' || (status === 'locked' && slotsAdded)) {
      await promoteWaitlist(
        tx,
        runtime,
        { id: match.id, slots: changes.slots ?? match.slots },
        now,
      );
    }
    const opened = transition && match.status === 'draft' && status === 'open';
    if (SCHEDULED.has(status) && (startsChanged || opened)) {
      await scheduleMatchReminders(runtime.jobs, tx, { id: match.id, startsAt }, now);
    }
    const cancelled = transition && status === 'cancelled';
    if (cancelled || (SCHEDULED.has(status) && (startsChanged || venueChanged))) {
      await notifyMatchUpdated(runtime.jobs, tx, {
        matchId: match.id,
        recipientIds: await updateRecipients(tx, match.id, actorId),
        changedAt: now,
      });
    }
    return loadMatchDetail(
      tx,
      match.id,
      actorId,
      decision.projection ?? 'member',
      now,
      mediaUrlBuilder(runtime.env),
    );
  });
}

/**
 * `DELETE matches/:id` (captain, co-captain; footnote 13): a `draft` is deleted, an `open` or
 * `locked` match is cancelled (participants notified, open call closed), a `played` or already
 * cancelled match is 409 `match_state_conflict`.
 */
export async function deleteMatch(
  { ctx, runtime }: MatchRequest,
  matchId: string,
): Promise<DeleteMatchResponse> {
  const actorId = actorIdOf(ctx);
  return runtime.db.transaction(async (tx) => {
    await lockMatch(tx, matchId);
    const relation = await loadMatchRelation(tx, actorId, matchId);
    if (relation === null) {
      throw new ApiError('not_found');
    }
    await ctx.authorize('match.delete', relation.facts);
    const [match] = await tx
      .select({ status: matches.status })
      .from(matches)
      .where(eq(matches.id, relation.matchId));
    switch (match?.status) {
      case 'draft':
        await tx.delete(matches).where(eq(matches.id, relation.matchId));
        return { outcome: 'deleted' };
      case 'open':
      case 'locked':
        await cancelMatch(tx, runtime, relation.matchId, actorId, runtime.now());
        return { outcome: 'cancelled' };
      case 'played':
      case 'cancelled':
        throw new ApiError('match_state_conflict');
      case undefined:
        throw new ApiError('not_found');
    }
  });
}
