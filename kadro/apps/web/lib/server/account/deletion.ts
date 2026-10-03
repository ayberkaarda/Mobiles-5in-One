import { type DeleteAccountRequest, type DeleteAccountResponse, LIMITS } from '@kadro/contracts';
import {
  deletionRequests,
  matches,
  matchRsvps,
  openCallApplications,
  openCalls,
  pushTokens,
  teams,
  type Transaction,
  users,
} from '@kadro/db';
import { and, asc, eq, gt, inArray, isNull, ne } from 'drizzle-orm';

import { verifyFreshStaffTotp } from '../admin/step-up';
import { recordAudit } from '../audit';
import { revokeAllSessions } from '../auth/sessions';
import { ApiError } from '../errors';
import { notifyLineupSlotFree, notifyRsvpChanged } from '../jobs/notify';
import { teamStaffIds } from '../matches/context';
import { promoteWaitlist } from '../matches/rsvp';
import { actorIdOf } from '../teams/context';
import { type AccountRequest } from './push-tokens';
import { verifyReauthProof } from './reauth';

/**
 * `DELETE me` (security checklist item 21, ADR-0032 §1, authorization matrix §3.2 footnotes 4
 * and 5). After the re-authentication proof (and, for staff, a fresh TOTP code) passed the policy,
 * one transaction holding the user row:
 *
 * 1. refuses a second request (409 `deletion_pending`) and the last active admin (409
 *    `last_admin`, all admin rows locked first);
 * 2. inserts `deletion_requests` with `grace_until = now + 7 days`;
 * 3. deactivates the account, revokes every refresh family and web session, deletes every push
 *    token, so the next request with any credential answers 401;
 * 4. sets the user's RSVPs on upcoming `open` / `locked` matches to `out` (waitlist promotion,
 *    lineup and captain notifications, cleared payment audited as for any drop-out) and withdraws
 *    pending open-call applications;
 * 5. enqueues `account.hard_delete` (`startAfter = grace_until`, key `delete:<requestId>`) and the
 *    `deletion_scheduled` email (key `email:deletion:<requestId>`);
 * 6. writes the `account.deletionRequested` audit row without metadata.
 *
 * A failure anywhere rolls everything back: no job without the request, no request without its
 * jobs. Signing in again before `grace_until` cancels the deletion (`auth/account-state.ts`,
 * ADR-0012); the queued job then finds no pending request and does nothing.
 */

const ACTIVE_MATCH_STATUSES = ['open', 'locked'] as const;

/** Locks every active admin row in id order, then refuses when the actor is the last one. */
async function assertNotLastAdmin(tx: Transaction, actorId: string): Promise<void> {
  const admins = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'admin'), isNull(users.deactivatedAt), eq(users.isTombstone, false)))
    .orderBy(asc(users.id))
    .for('update');
  if (admins.some((admin) => admin.id === actorId) && admins.length <= 1) {
    throw new ApiError('last_admin');
  }
}

