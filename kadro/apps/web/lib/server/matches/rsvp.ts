import { type OwnRsvp, type RsvpChoice, type SetRsvpRequest } from '@kadro/contracts';
import { matches, matchRsvps, type RsvpStatus, teams, type Transaction } from '@kadro/db';
import { and, asc, count, eq } from 'drizzle-orm';

import { recordAudit } from '../audit';
import { loadMatchRelation } from '../domain/relations';
import { ApiError } from '../errors';
import { type RequestContext } from '../http';
import { notifyLineupSlotFree, notifyRsvpChanged, notifyRsvpPromoted } from '../jobs/notify';
import { type ServerRuntime } from '../runtime';
import { actorIdOf } from '../teams/context';
import { lockMatch, type MatchRequest, teamStaffIds } from './context';

/**
 * RSVP and waitlist (product spec §3 story 3; authorization matrix §3.4 footnote 14; ADR-0035,
 * ADR-0036). Every write runs under the team and match row locks (`lockMatch`), so the confirmed
 * count, the waitlist order and the write are one consistent step: the last slot goes to exactly
 * one caller, and promotion always takes the oldest `waitlisted_at` (ties by id).
 */

/** Confirmed (`in`) players of a match. The caller holds the match lock. */
export async function confirmedCount(tx: Transaction, matchId: string): Promise<number> {
  const [row] = await tx
    .select({ players: count() })
    .from(matchRsvps)
    .where(and(eq(matchRsvps.matchId, matchId), eq(matchRsvps.status, 'in')));
  return row?.players ?? 0;
}

/**
 * Promotes waitlisted RSVPs, oldest `waitlisted_at` first (ties by id), while confirmed players
 * are fewer than `slots`, and enqueues one `rsvp.promoted` push per promoted player in the same
 * transaction (ADR-0035, ADR-0031). The caller holds the match lock. Returns the promoted users.
 */
export async function promoteWaitlist(
  tx: Transaction,
  runtime: Pick<ServerRuntime, 'jobs'>,
  match: { readonly id: string; readonly slots: number },
  now: Date,
): Promise<string[]> {
  const promoted: string[] = [];
  let confirmed = await confirmedCount(tx, match.id);
  while (confirmed < match.slots) {
    const [next] = await tx
      .select({ id: matchRsvps.id, userId: matchRsvps.userId })
      .from(matchRsvps)
      .where(and(eq(matchRsvps.matchId, match.id), eq(matchRsvps.status, 'waitlist')))
      .orderBy(asc(matchRsvps.waitlistedAt), asc(matchRsvps.id))
      .limit(1);
    if (next === undefined) {
      break;
    }
    await tx
      .update(matchRsvps)
      .set({ status: 'in', waitlistedAt: null, updatedAt: now })
      .where(eq(matchRsvps.id, next.id));
    await notifyRsvpPromoted(runtime.jobs, tx, {
      matchId: match.id,
      userId: next.userId,
      promotedAt: now,
    });
    promoted.push(next.userId);
    confirmed += 1;
  }
  return promoted;
}

interface RsvpRow {
  readonly id: string;
  readonly status: RsvpStatus;
  readonly paid: boolean;
}

/**
 * Clears the `paid` flag of an RSVP that leaves `in` and audits the clearing like a payment mark
 * (ADR-0036: `payment.mark`, `paid = false`, `reason = 'rsvp_left'`). Audit failure rolls the
 * whole RSVP change back (ADR-0006).
 */
async function auditPaidCleared(
  tx: Transaction,
  ctx: Pick<RequestContext, 'ip'>,
  runtime: Pick<ServerRuntime, 'keyedHash'>,
  input: { readonly rsvpId: string; readonly matchId: string; readonly userId: string },
): Promise<void> {
  await recordAudit(tx, runtime.keyedHash, {
    actorId: input.userId,
    action: 'payment.mark',
    targetType: 'match_rsvp',
    targetId: input.rsvpId,
    ip: ctx.ip,
    metadata: {
      matchId: input.matchId,
      targetUserId: input.userId,
      paid: false,
      selfMark: true,
      reason: 'rsvp_left',
    },
  });
}

/**
 * `PUT matches/:id/rsvp` (every participant, own row only). `in` takes a free slot, otherwise a
 * member joins the waitlist at its end and a guest gets 409 `match_full` (guests are never
 * waitlisted). Leaving `in` clears `side` and `paid`, promotes the waitlist and, on a `locked`
 * match, tells the captain that a lineup slot is free. Captain and co-captains receive the
 * coalesced `rsvp.changed` push. Allowed while the match is `open` (only `out` once `locked`) and
 * has not started; otherwise 409 `match_not_open`.
 */
