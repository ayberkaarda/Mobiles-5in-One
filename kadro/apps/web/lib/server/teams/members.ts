import { type ResourceContext } from '@kadro/auth';
import { type Action, type TeamMember, type UpdateMemberRoleRequest } from '@kadro/contracts';
import { matches, matchRsvps, teamMembers, teams, type Transaction } from '@kadro/db';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { recordAudit } from '../audit';
import {
  type MemberTarget,
  type MemberTargetRelation,
  loadMemberTargetRelation,
} from '../domain/relations';
import { ApiError } from '../errors';
import { type RequestContext } from '../http';
import { notifyLineupSlotFree, notifyRsvpChanged } from '../jobs/notify';
import { teamStaffIds } from '../matches/context';
import { promoteWaitlist } from '../matches/rsvp';
import { mediaUrlBuilder } from '../uploads/urls';
import { actorIdOf, lockTeam, type TeamRequest } from './context';
import { loadMember } from './projections';

/**
 * Role changes, captaincy transfer and removal (ADR-0005, ADR-0008; authorization matrix §3.3
 * footnotes 8 and 9). Both endpoints address a nested target (`:userId` inside `teams/:id`) and
 * follow matrix §2 steps 4–6: the actor's and the target's memberships are loaded in one query
 * under the team row lock, `can()` decides on the parent relationship, and only then does a
 * missing target answer 404.
 */

/**
 * Target facts used when `:userId` is not a member: the least privileged target (a `player`,
 * not the actor, owning no team). The policy then answers exactly as for a real target the actor
 * could not touch (403 for players and co-captains changing roles) or could (allowed → 404 for
 * the missing target), so a non-member target never yields a different status than a member one
 * would for the same actor.
 */
const ABSENT_TARGET_FACTS = {
  isSelf: false,
  targetTeamRole: 'player',
  targetOwnedTeams: 0,
  targetIsPro: false,
} as const satisfies ResourceContext;

/** Statuses whose RSVPs a departing member loses; `played` rows stay as history (ADR-0005). */
const UPCOMING_STATUSES = ['draft', 'open', 'locked'] as const;
const PROMOTING_STATUSES: ReadonlySet<string> = new Set(['open', 'locked']);

async function authorizedTarget(
  tx: Transaction,
  ctx: RequestContext,
  action: Extract<Action, 'member.updateRole' | 'member.remove'>,
  teamId: string,
  userId: string,
  now: Date,
  requestFacts: ResourceContext = {},
): Promise<{ relation: MemberTargetRelation; target: MemberTarget }> {
  const relation = await loadMemberTargetRelation(tx, actorIdOf(ctx), teamId, userId, now);
  if (relation === null) {
    throw new ApiError('not_found');
  }
  const { target } = relation;
  if (target === null) {
    await ctx.authorize(action, { ...relation.facts, ...ABSENT_TARGET_FACTS, ...requestFacts });
    throw new ApiError('not_found');
  }
  await ctx.authorize(action, { ...relation.facts, ...target.facts, ...requestFacts });
  return { relation, target };
}

/**
 * `PATCH teams/:id/members/:userId` (captain only). `co_captain` / `player` change the target's
 * role. `captain` transfers captaincy atomically (ADR-0008): the previous captain becomes
 * `co_captain` first (the partial unique index allows one captain per team), the target becomes
 * `captain`, `teams.owner_id` follows, and one audit row records it, all in one transaction
 * under the team row lock. The captain can never demote themselves, so a team never loses its
 * last captain.
 */
export async function updateMemberRole(
  { ctx, runtime }: TeamRequest,
  teamId: string,
  userId: string,
  body: UpdateMemberRoleRequest,
): Promise<TeamMember> {
  const actorId = actorIdOf(ctx);
  return runtime.db.transaction(async (tx) => {
    await lockTeam(tx, teamId);
    const { relation, target } = await authorizedTarget(
      tx,
      ctx,
      'member.updateRole',
      teamId,
      userId,
      runtime.now(),
      { newTeamRole: body.role },
    );
    if (body.role === 'captain') {
      const demoted = await tx
        .update(teamMembers)
        .set({ role: 'co_captain' })
        .where(
          and(
            eq(teamMembers.teamId, relation.teamId),
            eq(teamMembers.userId, actorId),
            eq(teamMembers.role, 'captain'),
          ),
        )
        .returning({ id: teamMembers.id });
      if (demoted.length !== 1) {
        throw new Error('captaincy transfer without a current captain row');
      }
      await tx
        .update(teamMembers)
        .set({ role: 'captain' })
        .where(and(eq(teamMembers.teamId, relation.teamId), eq(teamMembers.userId, target.userId)));
      await tx.update(teams).set({ ownerId: target.userId }).where(eq(teams.id, relation.teamId));
      await recordAudit(tx, runtime.keyedHash, {
        actorId,
        action: 'team.captaincyTransfer',
        targetType: 'team',
        targetId: relation.teamId,
        ip: ctx.ip,
        metadata: {
          previousCaptainId: actorId,
          newCaptainId: target.userId,
          previousRole: target.teamRole,
        },
      });
    } else if (target.teamRole !== body.role) {
      await tx
        .update(teamMembers)
        .set({ role: body.role })
        .where(and(eq(teamMembers.teamId, relation.teamId), eq(teamMembers.userId, target.userId)));
      await recordAudit(tx, runtime.keyedHash, {
        actorId,
        action: 'member.roleChanged',
        targetType: 'user',
        targetId: target.userId,
        ip: ctx.ip,
        metadata: { teamId: relation.teamId, from: target.teamRole, to: body.role },
      });
    }
    const member = await loadMember(
      tx,
      relation.teamId,
      target.userId,
      mediaUrlBuilder(runtime.env),
    );
    if (member === null) {
      throw new Error('updated member is not visible');
    }
    return member;
  });
}