interface Chain {
  readonly teamId: string;
  readonly matchId: string;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/**
 * Releases the user's place in upcoming matches and pending applications (ADR-0032 step 4). Row
 * locks follow the order of every team and match mutation: team rows, then match rows, then
 * open-call rows, then application rows, each set in id order.
 */
async function releaseParticipation(
  tx: Transaction,
  input: AccountRequest & { readonly actorId: string; readonly now: Date },
): Promise<void> {
  const { ctx, runtime, actorId, now } = input;
  const upcoming = await tx
    .select({ teamId: matches.teamId, matchId: matches.id })
    .from(matchRsvps)
    .innerJoin(matches, eq(matches.id, matchRsvps.matchId))
    .where(
      and(
        eq(matchRsvps.userId, actorId),
        ne(matchRsvps.status, 'out'),
        inArray(matches.status, ACTIVE_MATCH_STATUSES),
        gt(matches.startsAt, now),
      ),
    );
  const applications = await tx
    .select({
      teamId: matches.teamId,
      matchId: matches.id,
      openCallId: openCalls.id,
      applicationId: openCallApplications.id,
    })
    .from(openCallApplications)
    .innerJoin(openCalls, eq(openCalls.id, openCallApplications.openCallId))
    .innerJoin(matches, eq(matches.id, openCalls.matchId))
    .where(
      and(eq(openCallApplications.userId, actorId), eq(openCallApplications.status, 'pending')),
    );

  const chains: Chain[] = [...upcoming, ...applications];
  for (const teamId of sortedUnique(chains.map((chain) => chain.teamId))) {
    await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).for('update');
  }
  for (const matchId of sortedUnique(chains.map((chain) => chain.matchId))) {
    await tx.select({ id: matches.id }).from(matches).where(eq(matches.id, matchId)).for('update');
  }
  for (const openCallId of sortedUnique(applications.map((row) => row.openCallId))) {
    await tx
      .select({ id: openCalls.id })
      .from(openCalls)
      .where(eq(openCalls.id, openCallId))
      .for('update');
  }
  const applicationIds = sortedUnique(applications.map((row) => row.applicationId));
  for (const applicationId of applicationIds) {
    await tx
      .select({ id: openCallApplications.id })
      .from(openCallApplications)
      .where(eq(openCallApplications.id, applicationId))
      .for('update');
  }

  for (const matchId of sortedUnique(upcoming.map((row) => row.matchId))) {
    const [row] = await tx
      .select({
        rsvpId: matchRsvps.id,
        rsvpStatus: matchRsvps.status,
        paid: matchRsvps.paid,
        matchStatus: matches.status,
        startsAt: matches.startsAt,
        slots: matches.slots,
        teamId: matches.teamId,
        captainId: teams.ownerId,
      })
      .from(matchRsvps)
      .innerJoin(matches, eq(matches.id, matchRsvps.matchId))
      .innerJoin(teams, eq(teams.id, matches.teamId))
      .where(and(eq(matchRsvps.matchId, matchId), eq(matchRsvps.userId, actorId)));
    // Re-checked under the locks: a concurrent status change or drop-out may have won.
    if (
      row === undefined ||
      row.rsvpStatus === 'out' ||
      !(ACTIVE_MATCH_STATUSES as readonly string[]).includes(row.matchStatus) ||
      row.startsAt.getTime() <= now.getTime()
    ) {
      continue;
    }
    const leavesIn = row.rsvpStatus === 'in';
    await tx
      .update(matchRsvps)
      .set({
        status: 'out',
        waitlistedAt: null,
        updatedAt: now,
        ...(leavesIn ? { side: null, paid: false } : {}),
      })
      .where(eq(matchRsvps.id, row.rsvpId));
    if (leavesIn) {
      await promoteWaitlist(tx, runtime, { id: matchId, slots: row.slots }, now);
      if (row.matchStatus === 'locked' && row.captainId !== actorId) {
        await notifyLineupSlotFree(runtime.jobs, tx, {
          matchId,
          captainId: row.captainId,
          leaverId: actorId,
          leftAt: now,
        });
      }
    }
    const staff = await teamStaffIds(tx, row.teamId);
    await notifyRsvpChanged(runtime.jobs, tx, {
      matchId,
      recipientIds: staff.filter((userId) => userId !== actorId),
      now,
    });
    if (leavesIn && row.paid) {
      // Same record as any drop-out that clears `paid` (ADR-0036).
      await recordAudit(tx, runtime.keyedHash, {
        actorId,
        action: 'payment.mark',
        targetType: 'match_rsvp',
        targetId: row.rsvpId,
        ip: ctx.ip,
        metadata: {
          matchId,
          targetUserId: actorId,
          paid: false,
          selfMark: true,
          reason: 'rsvp_left',
        },
      });
    }
  }