export async function setRsvp(
  { ctx, runtime }: MatchRequest,
  matchId: string,
  body: SetRsvpRequest,
): Promise<OwnRsvp> {
  const actorId = actorIdOf(ctx);
  return runtime.db.transaction(async (tx) => {
    await lockMatch(tx, matchId);
    const relation = await loadMatchRelation(tx, actorId, matchId);
    if (relation === null) {
      throw new ApiError('not_found');
    }
    await ctx.authorize('rsvp.set', relation.facts);
    const now = runtime.now();
    const [match] = await tx
      .select({
        status: matches.status,
        slots: matches.slots,
        startsAt: matches.startsAt,
        teamId: matches.teamId,
        captainId: teams.ownerId,
      })
      .from(matches)
      .innerJoin(teams, eq(teams.id, matches.teamId))
      .where(eq(matches.id, relation.matchId));
    if (match === undefined) {
      throw new ApiError('not_found');
    }
    const upcoming = match.startsAt.getTime() > now.getTime();
    const writable =
      upcoming && (match.status === 'open' || (match.status === 'locked' && body.status === 'out'));
    if (!writable) {
      throw new ApiError('match_not_open');
    }

    const [current] = await tx
      .select({ id: matchRsvps.id, status: matchRsvps.status, paid: matchRsvps.paid })
      .from(matchRsvps)
      .where(and(eq(matchRsvps.matchId, relation.matchId), eq(matchRsvps.userId, actorId)));
    const isGuest = relation.facts.teamRole === null;
    const next = await nextStatus(tx, {
      matchId: relation.matchId,
      slots: match.slots,
      current: current ?? null,
      choice: body.status,
      isGuest,
    });

    let row: { status: RsvpStatus; side: OwnRsvp['side']; updatedAt: Date };
    /** RSVP whose `paid` flag this change cleared; audited last, after every enqueue. */
    let clearedPaid: string | null = null;
    if (current !== undefined && next === current.status) {
      const [unchanged] = await tx
        .select({
          status: matchRsvps.status,
          side: matchRsvps.side,
          updatedAt: matchRsvps.updatedAt,
        })
        .from(matchRsvps)
        .where(eq(matchRsvps.id, current.id));
      if (unchanged === undefined) {
        throw new Error('locked RSVP row disappeared');
      }
      return toOwnRsvp(relation.matchId, unchanged);
    }

    const waitlistedAt = next === 'waitlist' ? now : null;
    if (current === undefined) {
      const [inserted] = await tx
        .insert(matchRsvps)
        .values({ matchId: relation.matchId, userId: actorId, status: next, waitlistedAt })
        .returning({
          status: matchRsvps.status,
          side: matchRsvps.side,
          updatedAt: matchRsvps.updatedAt,
        });
      if (inserted === undefined) {
        throw new Error('RSVP insert returned no row');
      }
      row = inserted;
    } else {
      const leavesIn = current.status === 'in';
      const [updated] = await tx
        .update(matchRsvps)
        .set({
          status: next,
          waitlistedAt,
          updatedAt: now,
          ...(leavesIn ? { side: null, paid: false } : {}),
        })
        .where(eq(matchRsvps.id, current.id))
        .returning({
          status: matchRsvps.status,
          side: matchRsvps.side,
          updatedAt: matchRsvps.updatedAt,
        });
      if (updated === undefined) {
        throw new Error('RSVP update returned no row');
      }
      row = updated;
      if (leavesIn) {
        clearedPaid = current.paid ? current.id : null;
        await promoteWaitlist(tx, runtime, { id: relation.matchId, slots: match.slots }, now);
        if (match.status === 'locked' && match.captainId !== actorId) {
          await notifyLineupSlotFree(runtime.jobs, tx, {
            matchId: relation.matchId,
            captainId: match.captainId,
            leaverId: actorId,
            leftAt: now,
          });
        }
      }
    }

    const staff = await teamStaffIds(tx, match.teamId);
    await notifyRsvpChanged(runtime.jobs, tx, {
      matchId: relation.matchId,
      recipientIds: staff.filter((userId) => userId !== actorId),
      now,
    });
    if (clearedPaid !== null) {
      // Written after the jobs: a failing audit insert (ADR-0006) must take the RSVP change, the
      // promotion and every job enqueued above down with it.
      await auditPaidCleared(tx, ctx, runtime, {
        rsvpId: clearedPaid,
        matchId: relation.matchId,
        userId: actorId,
      });
    }
    return toOwnRsvp(relation.matchId, row);
  });
}

/** Resulting status of a choice (ADR-0035); 409 `match_full` for a guest without a free slot. */
async function nextStatus(
  tx: Transaction,
  input: {
    readonly matchId: string;
    readonly slots: number;
    readonly current: RsvpRow | null;
    readonly choice: RsvpChoice;
    readonly isGuest: boolean;
  },
): Promise<RsvpStatus> {
  if (input.choice !== 'in') {
    return input.choice;
  }
  const status = input.current?.status;
  if (status === 'in' || status === 'waitlist') {
    // Already confirmed, or already queued: re-sending `in` keeps the place in the queue.
    return status;
  }
  if ((await confirmedCount(tx, input.matchId)) < input.slots) {
    return 'in';
  }
  if (input.isGuest) {
    throw new ApiError('match_full');
  }
  return 'waitlist';
}

function toOwnRsvp(
  matchId: string,
  row: { status: RsvpStatus; side: OwnRsvp['side']; updatedAt: Date },
): OwnRsvp {
  return {
    matchId,
    status: row.status,
    side: row.side,
    updatedAt: row.updatedAt.toISOString(),
  };
}