/** Current captain of the team (one per team, `team_members_one_captain_key`). */
async function captainOf(tx: Transaction, teamId: string): Promise<string | null> {
  const [row] = await tx
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, 'captain')))
    .limit(1);
  return row?.userId ?? null;
}

/**
 * `DELETE teams/:id/members/:userId`: removal by staff and leaving alike (ADR-0005), in one
 * transaction: the membership row is deleted; the user's RSVPs on the team's `draft`, `open` and
 * `locked` matches are deleted under row locks on those matches, and a freed confirmed slot is
 * filled from the waitlist; RSVPs on `played` matches stay for history (and give the former member
 * the guest projection of exactly those matches). The captain cannot leave (409
 * `captain_must_transfer`); co-captains remove players only.
 *
 * Pushes (ADR-0031), enqueued in the same transaction as for an RSVP change: `rsvp.promoted` to
 * each player promoted from the waitlist, `rsvp.changed` to the remaining captain and co-captains
 * (not the actor) for every match whose RSVP was removed, and `lineup.slot_free` to the captain
 * when a confirmed player leaves a `locked` match (ADR-0005), unless the captain removed them.
 */
export async function removeMember(
  { ctx, runtime }: TeamRequest,
  teamId: string,
  userId: string,
): Promise<void> {
  const actorId = actorIdOf(ctx);
  await runtime.db.transaction(async (tx) => {
    await lockTeam(tx, teamId);
    const { relation, target } = await authorizedTarget(
      tx,
      ctx,
      'member.remove',
      teamId,
      userId,
      runtime.now(),
    );
    const upcoming = await tx
      .select({
        matchId: matches.id,
        status: matches.status,
        slots: matches.slots,
        rsvpStatus: matchRsvps.status,
      })
      .from(matches)
      .innerJoin(
        matchRsvps,
        and(eq(matchRsvps.matchId, matches.id), eq(matchRsvps.userId, target.userId)),
      )
      .where(and(eq(matches.teamId, relation.teamId), inArray(matches.status, UPCOMING_STATUSES)))
      .orderBy(asc(matches.id))
      .for('update', { of: matches });

    await tx
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, relation.teamId), eq(teamMembers.userId, target.userId)));
    if (upcoming.length > 0) {
      await tx.delete(matchRsvps).where(
        and(
          eq(matchRsvps.userId, target.userId),
          inArray(
            matchRsvps.matchId,
            upcoming.map((row) => row.matchId),
          ),
        ),
      );
    }
    const now = runtime.now();
    const staff = await teamStaffIds(tx, relation.teamId);
    const captainId = await captainOf(tx, relation.teamId);
    let promoted = 0;
    for (const row of upcoming) {
      if (row.rsvpStatus === 'in' && PROMOTING_STATUSES.has(row.status)) {
        promoted += (await promoteWaitlist(tx, runtime, { id: row.matchId, slots: row.slots }, now))
          .length;
        if (row.status === 'locked' && captainId !== null && captainId !== actorId) {
          await notifyLineupSlotFree(runtime.jobs, tx, {
            matchId: row.matchId,
            captainId,
            leaverId: target.userId,
            leftAt: now,
          });
        }
      }
      await notifyRsvpChanged(runtime.jobs, tx, {
        matchId: row.matchId,
        recipientIds: staff.filter((userId) => userId !== actorId),
        now,
      });
    }
    const self = target.facts.isSelf;
    await recordAudit(tx, runtime.keyedHash, {
      actorId,
      action: self ? 'member.left' : 'member.removed',
      targetType: 'user',
      targetId: target.userId,
      ip: ctx.ip,
      metadata: {
        teamId: relation.teamId,
        role: target.teamRole,
        rsvpsRemoved: upcoming.length,
        waitlistPromoted: promoted,
      },
    });
  });
}