  if (applicationIds.length > 0) {
    const withdrawn = await tx
      .update(openCallApplications)
      .set({ status: 'withdrawn', updatedAt: now })
      .where(
        and(
          inArray(openCallApplications.id, applicationIds),
          eq(openCallApplications.status, 'pending'),
        ),
      )
      .returning({
        id: openCallApplications.id,
        openCallId: openCallApplications.openCallId,
      });
    for (const application of withdrawn) {
      await recordAudit(tx, runtime.keyedHash, {
        actorId,
        action: 'application.withdrawn',
        targetType: 'open_call_application',
        targetId: application.id,
        ip: ctx.ip,
        metadata: { openCallId: application.openCallId, reason: 'account_deletion' },
      });
    }
  }
}

export async function requestAccountDeletion(
  { ctx, runtime }: AccountRequest,
  body: DeleteAccountRequest,
): Promise<DeleteAccountResponse> {
  const actorId = actorIdOf(ctx);
  const [account] = await runtime.db
    .select({
      id: users.id,
      role: users.role,
      passwordHash: users.passwordHash,
      appleSub: users.appleSub,
      googleSub: users.googleSub,
    })
    .from(users)
    .where(eq(users.id, actorId))
    .limit(1);
  if (account === undefined) {
    throw new ApiError('unauthenticated');
  }
  const reauthenticated = await verifyReauthProof(runtime, account, body);
  const freshTotp =
    reauthenticated &&
    account.role !== 'user' &&
    (await verifyFreshStaffTotp({ ctx, runtime }, actorId, body.totpCode, 'accountDeletion'));
  await ctx.authorize('me.delete', { reauthenticated, freshTotp });

  return runtime.db.transaction(async (tx) => {
    const now = runtime.now();
    if (account.role === 'admin') {
      await assertNotLastAdmin(tx, actorId);
    }
    const [user] = await tx
      .select({ deactivatedAt: users.deactivatedAt })
      .from(users)
      .where(eq(users.id, actorId))
      .for('no key update');
    if (user === undefined) {
      throw new ApiError('unauthenticated');
    }
    const [pending] = await tx
      .select({ id: deletionRequests.id })
      .from(deletionRequests)
      .where(and(eq(deletionRequests.userId, actorId), isNull(deletionRequests.completedAt)))
      .limit(1);
    if (pending !== undefined) {
      throw new ApiError('deletion_pending');
    }
    if (user.deactivatedAt !== null) {
      throw new ApiError('account_deactivated');
    }

    const graceUntil = new Date(now.getTime() + LIMITS.accountDeletionGraceSeconds * 1_000);
    const [request] = await tx
      .insert(deletionRequests)
      .values({ userId: actorId, requestedAt: now, graceUntil, createdAt: now, updatedAt: now })
      .returning({ id: deletionRequests.id });
    if (request === undefined) {
      throw new Error('deletion request insert returned no row');
    }
    await tx.update(users).set({ deactivatedAt: now, updatedAt: now }).where(eq(users.id, actorId));
    await revokeAllSessions(tx, actorId, now);
    await tx.delete(pushTokens).where(eq(pushTokens.userId, actorId));
    await releaseParticipation(tx, { ctx, runtime, actorId, now });

    await runtime.jobs.enqueue(
      tx,
      'account.hard_delete',
      { deletionRequestId: request.id },
      { idempotencyKey: `delete:${request.id}`, startAfter: graceUntil },
    );
    await runtime.jobs.enqueue(
      tx,
      'email.send',
      { kind: 'deletion_scheduled', userId: actorId, requestId: ctx.requestId },
      { idempotencyKey: `email:deletion:${request.id}` },
    );
    await recordAudit(tx, runtime.keyedHash, {
      actorId,
      action: 'account.deletionRequested',
      targetType: 'deletion_request',
      targetId: request.id,
      ip: ctx.ip,
    });
    return { graceUntil: graceUntil.toISOString() };
  });
}
